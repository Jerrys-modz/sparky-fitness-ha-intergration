/**
 * SparkyFitness Sleep & Fasting Card — last night's sleep (hours, score) and
 * current fasting status/progress in one small card, since neither has a
 * dedicated view otherwise.
 *
 * Same entity-prefix convention as the other SparkyFitness cards — see
 * sparkyfitness-summary-card.js for how to find yours. Reads existing
 * sensors only; no integration changes needed.
 *
 * Install:
 *   1. Copy this file to <config>/www/sparkyfitness-sleep-fasting-card.js
 *   2. Settings -> Dashboards -> (top-right ⋮) -> Resources -> Add Resource
 *        URL:  /local/sparkyfitness-sleep-fasting-card.js
 *        Type: JavaScript Module
 *   3. Edit a dashboard -> Add Card -> search "SparkyFitness Sleep" (or add
 *      manually in YAML mode):
 *        type: custom:sparkyfitness-sleep-fasting-card
 *        entity_prefix: sparkyfitness_fitness_jerrybrooke_com   # required
 *        title: Sleep & Fasting                                 # optional
 */

function formatHours(h) {
  if (h == null || Number.isNaN(h)) return "—";
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins > 0 ? `${whole}h ${mins}m` : `${whole}h`;
}

class SparkyFitnessSleepFastingCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  setConfig(config) {
    if (!config.entity_prefix) {
      throw new Error(
        "sparkyfitness-sleep-fasting-card: 'entity_prefix' is required — see the card's install comment for how to find yours."
      );
    }
    this._config = {
      title: "Sleep & Fasting",
      ...config,
    };
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 3;
  }

  static getStubConfig() {
    return { entity_prefix: "" };
  }

  // Some installs have entities split across two different entity_id
  // prefixes for the same SparkyFitness server — HA bakes a suggested
  // object_id in at entity-creation time and never rewrites it, so sensors
  // added in different integration versions can end up with different
  // prefixes even though they're all the same device. Try the configured
  // prefix first, then fall back to the bare "sparkyfitness_" prefix before
  // giving up, so this doesn't need per-entity config overrides.
  _entityId(domain, key) {
    const primary = `${domain}.${this._config.entity_prefix}_${key}`;
    if (this._hass?.states?.[primary]) return primary;
    const fallback = `${domain}.sparkyfitness_${key}`;
    if (this._hass?.states?.[fallback]) return fallback;
    return primary;
  }

  _escape(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  _render() {
    if (!this.shadowRoot || !this._hass || !this._config) return;

    const sleepHoursState = this._hass.states[this._entityId("sensor", "sleep_duration")];
    const sleepScoreState = this._hass.states[this._entityId("sensor", "sleep_score")];
    const fastingState = this._hass.states[this._entityId("binary_sensor", "fasting_active")];

    const sleepHours = sleepHoursState ? Number(sleepHoursState.state) : null;
    const sleepScore = sleepScoreState ? Number(sleepScoreState.state) : null;
    const sleepDate = sleepHoursState?.attributes?.sleep_date;

    const fastingActive = fastingState?.state === "on";
    const fastingType = fastingState?.attributes?.fasting_type;
    // Note: these attribute keys do NOT carry a "fasting_" prefix on the
    // entity itself (only fasting_type does) — see binary_sensor.py.
    const elapsedHours = Number(fastingState?.attributes?.elapsed_hours);
    const remainingHours = Number(fastingState?.attributes?.remaining_hours);
    const targetEnd = fastingState?.attributes?.target_end_time;

    const hasElapsed = !Number.isNaN(elapsedHours);
    const hasRemaining = !Number.isNaN(remainingHours);
    const totalHours = hasElapsed && hasRemaining ? elapsedHours + remainingHours : null;
    const fastingPct =
      totalHours && totalHours > 0
        ? Math.max(0, Math.min(100, (elapsedHours / totalHours) * 100))
        : null;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 16px; }
        .header {
          font-size: 1.1em;
          font-weight: 500;
          margin-bottom: 12px;
          color: var(--ha-card-header-color, var(--primary-text-color));
        }
        .section { margin-bottom: 16px; }
        .section:last-child { margin-bottom: 0; }
        .section-label {
          font-size: 0.8em;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--secondary-text-color);
          margin-bottom: 6px;
        }
        .sleep-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }
        .sleep-value {
          font-size: 1.6em;
          font-weight: 600;
        }
        .sleep-sub {
          font-size: 0.85em;
          color: var(--secondary-text-color);
          text-align: right;
        }
        .fasting-status {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 6px;
        }
        .fasting-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .fasting-dot.on { background: var(--success-color, #4caf50); }
        .fasting-dot.off { background: var(--disabled-color, #bdbdbd); }
        .bar-track {
          height: 8px;
          border-radius: 4px;
          background: var(--divider-color, #e0e0e0);
          overflow: hidden;
          margin-bottom: 4px;
        }
        .bar-fill {
          height: 100%;
          border-radius: 4px;
          background: var(--primary-color);
        }
        .fasting-sub {
          font-size: 0.8em;
          color: var(--secondary-text-color);
        }
        .no-data {
          font-size: 0.85em;
          color: var(--secondary-text-color);
        }
      </style>
      <ha-card>
        <div class="header">${this._escape(this._config.title)}</div>

        <div class="section">
          <div class="section-label">Sleep</div>
          ${
            sleepHours != null
              ? `<div class="sleep-row">
                  <div class="sleep-value">${this._escape(formatHours(sleepHours))}</div>
                  <div class="sleep-sub">${sleepScore != null ? `score ${sleepScore}` : ""}${
                  sleepDate ? `<br/>${this._escape(sleepDate)}` : ""
                }</div>
                </div>`
              : `<div class="no-data">No recent sleep data.</div>`
          }
        </div>

        <div class="section">
          <div class="section-label">Fasting</div>
          <div class="fasting-status">
            <div class="fasting-dot ${fastingActive ? "on" : "off"}"></div>
            <div>${fastingActive ? `Fasting${fastingType ? ` (${this._escape(fastingType)})` : ""}` : "Not fasting"}</div>
          </div>
          ${
            fastingActive && fastingPct != null
              ? `<div class="bar-track"><div class="bar-fill" style="width:${fastingPct}%;"></div></div>
                 <div class="fasting-sub">${formatHours(elapsedHours)} elapsed · ${formatHours(
                  remainingHours
                )} remaining${targetEnd ? ` · ends ${this._escape(new Date(targetEnd).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}` : ""}</div>`
              : ""
          }
        </div>
      </ha-card>
    `;
  }
}

customElements.define("sparkyfitness-sleep-fasting-card", SparkyFitnessSleepFastingCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "sparkyfitness-sleep-fasting-card",
  name: "SparkyFitness Sleep & Fasting",
  description: "Last night's sleep and current fasting progress in one card.",
});
