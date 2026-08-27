/**
 * SparkyFitness Custom Measurement Trend Card — a small line chart of one
 * custom measurement category (blood pressure, glucose, etc.) over time,
 * the same treatment the Weight Trend card gives weight, since the plain
 * custom-measurement sensor only ever carries its latest value.
 *
 * Calls the sparky_fitness.get_custom_measurement_trend service (added in
 * integration v0.12.0 — update custom_components/sparky_fitness/ and
 * restart/reload HA if this card shows a "service not found" error), which
 * fetches the full logged history for one category over `days`. Only
 * numeric categories can be charted — a category whose values aren't plain
 * numbers (rare; SparkyFitness itself doesn't support a "text" custom
 * measurement type) shows a message instead of a chart.
 *
 * Install:
 *   1. Copy this file to <config>/www/sparkyfitness-custom-measurement-trend-card.js
 *   2. Settings -> Dashboards -> (top-right ⋮) -> Resources -> Add Resource
 *        URL:  /local/sparkyfitness-custom-measurement-trend-card.js
 *        Type: JavaScript Module
 *   3. Edit a dashboard -> Add Card -> search "SparkyFitness Custom
 *      Measurement Trend" (or add manually in YAML mode):
 *        type: custom:sparkyfitness-custom-measurement-trend-card
 *        category: Blood Pressure   # required — matches a category's id, display name, or name
 *        days: 30                    # optional
 *        title: Blood Pressure       # optional, defaults to the resolved category name
 */

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // matches the integration's default poll interval

class SparkyFitnessCustomMeasurementTrendCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._trend = null;
    this._loading = false;
    this._error = null;
  }

  setConfig(config) {
    if (!config.category) {
      throw new Error(
        "sparkyfitness-custom-measurement-trend-card: 'category' is required — a custom measurement category's id, display name, or name."
      );
    }
    this._config = {
      title: "",
      days: 30,
      ...config,
    };
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      this._fetchTrend();
      this._timer = setInterval(() => this._fetchTrend(), REFRESH_INTERVAL_MS);
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
      this._timer = setInterval(() => this._fetchTrend(), REFRESH_INTERVAL_MS);
    }
  }

  getCardSize() {
    return 4;
  }

  static getStubConfig() {
    return { category: "", days: 30 };
  }

  async _fetchTrend() {
    if (!this._hass) return;
    this._loading = true;
    this._error = null;
    this._render();
    try {
      const result = await this._hass.callWS({
        type: "call_service",
        domain: "sparky_fitness",
        service: "get_custom_measurement_trend",
        service_data: { category: this._config.category, days: this._config.days },
        return_response: true,
      });
      const response = (result && (result.response ?? result)) || {};
      this._trend = response;
    } catch (err) {
      this._trend = null;
      this._error =
        (err && err.message) ||
        "Couldn't load that category's trend (requires integration v0.12.0+).";
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

  _numericPoints(points) {
    return (points || [])
      .map((p) => ({ date: p.date, value: Number(p.value) }))
      .filter((p) => p.date && isFinite(p.value));
  }

  _chartSvg(points) {
    const width = 300;
    const height = 100;
    const padding = 8;
    if (!points || points.length < 2) {
      return `<div class="no-data">Not enough logged values yet to chart a trend.</div>`;
    }
    const values = points.map((p) => p.value);
    const times = points.map((p) => new Date(`${p.date}T00:00:00`).getTime());
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const spanV = maxV - minV || 1;
    const spanT = maxT - minT || 1;

    const x = (t) => padding + ((t - minT) / spanT) * (width - 2 * padding);
    const y = (v) => height - padding - ((v - minV) / spanV) * (height - 2 * padding);

    const path = points
      .map((p, i) => {
        const t = new Date(`${p.date}T00:00:00`).getTime();
        return `${i === 0 ? "M" : "L"}${x(t).toFixed(1)},${y(p.value).toFixed(1)}`;
      })
      .join(" ");
    const last = points[points.length - 1];
    const lastT = new Date(`${last.date}T00:00:00`).getTime();

    return `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="chart">
        <path d="${path}" fill="none" stroke="var(--primary-color)" stroke-width="2" vector-effect="non-scaling-stroke"/>
        <circle cx="${x(lastT).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="3" fill="var(--primary-color)"/>
      </svg>
      <div class="chart-range">
        <span>${minV.toFixed(1)}</span>
        <span>${maxV.toFixed(1)}</span>
      </div>
    `;
  }

  _render() {
    if (!this.shadowRoot || !this._hass || !this._config) return;

    const trend = this._trend;
    const categoryName = (trend && trend.category_name) || this._config.category;
    const title = this._config.title || categoryName;
    const rawPoints = (trend && trend.points) || [];
    const numericPoints = this._numericPoints(rawPoints);
    const latest = numericPoints[numericPoints.length - 1];

    let body;
    if (this._error) {
      body = `<div class="no-data error">${this._escape(this._error)}</div>`;
    } else if (this._loading && !trend) {
      body = `<div class="no-data">Loading…</div>`;
    } else if (rawPoints.length === 0) {
      body = `<div class="no-data">No values logged for "${this._escape(categoryName)}" in the last ${this._config.days} days.</div>`;
    } else if (numericPoints.length === 0) {
      body = `<div class="no-data">This category's values aren't plain numbers, so they can't be charted.</div>`;
    } else {
      body = this._chartSvg(numericPoints);
    }

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
        .current-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 12px;
        }
        .current-value { font-size: 1.8em; font-weight: 600; }
        .current-sub { font-size: 0.8em; color: var(--secondary-text-color); }
        .chart { width: 100%; height: 90px; display: block; }
        .chart-range {
          display: flex;
          justify-content: space-between;
          font-size: 0.75em;
          color: var(--secondary-text-color);
          margin-top: 2px;
        }
        .no-data {
          font-size: 0.85em;
          color: var(--secondary-text-color);
          padding: 20px 0;
          text-align: center;
        }
        .no-data.error { color: var(--error-color, #db4437); }
      </style>
      <ha-card>
        <div class="header">${this._escape(title)}</div>
        ${
          latest
            ? `<div class="current-row">
                <div>
                  <div class="current-value">${latest.value}</div>
                  <div class="current-sub">as of ${this._escape(latest.date)}</div>
                </div>
              </div>`
            : ""
        }
        ${body}
      </ha-card>
    `;
  }
}

customElements.define(
  "sparkyfitness-custom-measurement-trend-card",
  SparkyFitnessCustomMeasurementTrendCard
);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "sparkyfitness-custom-measurement-trend-card",
  name: "SparkyFitness Custom Measurement Trend",
  description: "A small line chart of one custom measurement category over time.",
});
