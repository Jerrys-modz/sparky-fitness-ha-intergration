/**
 * SparkyFitness Exercise History Card — a list of recent completed workouts
 * (name, duration, calories) with weekly/monthly totals, instead of picking
 * through the workout_logged_today binary_sensor's attributes (which only
 * ever cover today).
 *
 * Calls the sparky_fitness.get_exercise_history service (added in
 * integration v0.9.2 — update custom_components/sparky_fitness/ and
 * restart/reload HA if this card shows a "service not found" error), which
 * fetches one daily-summary request per day in range and reuses the exact
 * same "actually completed" filtering as workout_logged_today (skips
 * workout-plan pre-fills and the auto-synced "Active Calories" entry), so
 * this list matches what those other sensors already consider a workout.
 *
 * Same entity-prefix convention as the other SparkyFitness cards — see
 * sparkyfitness-summary-card.js for how to find yours. The prefix is only
 * used here to show the existing weekly_workouts/monthly_workouts sensor
 * totals alongside the list; the list itself comes from the service call.
 *
 * Install:
 *   1. Copy this file to <config>/www/sparkyfitness-exercise-card.js
 *   2. Settings -> Dashboards -> (top-right ⋮) -> Resources -> Add Resource
 *        URL:  /local/sparkyfitness-exercise-card.js
 *        Type: JavaScript Module
 *   3. Edit a dashboard -> Add Card -> search "SparkyFitness Exercise" (or
 *      add manually in YAML mode):
 *        type: custom:sparkyfitness-exercise-card
 *        entity_prefix: sparkyfitness_fitness_jerrybrooke_com   # required
 *        title: Recent Workouts                                # optional
 *        days: 14                                               # optional
 */

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // matches the integration's default poll interval

function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today - d) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

class SparkyFitnessExerciseCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._days = null;
    this._loading = false;
    this._error = null;
  }

  setConfig(config) {
    if (!config.entity_prefix) {
      throw new Error(
        "sparkyfitness-exercise-card: 'entity_prefix' is required — see the card's install comment for how to find yours."
      );
    }
    this._config = {
      title: "Recent Workouts",
      days: 14,
      ...config,
    };
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      this._fetchHistory();
      this._timer = setInterval(() => this._fetchHistory(), REFRESH_INTERVAL_MS);
    } else {
      this._render();
    }
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer);
  }

  getCardSize() {
    return 5;
  }

  static getStubConfig() {
    return { entity_prefix: "", days: 14 };
  }

  // Some installs have entities split across two different entity_id
  // prefixes for the same SparkyFitness server — HA bakes a suggested
  // object_id in at entity-creation time and never rewrites it, so sensors
  // added in different integration versions can end up with different
  // prefixes even though they're all the same device. Try the configured
  // prefix first, then fall back to the bare "sparkyfitness_" prefix before
  // giving up, so this doesn't need per-entity config overrides.
  _entityId(key) {
    const primary = `sensor.${this._config.entity_prefix}_${key}`;
    if (this._hass?.states?.[primary]) return primary;
    const fallback = `sensor.sparkyfitness_${key}`;
    if (this._hass?.states?.[fallback]) return fallback;
    return primary;
  }

  async _fetchHistory() {
    if (!this._hass || this._loading) return;
    this._loading = true;
    this._error = null;
    this._render();
    try {
      const result = await this._hass.callWS({
        type: "call_service",
        domain: "sparky_fitness",
        service: "get_exercise_history",
        service_data: { days: this._config.days },
        return_response: true,
      });
      const response = (result && (result.response ?? result)) || {};
      this._days = response.days || [];
    } catch (err) {
      this._days = [];
      this._error =
        (err && err.message) ||
        "Couldn't load exercise history (requires integration v0.9.2+).";
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _escape(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  _rowHtml(day) {
    const names = (day.workout_names || []).join(", ") || "Workout";
    return `
      <div class="row">
        <div class="row-date">${this._escape(formatDate(day.date))}</div>
        <div class="row-main">
          <div class="row-name">${this._escape(names)}</div>
          <div class="row-sub">${Math.round(day.total_exercise_calories || 0)} kcal · ${Math.round(
      day.total_exercise_minutes || 0
    )} min</div>
        </div>
      </div>
    `;
  }

  _render() {
    if (!this.shadowRoot || !this._hass || !this._config) return;

    const weeklyState = this._hass.states[this._entityId("weekly_workouts")];
    const monthlyState = this._hass.states[this._entityId("monthly_workouts")];

    let body;
    if (this._error) {
      body = `<div class="empty error">${this._escape(this._error)}</div>`;
    } else if (this._loading && !this._days) {
      body = `<div class="empty">Loading…</div>`;
    } else if (!this._days || this._days.length === 0) {
      body = `<div class="empty">No completed workouts in the last ${this._config.days} days.</div>`;
    } else {
      body = `<div class="rows">${this._days.map((d) => this._rowHtml(d)).join("")}</div>`;
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 16px; }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 12px;
        }
        .title {
          font-size: 1.1em;
          font-weight: 500;
          color: var(--ha-card-header-color, var(--primary-text-color));
        }
        .totals {
          font-size: 0.8em;
          color: var(--secondary-text-color);
          text-align: right;
        }
        .rows {
          display: flex;
          flex-direction: column;
          gap: 2px;
          max-height: 320px;
          overflow-y: auto;
        }
        .row {
          display: flex;
          gap: 12px;
          padding: 8px 4px;
          border-bottom: 1px solid var(--divider-color, #eee);
        }
        .row:last-child { border-bottom: none; }
        .row-date {
          flex: 0 0 84px;
          font-size: 0.85em;
          color: var(--secondary-text-color);
        }
        .row-main { flex: 1; }
        .row-name { font-size: 0.95em; }
        .row-sub {
          font-size: 0.8em;
          color: var(--secondary-text-color);
        }
        .empty {
          font-size: 0.9em;
          color: var(--secondary-text-color);
          padding: 20px 0;
          text-align: center;
        }
        .empty.error { color: var(--error-color, #db4437); }
      </style>
      <ha-card>
        <div class="header">
          <div class="title">${this._escape(this._config.title)}</div>
          <div class="totals">
            ${weeklyState ? `${weeklyState.state} this week` : ""}
            ${monthlyState ? ` · ${monthlyState.state} this month` : ""}
          </div>
        </div>
        ${body}
      </ha-card>
    `;
  }
}

customElements.define("sparkyfitness-exercise-card", SparkyFitnessExerciseCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "sparkyfitness-exercise-card",
  name: "SparkyFitness Exercise History",
  description: "A list of recent completed workouts with weekly/monthly totals.",
});
