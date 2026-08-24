/**
 * SparkyFitness Daily Summary Card — an at-a-glance Lovelace card showing
 * today's calories, macros vs. goals, water progress, and workout status in
 * one place, instead of picking through a dozen separate entity rows.
 *
 * The SparkyFitness integration names its entities with a server-specific
 * prefix (e.g. sensor.sparkyfitness_fitness_jerrybrooke_com_calories_eaten),
 * since the hostname is baked into the entity_id to keep multiple
 * SparkyFitness servers from colliding. Rather than hardcoding one
 * installation's prefix, this card takes it as a config option and builds
 * every entity_id it needs from it — same convention the integration itself
 * uses for every sensor key (see the README's "Entities created" section).
 *
 * Install:
 *   1. Copy this file to <config>/www/sparkyfitness-summary-card.js
 *   2. Settings -> Dashboards -> (top-right ⋮) -> Resources -> Add Resource
 *        URL:  /local/sparkyfitness-summary-card.js
 *        Type: JavaScript Module
 *   3. Edit a dashboard -> Add Card -> search "SparkyFitness Summary" (or
 *      add manually in YAML mode):
 *        type: custom:sparkyfitness-summary-card
 *        entity_prefix: sparkyfitness_fitness_jerrybrooke_com   # required —
 *          the shared middle part of your SparkyFitness entity_ids; open
 *          Developer Tools -> States and look at any sparkyfitness_* sensor
 *          to find yours (e.g. sensor.sparkyfitness_fitness_jerrybrooke_com_weight
 *          -> prefix is "sparkyfitness_fitness_jerrybrooke_com").
 *        title: Today                                          # optional
 */

const SENSOR_KEYS = [
  "calories_eaten",
  "calories_burned",
  "calories_remaining",
  "calorie_goal",
  "net_calories",
  "protein_eaten",
  "protein_goal",
  "carbs_eaten",
  "carbs_goal",
  "fat_eaten",
  "fat_goal",
  "water_intake",
  "water_goal",
];

function pct(value, goal) {
  const v = Number(value);
  const g = Number(goal);
  if (!isFinite(v) || !isFinite(g) || g <= 0) return null;
  return Math.max(0, Math.min(100, (v / g) * 100));
}

class SparkyFitnessSummaryCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  setConfig(config) {
    if (!config.entity_prefix) {
      throw new Error(
        "sparkyfitness-summary-card: 'entity_prefix' is required — see the card's install comment for how to find yours."
      );
    }
    this._config = {
      title: "Today",
      ...config,
    };
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 5;
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

  _state(key) {
    const entity = this._hass?.states?.[this._entityId("sensor", key)];
    return entity ? Number(entity.state) : null;
  }

  _raw(domain, key) {
    return this._hass?.states?.[this._entityId(domain, key)];
  }

  _escape(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  _barHtml(label, value, goal, unit, colorVar) {
    const p = pct(value, goal);
    const known = value != null && !Number.isNaN(value);
    return `
      <div class="metric">
        <div class="metric-label">
          <span>${this._escape(label)}</span>
          <span class="metric-value">${known ? Math.round(value) : "—"}${
      goal != null && !Number.isNaN(goal) ? ` / ${Math.round(goal)}` : ""
    } ${unit || ""}</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${p == null ? 0 : p}%; background:${colorVar};"></div>
        </div>
      </div>
    `;
  }

  _render() {
    if (!this.shadowRoot || !this._hass || !this._config) return;

    const caloriesEaten = this._state("calories_eaten");
    const caloriesBurned = this._state("calories_burned");
    const caloriesRemaining = this._state("calories_remaining");
    const calorieGoal = this._state("calorie_goal");
    const netCalories = this._state("net_calories");

    const proteinEaten = this._state("protein_eaten");
    const proteinGoal = this._state("protein_goal");
    const carbsEaten = this._state("carbs_eaten");
    const carbsGoal = this._state("carbs_goal");
    const fatEaten = this._state("fat_eaten");
    const fatGoal = this._state("fat_goal");

    const waterIntake = this._state("water_intake");
    const waterGoal = this._state("water_goal");

    const workoutEntity = this._raw("binary_sensor", "workout_logged_today");
    const workoutOn = workoutEntity?.state === "on";
    const workoutNames = (workoutEntity?.attributes?.workout_names || []).join(", ");

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
        .calorie-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 4px;
        }
        .calorie-remaining {
          font-size: 1.8em;
          font-weight: 600;
          color: var(--primary-text-color);
        }
        .calorie-sub {
          font-size: 0.85em;
          color: var(--secondary-text-color);
          text-align: right;
        }
        .section-label {
          font-size: 0.8em;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--secondary-text-color);
          margin: 16px 0 8px;
        }
        .metric { margin-bottom: 10px; }
        .metric-label {
          display: flex;
          justify-content: space-between;
          font-size: 0.9em;
          margin-bottom: 4px;
        }
        .metric-value { color: var(--secondary-text-color); }
        .bar-track {
          height: 8px;
          border-radius: 4px;
          background: var(--divider-color, #e0e0e0);
          overflow: hidden;
        }
        .bar-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 0.3s ease;
        }
        .workout-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 16px;
          padding: 10px 12px;
          border-radius: 10px;
          background: var(--secondary-background-color, #f0f0f0);
        }
        .workout-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .workout-dot.on { background: var(--success-color, #4caf50); }
        .workout-dot.off { background: var(--disabled-color, #bdbdbd); }
        .workout-text { font-size: 0.9em; }
        .workout-sub { font-size: 0.8em; color: var(--secondary-text-color); }
      </style>
      <ha-card>
        <div class="header">${this._escape(this._config.title)}</div>

        <div class="calorie-row">
          <div>
            <div class="calorie-remaining">${
              caloriesRemaining != null ? Math.round(caloriesRemaining) : "—"
            } kcal left</div>
          </div>
          <div class="calorie-sub">
            ${caloriesEaten != null ? Math.round(caloriesEaten) : "—"} eaten
            · ${caloriesBurned != null ? Math.round(caloriesBurned) : "—"} burned
            · goal ${calorieGoal != null ? Math.round(calorieGoal) : "—"}
            ${netCalories != null ? `<br/>net ${Math.round(netCalories)}` : ""}
          </div>
        </div>

        <div class="section-label">Macros</div>
        ${this._barHtml("Protein", proteinEaten, proteinGoal, "g", "var(--state-icon-color, #7cb342)")}
        ${this._barHtml("Carbs", carbsEaten, carbsGoal, "g", "var(--warning-color, #ffa726)")}
        ${this._barHtml("Fat", fatEaten, fatGoal, "g", "var(--info-color, #42a5f5)")}

        <div class="section-label">Water</div>
        ${this._barHtml("Intake", waterIntake, waterGoal, "mL", "var(--info-color, #29b6f6)")}

        <div class="workout-row">
          <div class="workout-dot ${workoutOn ? "on" : "off"}"></div>
          <div>
            <div class="workout-text">${workoutOn ? "Workout logged today" : "No workout logged yet"}</div>
            ${workoutOn && workoutNames ? `<div class="workout-sub">${this._escape(workoutNames)}</div>` : ""}
          </div>
        </div>
      </ha-card>
    `;
  }
}

customElements.define("sparkyfitness-summary-card", SparkyFitnessSummaryCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "sparkyfitness-summary-card",
  name: "SparkyFitness Daily Summary",
  description:
    "At-a-glance card: calories, macros vs. goals, water progress, and workout status for today.",
});
