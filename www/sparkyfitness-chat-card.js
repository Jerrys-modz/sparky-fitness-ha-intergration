/**
 * SparkyFitness Chat Card — a minimal Lovelace custom card that provides a
 * chat-style interface for logging to SparkyFitness by typing free text
 * ("log a banana", "I had chicken for lunch", "log 500 ml of water",
 * "log 150g of chicken", "log running for 30 minutes").
 *
 * Food and exercise commands are handled specially: the card searches
 * SparkyFitness directly (sparky_fitness.search_food_choices /
 * search_exercise_choices) and, when more than one candidate matches, shows
 * them as clickable options ("did you mean...?") instead of silently
 * logging the first match. Picking one calls log_food_choice /
 * log_exercise_choice with that exact id.
 *
 * Food quantities are understood two ways:
 *   - "log 150g of chicken" / "log 2 cups of rice" — an absolute amount in
 *     the given unit, overriding the food's default serving size.
 *   - "log 2 bananas" / "log 3 eggs" — a plain multiplier on the food's
 *     default serving size (2x, 3x, ...).
 *   - "log a banana" (no number) — one default serving.
 *
 * Weight is also handled directly: "log my weight as 175", "log weight 175",
 * "weight is 79.5 kg" call sparky_fitness.log_weight (which always expects
 * kg). If no unit is given, the card assumes the `weightUnit` config option
 * (default "lbs" — set to "kg" in the card config if your SparkyFitness
 * account's preferred unit is kg) and converts before logging.
 *
 * Anything else (water, or general Assist commands like turning on lights)
 * is sent straight to Home Assistant's own Assist (conversation.process) —
 * the same pipeline voice commands use — so it reuses whatever
 * conversation-trigger automations you have (e.g. the "Log Water by Voice"
 * SparkyFitness automation) with zero extra wiring.
 *
 * Requires SparkyFitness custom integration v0.8.0+ (adds the
 * search_exercise_choices / log_exercise_choice services this card calls,
 * and skips unloggable no-variant food matches).
 *
 * Install:
 *   1. Copy this file to <config>/www/sparkyfitness-chat-card.js
 *   2. Settings -> Dashboards -> (top-right ⋮) -> Resources -> Add Resource
 *        URL:  /local/sparkyfitness-chat-card.js
 *        Type: JavaScript Module
 *   3. Edit a dashboard -> Add Card -> search "SparkyFitness Chat" (or add
 *      manually in YAML mode):
 *        type: custom:sparkyfitness-chat-card
 *        title: Log to SparkyFitness   # optional
 *        weightUnit: lbs              # optional, "lbs" (default) or "kg"
 */

const FOOD_COMMAND_RE =
  /^(?:log|i\s+ate|i\s+had)\s+(?:a\s+|an\s+)?(.+?)(?:\s+for\s+(breakfast|lunch|dinner|snacks))?$/i;
const NOT_FOOD_RE = /^(water|glass of water|\d+(\.\d+)?\s*m?l(\s+of)?\s+water|my\s+weight)/i;
const QUANTITY_UNIT_RE =
  /^(\d+(?:\.\d+)?)\s*(g|grams?|kg|kilograms?|ml|milliliters?|oz|ounces?|cups?)\s+(?:of\s+)?(.+)$/i;
const QUANTITY_MULT_RE = /^(\d+(?:\.\d+)?)\s+(.+)$/;

const EXERCISE_COMMAND_RE =
  /^(?:log|i\s+did)\s+(.+?)\s+for\s+(\d+(?:\.\d+)?)\s*min(?:ute)?s?$/i;

const WEIGHT_COMMAND_RE =
  /^(?:log\s+)?(?:my\s+)?weight\s+(?:is|as|of)?\s*(\d+(?:\.\d+)?)\s*(kg|kilograms?|lbs?|pounds?)?\s*$/i;

const LBS_TO_KG = 0.45359237;

function normalizeUnit(u) {
  const s = u.toLowerCase();
  if (s.startsWith("gram") || s === "g") return "g";
  if (s.startsWith("kilogram") || s === "kg") return "kg";
  if (s.startsWith("milliliter") || s === "ml") return "ml";
  if (s.startsWith("ounce") || s === "oz") return "oz";
  if (s.startsWith("cup")) return "cup";
  return s;
}

function normalizeWeightUnit(u) {
  const s = (u || "").toLowerCase();
  if (s.startsWith("kg") || s.startsWith("kilo")) return "kg";
  if (s.startsWith("lb") || s.startsWith("pound")) return "lbs";
  return "";
}

class SparkyFitnessChatCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._messages = [];
    this._sending = false;
    this._msgSeq = 0;
  }

  setConfig(config) {
    this._config = {
      title: "Log to SparkyFitness",
      placeholder: "Log 2 eggs for breakfast, log 150g of chicken, log running for 30 minutes…",
      suggestions: ["I ate ", "I had ", "log water", "log running for ", "log my weight is "],
      // Unit assumed when a weight command doesn't specify one (e.g. "log my
      // weight as 175") — set to "kg" here if your SparkyFitness account's
      // preferred weight unit is kg, not lbs.
      weightUnit: "lbs",
      ...config,
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
  }

  getCardSize() {
    return 5;
  }

  static getConfigElement() {
    return null;
  }

  static getStubConfig() {
    return {};
  }

  // ---------- rendering ----------

  _render() {
    if (!this.shadowRoot) return;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card {
          display: flex;
          flex-direction: column;
          height: 420px;
          overflow: hidden;
        }
        .header {
          padding: 12px 16px 4px;
          font-size: 1.1em;
          font-weight: 500;
          color: var(--ha-card-header-color, var(--primary-text-color));
        }
        .log {
          flex: 1;
          overflow-y: auto;
          padding: 8px 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .bubble {
          max-width: 85%;
          padding: 8px 12px;
          border-radius: 14px;
          font-size: 0.95em;
          line-height: 1.35;
          word-wrap: break-word;
          white-space: pre-wrap;
        }
        .bubble.user {
          align-self: flex-end;
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
          border-bottom-right-radius: 4px;
        }
        .bubble.assistant, .bubble.choices {
          align-self: flex-start;
          background: var(--secondary-background-color, #f0f0f0);
          color: var(--primary-text-color);
          border-bottom-left-radius: 4px;
        }
        .bubble.error {
          align-self: flex-start;
          background: var(--error-color, #db4437);
          color: #fff;
          border-bottom-left-radius: 4px;
        }
        .bubble.pending { opacity: 0.6; }
        .choices-prompt { margin-bottom: 6px; }
        .choice-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .choice-btn {
          text-align: left;
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 10px;
          padding: 6px 10px;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
          cursor: pointer;
          font-size: 0.9em;
        }
        .choice-btn:hover:not(:disabled) {
          border-color: var(--primary-color);
        }
        .choice-btn:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .choice-btn .cal {
          color: var(--secondary-text-color);
          font-size: 0.85em;
        }
        .empty {
          margin: auto;
          color: var(--secondary-text-color);
          font-size: 0.9em;
          text-align: center;
          padding: 0 24px;
        }
        .suggestions {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 0 16px 8px;
        }
        .chip {
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 16px;
          padding: 4px 12px;
          font-size: 0.8em;
          background: none;
          color: var(--primary-text-color);
          cursor: pointer;
        }
        .chip:hover { background: var(--secondary-background-color, #f0f0f0); }
        .input-row {
          display: flex;
          gap: 8px;
          padding: 8px 16px 16px;
          border-top: 1px solid var(--divider-color, #e0e0e0);
        }
        input[type="text"] {
          flex: 1;
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 20px;
          padding: 8px 14px;
          font-size: 0.95em;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
        }
        input[type="text"]:focus {
          outline: none;
          border-color: var(--primary-color);
        }
        button.send {
          border: none;
          border-radius: 20px;
          padding: 0 18px;
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
          font-weight: 500;
          cursor: pointer;
        }
        button.send:disabled { opacity: 0.5; cursor: default; }
      </style>
      <ha-card>
        <div class="header">${this._escape(this._config.title)}</div>
        <div class="log" id="log">
          ${this._messages.length === 0 ? this._emptyStateHtml() : this._messages.map((m) => this._bubbleHtml(m)).join("")}
        </div>
        <div class="suggestions">
          ${this._config.suggestions
            .map((s) => `<button class="chip" data-fill="${this._escape(s)}">${this._escape(s.trim() || s)}</button>`)
            .join("")}
        </div>
        <div class="input-row">
          <input type="text" id="input" placeholder="${this._escape(this._config.placeholder)}" />
          <button class="send" id="send">Send</button>
        </div>
      </ha-card>
    `;

    const input = this.shadowRoot.getElementById("input");
    const sendBtn = this.shadowRoot.getElementById("send");
    sendBtn.disabled = this._sending;

    sendBtn.addEventListener("click", () => this._send());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !this._sending) this._send();
    });
    this.shadowRoot.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        input.value = chip.getAttribute("data-fill");
        input.focus();
      });
    });
    this.shadowRoot.querySelectorAll(".choice-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const msgId = Number(btn.getAttribute("data-msg-id"));
        const choiceIdx = Number(btn.getAttribute("data-choice-idx"));
        this._pickChoice(msgId, choiceIdx);
      });
    });

    this._scrollToBottom();
  }

  _emptyStateHtml() {
    return `<div class="empty">Say what you logged, e.g. "I ate a banana", "log 150g of chicken", or "log running for 30 minutes".</div>`;
  }

  _bubbleHtml(m) {
    if (m.role === "choices") {
      const buttons = m.choices
        .map((c, idx) => {
          const label = c.brand ? `${c.name} (${c.brand})` : c.name;
          let extra = "";
          if (c.calories != null) {
            extra = `<span class="cal"> — ${Math.round(c.calories)} kcal / ${c.serving_size}${c.serving_unit || ""}</span>`;
          } else if (c.category) {
            extra = `<span class="cal"> — ${this._escape(c.category)}</span>`;
          }
          return `<button class="choice-btn" data-msg-id="${m.id}" data-choice-idx="${idx}" ${m.resolved ? "disabled" : ""}>${this._escape(label)}${extra}</button>`;
        })
        .join("");
      return `<div class="bubble choices">
        <div class="choices-prompt">${this._escape(m.text)}</div>
        <div class="choice-list">${buttons}</div>
      </div>`;
    }
    return `<div class="bubble ${m.role}${m.pending ? " pending" : ""}">${this._escape(m.text)}</div>`;
  }

  _escape(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  _scrollToBottom() {
    const log = this.shadowRoot.getElementById("log");
    if (log) log.scrollTop = log.scrollHeight;
  }

  // ---------- parsing ----------

  _parseFoodCommand(text) {
    const m = text.match(FOOD_COMMAND_RE);
    if (!m) return null;
    const rawFood = (m[1] || "").trim();
    if (!rawFood || NOT_FOOD_RE.test(rawFood)) return null;
    const meal = (m[2] || "snacks").toLowerCase();

    const unitMatch = rawFood.match(QUANTITY_UNIT_RE);
    if (unitMatch) {
      return {
        food: unitMatch[3].trim(),
        meal,
        quantityAbsolute: parseFloat(unitMatch[1]),
        unitAbsolute: normalizeUnit(unitMatch[2]),
      };
    }
    const multMatch = rawFood.match(QUANTITY_MULT_RE);
    if (multMatch) {
      return { food: multMatch[2].trim(), meal, multiplier: parseFloat(multMatch[1]) };
    }
    return { food: rawFood, meal, multiplier: 1 };
  }

  _parseExerciseCommand(text) {
    const m = text.match(EXERCISE_COMMAND_RE);
    if (!m) return null;
    const exercise = (m[1] || "").trim();
    const duration = parseFloat(m[2]);
    if (!exercise || !duration) return null;
    return { exercise, duration };
  }

  _parseWeightCommand(text) {
    const m = text.match(WEIGHT_COMMAND_RE);
    if (!m) return null;
    const value = parseFloat(m[1]);
    if (!value) return null;
    return { value, unit: normalizeWeightUnit(m[2]) };
  }

  // ---------- sending ----------

  async _callService(domain, service, data) {
    const result = await this._hass.callWS({
      type: "call_service",
      domain,
      service,
      service_data: data,
      return_response: true,
    });
    // HA has wrapped call_service response shapes slightly differently across
    // versions; check both the flat and nested forms.
    return (result && (result.response ?? result)) || {};
  }

  async _send() {
    const input = this.shadowRoot.getElementById("input");
    const text = (input.value || "").trim();
    if (!text || !this._hass || this._sending) return;

    this._messages.push({ id: ++this._msgSeq, role: "user", text });
    input.value = "";
    this._sending = true;
    this._render();

    // Checked before food/exercise: "log my weight as 175" would otherwise
    // either get excluded by NOT_FOOD_RE and fall through to plain Assist
    // (which has no weight automation to catch it), or — for phrasings
    // NOT_FOOD_RE doesn't happen to cover — get misread as a food name.
    const weightCmd = this._parseWeightCommand(text);
    const foodCmd = !weightCmd ? this._parseFoodCommand(text) : null;
    const exerciseCmd = !weightCmd && !foodCmd ? this._parseExerciseCommand(text) : null;
    try {
      if (weightCmd) {
        await this._handleWeightCommand(weightCmd);
      } else if (foodCmd) {
        await this._handleFoodCommand(foodCmd);
      } else if (exerciseCmd) {
        await this._handleExerciseCommand(exerciseCmd);
      } else {
        await this._handleGeneralCommand(text);
      }
    } catch (err) {
      this._messages.push({
        id: ++this._msgSeq,
        role: "error",
        text: (err && err.message) || "Something went wrong.",
      });
    } finally {
      this._sending = false;
      this._render();
      const freshInput = this.shadowRoot.getElementById("input");
      if (freshInput) freshInput.focus();
    }
  }

  async _handleGeneralCommand(text) {
    const response = await this._callService("conversation", "process", {
      text,
      language: this._hass.language || "en",
    });
    const speech =
      response?.response?.speech?.plain?.speech ||
      response?.speech?.plain?.speech ||
      "(no response)";
    this._messages.push({ id: ++this._msgSeq, role: "assistant", text: speech });
  }

  // ---------- food ----------

  async _handleFoodCommand({ food, meal, quantityAbsolute, unitAbsolute, multiplier }) {
    const result = await this._callService("sparky_fitness", "search_food_choices", {
      name: food,
      limit: 5,
    });
    const choices = result?.choices || [];
    const opts = { meal, quantityAbsolute, unitAbsolute, multiplier };

    if (choices.length === 0) {
      this._messages.push({
        id: ++this._msgSeq,
        role: "error",
        text: `No loggable food found in SparkyFitness matching "${food}".`,
      });
      return;
    }
    if (choices.length === 1) {
      await this._logFoodChoice(choices[0], opts);
      return;
    }
    this._messages.push({
      id: ++this._msgSeq,
      role: "choices",
      kind: "food",
      text: `I found a few matches for "${food}" — which one did you mean?`,
      choices,
      opts,
      resolved: false,
    });
  }

  async _logFoodChoice(choice, opts) {
    const meal = opts.meal || "snacks";
    let quantity;
    let unit;
    if (opts.quantityAbsolute != null) {
      quantity = opts.quantityAbsolute;
      unit = opts.unitAbsolute || choice.serving_unit;
    } else {
      const mult = opts.multiplier || 1;
      quantity = (choice.serving_size || 100) * mult;
      unit = choice.serving_unit;
    }

    await this._callService("sparky_fitness", "log_food_choice", {
      food_id: choice.food_id,
      variant_id: choice.variant_id || undefined,
      quantity,
      unit: unit || undefined,
      meal_type: meal,
    });

    const label = choice.brand ? `${choice.name} (${choice.brand})` : choice.name;
    const qtyLabel =
      opts.quantityAbsolute != null
        ? `${quantity}${unit || ""}`
        : opts.multiplier && opts.multiplier !== 1
          ? `${opts.multiplier}x`
          : "";
    this._messages.push({
      id: ++this._msgSeq,
      role: "assistant",
      text: `Logged ${qtyLabel ? qtyLabel + " " : ""}${label} for ${meal}.`,
    });
  }

  // ---------- exercise ----------

  async _handleExerciseCommand({ exercise, duration }) {
    const result = await this._callService("sparky_fitness", "search_exercise_choices", {
      name: exercise,
      limit: 5,
    });
    const choices = result?.choices || [];
    const opts = { duration };

    if (choices.length === 0) {
      this._messages.push({
        id: ++this._msgSeq,
        role: "error",
        text: `No exercise found in SparkyFitness matching "${exercise}".`,
      });
      return;
    }
    if (choices.length === 1) {
      await this._logExerciseChoice(choices[0], opts);
      return;
    }
    this._messages.push({
      id: ++this._msgSeq,
      role: "choices",
      kind: "exercise",
      text: `I found a few matches for "${exercise}" — which one did you mean?`,
      choices,
      opts,
      resolved: false,
    });
  }

  async _logExerciseChoice(choice, opts) {
    await this._callService("sparky_fitness", "log_exercise_choice", {
      exercise_id: choice.exercise_id,
      duration_minutes: opts.duration,
    });
    this._messages.push({
      id: ++this._msgSeq,
      role: "assistant",
      text: `Logged ${choice.name} for ${opts.duration} minutes.`,
    });
  }

  // ---------- weight ----------

  async _handleWeightCommand({ value, unit }) {
    const effectiveUnit = unit || this._config.weightUnit || "lbs";
    const kg = effectiveUnit === "kg" ? value : value * LBS_TO_KG;
    const kgRounded = Math.round(kg * 10) / 10;

    await this._callService("sparky_fitness", "log_weight", {
      value: kgRounded,
    });

    const displayValue = Number.isInteger(value) ? value : value.toFixed(1);
    const suffix =
      effectiveUnit === "kg" ? "" : ` (${kgRounded} kg)`;
    this._messages.push({
      id: ++this._msgSeq,
      role: "assistant",
      text: `Logged your weight as ${displayValue} ${effectiveUnit}${suffix}.`,
    });
  }

  // ---------- shared choice-picking ----------

  async _pickChoice(msgId, choiceIdx) {
    const msg = this._messages.find((m) => m.id === msgId);
    if (!msg || msg.resolved) return;
    const choice = msg.choices[choiceIdx];
    msg.resolved = true;
    this._render();
    try {
      if (msg.kind === "exercise") {
        await this._logExerciseChoice(choice, msg.opts);
      } else {
        await this._logFoodChoice(choice, msg.opts);
      }
    } catch (err) {
      this._messages.push({
        id: ++this._msgSeq,
        role: "error",
        text: (err && err.message) || "Something went wrong logging that.",
      });
    }
    this._render();
  }
}

customElements.define("sparkyfitness-chat-card", SparkyFitnessChatCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "sparkyfitness-chat-card",
  name: "SparkyFitness Chat",
  description:
    "Type to log food/water/exercise to SparkyFitness via Assist, with pick-a-match disambiguation and quantity parsing.",
});
