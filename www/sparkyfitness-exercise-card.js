/**
 * SparkyFitness Exercise History Card — a list of recent completed workouts
 * (name, duration, calories) with weekly/monthly totals, instead of picking
 * through the workout_logged_today binary_sensor's attributes (which only
 * ever cover today).
 *
 * Visual style matches the sibling Muscle Map card's Hevy-inspired look:
 * a dark "canvas" panel with a M/T/W/T/F/S/S day-picker strip (today
 * highlighted in a solid circle, workout days marked with a dot) up top,
 * labeled summary stat boxes, then each day as a rounded row with an
 * icon-labeled date badge and clearly labeled stat chips (🔥 calories,
 * ⏱ duration, # sets) instead of a plain "·"-separated text line.
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

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

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

function formatWeekRange(days7) {
  if (!days7.length) return "";
  const start = new Date(`${days7[0].date}T00:00:00`);
  const end = new Date(`${days7[days7.length - 1].date}T00:00:00`);
  const opts = { month: "short", day: "numeric" };
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, { ...opts, year: "numeric" })}`;
}

class SparkyFitnessExerciseCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._days = null;
    this._loading = false;
    this._error = null;
    this._selectedDate = null;
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
    return 7;
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

  _hasWorkout(day) {
    return !!(
      (day.workout_names && day.workout_names.length) ||
      (day.total_exercise_minutes || 0) > 0 ||
      (day.total_exercise_calories || 0) > 0
    );
  }

  // Small labeled pill: icon + value + unit/label, e.g. "🔥 320 kcal burned".
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

  // Day-picker strip — the M/T/W/T/F/S/S row from the reference Hevy
  // screen, scoped to the most recent 7 days of the fetched range. Today
  // gets a solid highlight circle; days with a completed workout get a
  // small dot; tapping a day scrolls/highlights that row in the list below.
  _dayPickerHtml(week) {
    const todayIso = isoDate(new Date());
    return `
      <div class="week-nav">
        <span>${this._escape(formatWeekRange(week))}</span>
      </div>
      <div class="day-picker">
        ${week
          .map((d) => {
            const isToday = d.date === todayIso;
            const isSelected = d.date === this._selectedDate;
            const worked = this._hasWorkout(d);
            const cls = ["day-pill"];
            if (isToday) cls.push("today");
            if (isSelected) cls.push("selected");
            return `
              <button class="${cls.join(" ")}" data-date="${this._escape(d.date)}">
                <span class="day-dow">${this._escape(weekdayShort(d.date))}</span>
                <span class="day-num">${this._escape(dayNum(d.date))}</span>
                <span class="day-dot" style="visibility:${worked ? "visible" : "hidden"}"></span>
              </button>
            `;
          })
          .join("")}
      </div>
    `;
  }

  _rowHtml(day) {
    const names = (day.workout_names || []).join(", ") || "Workout";
    const kcal = Math.round(day.total_exercise_calories || 0);
    const mins = Math.round(day.total_exercise_minutes || 0);
    const count = day.workout_names ? day.workout_names.length : 0;
    const isSelected = day.date === this._selectedDate;
    return `
      <div class="row${isSelected ? " row-selected" : ""}" data-date="${this._escape(day.date)}">
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
            ${this._statChip("mdi:fire", kcal, "kcal burned", "#ff9f45")}
            ${this._statChip("mdi:clock-outline", mins, "min", "#4fc3f7")}
            ${count > 1 ? this._statChip("mdi:dumbbell", count, "workouts", "#7e9cff") : ""}
          </div>
        </div>
      </div>
    `;
  }

  _render() {
    if (!this.shadowRoot || !this._hass || !this._config) return;

    const weeklyState = this._hass.states[this._entityId("weekly_workouts")];
    const monthlyState = this._hass.states[this._entityId("monthly_workouts")];

    const rangeDays = this._days || [];
    // Service returns most-recent-first; the day-picker wants chronological
    // order for its last-7-days strip.
    const chronological = [...rangeDays].reverse();
    const week = chronological.slice(-7);

    const totalWorkouts = rangeDays.filter((d) => this._hasWorkout(d)).length;
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
      const list = this._selectedDate
        ? rangeDays.filter((d) => d.date === this._selectedDate)
        : rangeDays;
      body = list.length
        ? `<div class="rows">${list.map((d) => this._rowHtml(d)).join("")}</div>`
        : `<div class="empty">No workout logged that day.</div>`;
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

        /* Weekly / monthly badges from the integration's own trend sensors. */
        .badges {
          display: flex;
          gap: 6px;
          margin-bottom: 12px;
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

        /* Dark canvas panel — matches the Muscle Map card so the two feel
           like one visual family, styled after Hevy's dark UI. */
        .canvas {
          background: #17171c;
          border-radius: 14px;
          padding: 14px 12px;
        }

        .week-nav {
          text-align: center;
          font-size: 0.8em;
          color: #9a9aa5;
          margin-bottom: 10px;
        }

        .day-picker {
          display: flex;
          justify-content: space-between;
          gap: 4px;
          margin-bottom: 16px;
        }
        .day-pill {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          background: #26262e;
          border: none;
          border-radius: 10px;
          padding: 8px 2px 7px;
          color: #cfcfd6;
          font: inherit;
          cursor: pointer;
        }
        .day-pill .day-dow {
          font-size: 0.62em;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: #83838e;
        }
        .day-pill .day-num { font-size: 0.95em; font-weight: 600; }
        .day-pill .day-dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: #3ea6ff;
          margin-top: 1px;
        }
        .day-pill.today {
          background: #3ea6ff;
          color: #fff;
        }
        .day-pill.today .day-dow { color: rgba(255,255,255,0.85); }
        .day-pill.today .day-dot { background: #fff; }
        .day-pill.selected:not(.today) {
          box-shadow: inset 0 0 0 1.5px #3ea6ff;
        }

        /* Summary stat row — labeled totals for the whole range, like the
           "Total / Sets" line at the top of Hevy's body-distribution list. */
        .summary {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
        }
        .summary-box {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding: 10px 6px;
          border-radius: 12px;
          background: #26262e;
        }
        .summary-value {
          font-size: 1.3em;
          font-weight: 700;
          color: #fff;
          line-height: 1.1;
        }
        .summary-label {
          font-size: 0.65em;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: #9a9aa5;
        }

        .rows {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 340px;
          overflow-y: auto;
        }
        .row {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          padding: 10px;
          border-radius: 12px;
          background: #26262e;
          transition: background 0.15s ease;
        }
        .row:hover { background: #2e2e38; }
        .row-selected { box-shadow: inset 0 0 0 1.5px #3ea6ff; }

        .date-badge {
          flex: 0 0 42px;
          height: 42px;
          border-radius: 10px;
          background: #3ea6ff;
          color: #fff;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }
        .date-dow {
          font-size: 0.58em;
          opacity: 0.85;
          text-transform: uppercase;
          margin-bottom: 2px;
        }
        .date-num { font-size: 0.95em; font-weight: 700; }

        .row-main { flex: 1; min-width: 0; }
        .row-top {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 8px;
          margin-bottom: 6px;
        }
        .row-name {
          font-size: 0.92em;
          font-weight: 600;
          color: #f2f2f4;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .row-when {
          flex: 0 0 auto;
          font-size: 0.72em;
          color: #9a9aa5;
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
          font-size: 0.72em;
          color: #cfcfd6;
          background: #17171c;
          border: 1px solid #34343e;
          border-radius: 999px;
          padding: 2px 8px 2px 6px;
        }
        .chip ha-icon {
          --mdc-icon-size: 13px;
          color: var(--chip-color, #3ea6ff);
        }
        .chip-value { font-weight: 700; color: #fff; }
        .chip-unit { white-space: nowrap; }

        .empty {
          font-size: 0.9em;
          color: #9a9aa5;
          padding: 24px 0;
          text-align: center;
        }
        .empty.error { color: var(--error-color, #ff6b6b); }
      </style>
      <ha-card>
        <div class="header">
          <div>
            <div class="title">${this._escape(this._config.title)}</div>
            <div class="subtitle">Last ${this._config.days} days${this._selectedDate ? " · tap the day again to clear" : ""}</div>
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

        <div class="canvas">
          ${week.length ? this._dayPickerHtml(week) : ""}

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

          ${body}
        </div>
      </ha-card>
    `;

    this.shadowRoot.querySelectorAll(".day-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const date = btn.getAttribute("data-date");
        this._selectedDate = this._selectedDate === date ? null : date;
        this._render();
      });
    });
  }
}

customElements.define("sparkyfitness-exercise-card", SparkyFitnessExerciseCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "sparkyfitness-exercise-card",
  name: "SparkyFitness Exercise History",
  description: "A list of recent completed workouts with weekly/monthly totals.",
});
