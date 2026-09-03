/**
 * SparkyFitness Progression Card — the "what should I lift next time"
 * feature most strength-training apps (Strong, Hevy, etc.) build in.
 * Search any strength exercise and get a suggested weight/rep target for
 * your next session, via double progression: work a weight for reps within
 * a target range, and once every working set hits the top of that range,
 * the suggestion bumps the weight and drops back to the bottom.
 *
 * Calls the sparky_fitness.get_progression_suggestion service (added in
 * integration v0.14.0 — update custom_components/sparky_fitness/ and
 * restart/reload HA if this card shows a "service not found" error), which
 * resolves the typed exercise name the same way log_exercise/
 * get_exercise_trend do (first search match), then looks at the heaviest
 * "working sets" from the most recent session(s) with a real weight logged
 * for it — lighter warm-up sets in the same session don't count toward
 * hitting the rep target.
 *
 * This is a simple, transparent heuristic — not a substitute for judgment
 * (soreness, form breakdown, deloads for other reasons, etc. aren't
 * factored in). Treat it as a starting suggestion, not an instruction.
 *
 * Visual style matches the sibling Exercise Trend card: a search bar, a
 * dark "canvas" panel, and a status badge.
 *
 * Install:
 *   1. Copy this file to <config>/www/sparkyfitness-progression-card.js
 *   2. Settings -> Dashboards -> (top-right ⋮) -> Resources -> Add Resource
 *        URL:  /local/sparkyfitness-progression-card.js
 *        Type: JavaScript Module
 *   3. Edit a dashboard -> Add Card -> search "SparkyFitness Progression"
 *      (or add manually in YAML mode):
 *        type: custom:sparkyfitness-progression-card
 *        exercise: Bench Press   # optional — loads on start; otherwise search first
 *        reps_low: 8              # optional — bottom of the target rep range
 *        reps_high: 12            # optional — top of the target rep range
 *        weight_increment: 2.5    # optional — kg to add/subtract at a time
 *        title: Progression       # optional
 */

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // matches the integration's default poll interval

const STATUS_META = {
  increase_weight: { label: "Add weight", icon: "mdi:arrow-up-bold-circle", color: "#4caf50" },
  add_reps: { label: "Add reps", icon: "mdi:repeat", color: "#3ea6ff" },
  repeat_weight: { label: "Repeat weight", icon: "mdi:refresh", color: "#f5a623" },
  deload: { label: "Deload", icon: "mdi:arrow-down-bold-circle", color: "#db4437" },
  no_data: { label: "No history yet", icon: "mdi:help-circle-outline", color: "#9a9aa5" },
};

class SparkyFitnessProgressionCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._suggestion = null;
    this._loading = false;
    this._error = null;
    this._searchValue = "";
    this._requestId = 0;
  }

  setConfig(config) {
    this._config = {
      title: "Progression",
      exercise: "",
      reps_low: 8,
      reps_high: 12,
      weight_increment: 2.5,
      ...config,
    };
    this._searchValue = this._config.exercise || this._searchValue;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      if (this._config.exercise) {
        this._fetchSuggestion(this._config.exercise);
      } else {
        this._render();
      }
      this._timer = setInterval(() => {
        if (this._currentExercise) this._fetchSuggestion(this._currentExercise);
      }, REFRESH_INTERVAL_MS);
    } else {
      this._render();
    }
  }

  disconnectedCallback() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  // Without this, a card that gets disconnected and later reconnected to
  // the DOM (some dashboard layouts do this on tab/view switches) would
  // never resume polling, since `set hass` only starts the timer once
  // (on the very first hass assignment) and reconnecting doesn't clear
  // `_hass`.
  connectedCallback() {
    if (this._hass && !this._timer) {
      this._timer = setInterval(() => {
        if (this._currentExercise) this._fetchSuggestion(this._currentExercise);
      }, REFRESH_INTERVAL_MS);
    }
  }

  getCardSize() {
    return 4;
  }

  static getStubConfig() {
    return { exercise: "", reps_low: 8, reps_high: 12, weight_increment: 2.5 };
  }

  async _fetchSuggestion(name) {
    if (!this._hass || !name) return;
    const requestId = ++this._requestId;
    // Otherwise a search for a new exercise would render the previous
    // exercise's suggestion while this one is still loading.
    if (name !== this._currentExercise) this._suggestion = null;
    this._loading = true;
    this._error = null;
    this._currentExercise = name;
    this._render();
    try {
      const result = await this._hass.callWS({
        type: "call_service",
        domain: "sparky_fitness",
        service: "get_progression_suggestion",
        service_data: {
          name,
          reps_low: this._config.reps_low,
          reps_high: this._config.reps_high,
          weight_increment: this._config.weight_increment,
        },
        return_response: true,
      });
      const response = (result && (result.response ?? result)) || {};
      if (requestId !== this._requestId) return;
      this._suggestion = response;
    } catch (err) {
      if (requestId !== this._requestId) return;
      this._suggestion = null;
      this._error =
        (err && err.message) ||
        "Couldn't load a suggestion for that exercise (requires integration v0.14.0+).";
    } finally {
      if (requestId === this._requestId) {
        this._loading = false;
        this._render();
      }
    }
  }

  _escape(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  _formatDate(iso) {
    if (!iso) return "";
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  _searchBarHtml() {
    return `
      <div class="search-bar">
        <input type="text" class="search-input" placeholder="Search an exercise, e.g. Bench Press" value="${this._escape(this._searchValue)}" />
        <button class="search-go">Go</button>
      </div>
    `;
  }

  _render() {
    if (!this.shadowRoot || !this._hass || !this._config) return;

    const suggestion = this._suggestion;
    const hasResult = !!(suggestion && suggestion.exercise_name);
    const status = hasResult ? suggestion.status : null;
    const meta = STATUS_META[status] || STATUS_META.no_data;

    let body;
    if (this._error) {
      body = `<div class="empty error">${this._escape(this._error)}</div>`;
    } else if (this._loading && !hasResult) {
      body = `<div class="empty">Loading…</div>`;
    } else if (!this._currentExercise) {
      body = `<div class="empty">Search a strength exercise above for a suggested next-session weight/reps.</div>`;
    } else if (hasResult && !suggestion.has_history) {
      body = `<div class="empty">No weighted sets logged yet for "${this._escape(suggestion.exercise_name)}" — log a session with a real weight to get a suggestion.</div>`;
    } else if (hasResult) {
      body = `
        <div class="badge-row" style="color:${meta.color}">
          <ha-icon icon="${meta.icon}"></ha-icon>
          <span class="badge-label">${meta.label}</span>
        </div>
        <div class="suggestion">
          <div class="suggestion-value">${suggestion.suggested_weight} kg × ${suggestion.suggested_reps}</div>
          <div class="suggestion-label">Suggested next session</div>
        </div>
        <div class="reasoning">${this._escape(suggestion.reasoning)}</div>
        <div class="last-row">
          <span class="last-label">Last logged (${this._escape(this._formatDate(suggestion.last_session_date))})</span>
          <span class="last-value">${suggestion.last_working_weight} kg × ${suggestion.last_working_reps}</span>
        </div>
      `;
    } else {
      body = `<div class="empty">Nothing found yet.</div>`;
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 16px; }

        .header { margin-bottom: 12px; }
        .title {
          font-size: 1.15em;
          font-weight: 600;
          color: var(--ha-card-header-color, var(--primary-text-color));
          margin-bottom: 8px;
        }
        .search-bar {
          display: flex;
          gap: 6px;
        }
        .search-input {
          flex: 1;
          min-width: 0;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid var(--divider-color, #444);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
          font: inherit;
        }
        .search-go {
          padding: 8px 14px;
          border-radius: 8px;
          border: none;
          background: var(--primary-color, #3ea6ff);
          color: #fff;
          font: inherit;
          font-weight: 600;
          cursor: pointer;
        }

        .canvas {
          background: #17171c;
          border-radius: 14px;
          padding: 14px 12px;
          margin-top: 12px;
        }

        .badge-row {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.78em;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          margin-bottom: 10px;
        }
        .badge-row ha-icon { --mdc-icon-size: 18px; }

        .suggestion {
          text-align: center;
          padding: 10px 6px 14px;
        }
        .suggestion-value {
          font-size: 1.6em;
          font-weight: 700;
          color: #fff;
        }
        .suggestion-label {
          font-size: 0.68em;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: #9a9aa5;
          margin-top: 2px;
        }

        .reasoning {
          font-size: 0.8em;
          color: #cfcfd6;
          background: #26262e;
          border-radius: 10px;
          padding: 10px;
          margin-bottom: 10px;
        }

        .last-row {
          display: flex;
          justify-content: space-between;
          font-size: 0.75em;
          color: #9a9aa5;
        }
        .last-value { font-weight: 700; color: #cfcfd6; }

        .empty {
          font-size: 0.85em;
          color: #9a9aa5;
          padding: 20px 0;
          text-align: center;
        }
        .empty.error { color: var(--error-color, #ff6b6b); }
      </style>
      <ha-card>
        <div class="header">
          <div class="title">${this._escape(hasResult ? suggestion.exercise_name : this._config.title)}</div>
          ${this._searchBarHtml()}
        </div>
        <div class="canvas">
          ${body}
        </div>
      </ha-card>
    `;

    const input = this.shadowRoot.querySelector(".search-input");
    const goBtn = this.shadowRoot.querySelector(".search-go");
    const submit = () => {
      const value = input.value.trim();
      this._searchValue = value;
      if (value) this._fetchSuggestion(value);
    };
    if (input) {
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") submit();
      });
    }
    if (goBtn) {
      goBtn.addEventListener("click", submit);
    }
  }
}

customElements.define("sparkyfitness-progression-card", SparkyFitnessProgressionCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "sparkyfitness-progression-card",
  name: "SparkyFitness Progression",
  description: "Suggests a weight/rep target for your next session of an exercise, via double progression.",
});
