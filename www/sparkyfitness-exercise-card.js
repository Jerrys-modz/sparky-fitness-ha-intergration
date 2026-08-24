/**
 * SparkyFitness Exercise History Card — a list of recent completed workouts
 * (name, duration, calories) with weekly/monthly totals, instead of picking
 * through the workout_logged_today binary_sensor's attributes (which only
 * ever cover today).
 *
 * Visual style is modeled after Hevy's workout history / body-distribution
 * screens: a row of labeled summary stat chips up top, then each day as a
 * rounded card with an icon-labeled date badge and clearly labeled stat
 * chips (🔥 calories, ⏱ duration, # sets) instead of a plain "·"-separated
 * text line.
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
 *        entity_prefix: sparkyfitness   # required
 *        title: Recent Workouts          # optional
 *        days: 14                        # optional
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

function dayNum(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.getDate();
}

function weekdayShort(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 1).toUpperCase();
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
    return 6;
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

  // Small labeled pill: icon + value + unit/label, e.g. "🔥 320 kcal".
  // Always paired with a label so the number is never shown bare.
  _statChip(icon, value, unit, color) {
    return `
      <span class="chip" style="--chip-color:${color}">
        <ha-icon icon="${icon}"></ha-icon>
        <span class="chip-value">${this._escape(value)}</span>
        <span class="chip-unit">${this._escape(unit)}</span>
      </span>
    `;
  }

  _rowHtml(day) {
    const names = (day.workout_names || []).join(", ") || "Workout";
    const kcal = Math.round(day.total_exercise_calories || 0);
    const mins = Math.round(day.total_exercise_minutes || 0);
    const count = day.workout_names ? day.workout_names.length : 0;
    return `
      <div class="row">
        <div class="date-badge">
          <div class="date-dow">${this._escape(weekdayShort(day.date))}</div>
          <div class="date-num">${this._escape(dayNum(day.date))}</div>
        </div>
        <div class="row-main">
          <div class="row-top">
            <div class="row-name">${this._escape(names)}</div>
            <div class="row-when">${this._escape(formatDate(day.date))}</div>
          </div>
          <div class="row-chips">
            ${this._statChip("mdi:fire", kcal, "kcal burned", "var(--warning-color, #ff9800)")}
            ${this._statChip("mdi:clock-outline", mins, "min", "var(--info-color, #039be5)")}
            ${
              count > 1
                ? this._statChip("mdi:dumbbell", count, "workouts", "var(--primary-color)")
                : ""
            }
          </div>
        </div>
      </div>
    `;
  }

  _render() {
    if (!this.shadowRoot || !this._hass || !this._config) return;

    const weeklyState = this._hass.states[this._entityId("weekly_workouts")];
    const monthlyState = this._hass.states[this._entityId("monthly_workouts")];

    // Range totals, labeled clearly — mirrors the "Total" row Hevy shows
    // above its per-muscle breakdown.
    const rangeDays = this._days || [];
    const totalWorkouts = rangeDays.filter(
      (d) => (d.workout_names && d.workout_names.length) || (d.total_exercise_minutes || 0) > 0
    ).length;
    const totalKcal = Math.round(
      rangeDays.reduce((sum, d) => sum + (d.total_exercise_calories || 0), 0)
    );
    const totalMins = Math.round(
      rangeDays.reduce((sum, d) => sum + (d.total_exercise_minutes || 0), 0)
    );

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
          font-size: 1.15em;
          font-weight: 600;
          color: var(--ha-card-header-color, var(--primary-text-color));
        }
        .subtitle {
          font-size: 0.8em;
          color: var(--secondary-text-color);
        }

        /* Summary stat row — labeled totals for the whole range, like the
           "Total / Sets" line at the top of Hevy's body-distribution list. */
        .summary {
          display: flex;
          gap: 8px;
          margin-bottom: 14px;
        }
        .summary-box {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding: 10px 6px;
          border-radius: 12px;
          background: var(--secondary-background-color, rgba(127,127,127,0.08));
        }
        .summary-value {
          font-size: 1.3em;
          font-weight: 700;
          color: var(--primary-text-color);
          line-height: 1.1;
        }
        .summary-label {
          font-size: 0.7em;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: var(--secondary-text-color);
        }

        /* Weekly / monthly badges from the integration's own trend sensors. */
        .badges {
          display: flex;
          gap: 6px;
          margin-bottom: 14px;
          flex-wrap: wrap;
        }
        .badge {
          font-size: 0.75em;
          color: var(--secondary-text-color);
          background: var(--secondary-background-color, rgba(127,127,127,0.08));
          border-radius: 999px;
          padding: 3px 10px;
        }
        .badge b { color: var(--primary-text-color); font-weight: 600; }

        .rows {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 360px;
          overflow-y: auto;
        }
        .row {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          padding: 10px;
          border-radius: 12px;
          background: var(--secondary-background-color, rgba(127,127,127,0.06));
          transition: background 0.15s ease;
        }
        .row:hover {
          background: var(--divider-color, rgba(127,127,127,0.14));
        }

        .date-badge {
          flex: 0 0 44px;
          height: 44px;
          border-radius: 10px;
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }
        .date-dow {
          font-size: 0.6em;
          opacity: 0.85;
          text-transform: uppercase;
          margin-bottom: 2px;
        }
        .date-num { font-size: 1em; font-weight: 700; }

        .row-main { flex: 1; min-width: 0; }
        .row-top {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 8px;
          margin-bottom: 6px;
        }
        .row-name {
          font-size: 0.95em;
          font-weight: 600;
          color: var(--primary-text-color);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .row-when {
          flex: 0 0 auto;
          font-size: 0.75em;
          color: var(--secondary-text-color);
        }

        .row-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 0.75em;
          color: var(--secondary-text-color);
          background: var(--card-background-color);
          border: 1px solid var(--divider-color, rgba(127,127,127,0.2));
          border-radius: 999px;
          padding: 2px 8px 2px 6px;
        }
        .chip ha-icon {
          --mdc-icon-size: 14px;
          color: var(--chip-color, var(--primary-color));
        }
        .chip-value {
          font-weight: 700;
          color: var(--primary-text-color);
        }
        .chip-unit { white-space: nowrap; }

        .empty {
          font-size: 0.9em;
          color: var(--secondary-text-color);
          padding: 24px 0;
          text-align: center;
        }
        .empty.error { color: var(--error-color, #db4437); }
      </style>
      <ha-card>
        <div class="header">
          <div>
            <div class="title">${this._escape(this._config.title)}</div>
            <div class="subtitle">Last ${this._config.days} days</div>
          </div>
        </div>

        <div class="summary">
          <div class="summary-box">
            <div class="summary-value">${totalWorkouts}</div>
            <div class="summary-label">Workouts</div>
          </div>
          <div class="summary-box">
            <div class="summary-value">${totalKcal.toLocaleString()}</div>
            <div class="summary-label">Kcal burned</div>
          </div>
          <div class="summary-box">
            <div class="summary-value">${totalMins.toLocaleString()}</div>
            <div class="summary-label">Minutes</div>
          </div>
        </div>

        ${
          weeklyState || monthlyState
            ? `<div class="badges">
                ${weeklyState ? `<span class="badge"><b>${this._escape(weeklyState.state)}</b> workouts this week</span>` : ""}
                ${monthlyState ? `<span class="badge"><b>${this._escape(monthlyState.state)}</b> workouts this month</span>` : ""}
              </div>`
            : ""
        }

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
