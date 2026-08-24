/**
 * SparkyFitness Custom Measurements Card — a list of your active custom
 * measurement categories (blood pressure, glucose, etc.) with their latest
 * value and date, instead of separate entity rows scattered across the
 * dashboard.
 *
 * Category names are user-defined in SparkyFitness, so (unlike the other
 * SparkyFitness cards) this one can't build entity_ids from a fixed list of
 * known keys — it discovers them by scanning all of Home Assistant's
 * current entities for ones that (a) mention "sparkyfitness" in their
 * entity_id and (b) carry a `measurement_type` attribute, which only the
 * integration's custom-measurement sensors set (see
 * SparkyFitnessCustomMeasurementSensor in sensor.py). This sidesteps the
 * entity_id-prefix guessing the other cards do entirely, since it doesn't
 * need to be right about the prefix — just needs "sparkyfitness" to appear
 * somewhere in the id.
 *
 * Only categories with at least one logged value ever show up as entities
 * at all (integration v0.9.1+ skips permanently-empty placeholder
 * categories — see the README's "Custom measurements" section), so nothing
 * extra needs filtering out here.
 *
 * Install:
 *   1. Copy this file to <config>/www/sparkyfitness-measurements-card.js
 *   2. Settings -> Dashboards -> (top-right ⋮) -> Resources -> Add Resource
 *        URL:  /local/sparkyfitness-measurements-card.js
 *        Type: JavaScript Module
 *   3. Edit a dashboard -> Add Card -> search "SparkyFitness Measurements"
 *      (or add manually in YAML mode):
 *        type: custom:sparkyfitness-measurements-card
 *        title: Custom Measurements   # optional
 */

class SparkyFitnessMeasurementsCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  setConfig(config) {
    this._config = {
      title: "Custom Measurements",
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
    return {};
  }

  _escape(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  // Strips a leading "SparkyFitness " from the friendly_name for a cleaner
  // label, since the device name is baked into every entity's name.
  _labelFor(state) {
    const name = state.attributes?.friendly_name || state.entity_id;
    return name.replace(/^SparkyFitness\s+/i, "");
  }

  _discoverMeasurements() {
    if (!this._hass?.states) return [];
    return Object.values(this._hass.states)
      .filter(
        (s) =>
          s.entity_id.startsWith("sensor.") &&
          s.entity_id.includes("sparkyfitness") &&
          s.attributes?.measurement_type !== undefined
      )
      .map((s) => ({
        label: this._labelFor(s),
        value: s.state,
        unit: s.attributes?.unit_of_measurement || "",
        date: s.attributes?.measurement_date,
        unavailable: s.state === "unknown" || s.state === "unavailable",
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  _rowHtml(m) {
    return `
      <div class="row">
        <div class="row-label">${this._escape(m.label)}</div>
        <div class="row-right">
          <div class="row-value">${
            m.unavailable ? "—" : `${this._escape(m.value)}${m.unit ? ` ${this._escape(m.unit)}` : ""}`
          }</div>
          ${m.date ? `<div class="row-date">${this._escape(m.date)}</div>` : ""}
        </div>
      </div>
    `;
  }

  _render() {
    if (!this.shadowRoot || !this._hass || !this._config) return;

    const measurements = this._discoverMeasurements();

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
        .rows {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          padding: 8px 4px;
          border-bottom: 1px solid var(--divider-color, #eee);
        }
        .row:last-child { border-bottom: none; }
        .row-label { font-size: 0.95em; }
        .row-right { text-align: right; }
        .row-value { font-size: 0.95em; font-weight: 500; }
        .row-date {
          font-size: 0.75em;
          color: var(--secondary-text-color);
        }
        .empty {
          font-size: 0.9em;
          color: var(--secondary-text-color);
          padding: 20px 0;
          text-align: center;
        }
      </style>
      <ha-card>
        <div class="header">${this._escape(this._config.title)}</div>
        ${
          measurements.length === 0
            ? `<div class="empty">No custom measurement categories with logged data found.</div>`
            : `<div class="rows">${measurements.map((m) => this._rowHtml(m)).join("")}</div>`
        }
      </ha-card>
    `;
  }
}

customElements.define("sparkyfitness-measurements-card", SparkyFitnessMeasurementsCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "sparkyfitness-measurements-card",
  name: "SparkyFitness Custom Measurements",
  description: "A list of your active custom measurement categories with their latest values.",
});
