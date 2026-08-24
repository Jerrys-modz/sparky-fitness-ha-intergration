/**
 * SparkyFitness Weight Trend Card — a small line chart of logged weight over
 * the trend window, plus the weight_change / avg_weight_30d stats, styled
 * for this one purpose rather than a generic history-graph card.
 *
 * Uses Home Assistant's own history WebSocket API
 * (history/history_during_period) to fetch the sensor's state history
 * directly — no changes to the SparkyFitness integration were needed for
 * this card. Because the `weight` sensor "carries forward" its last logged
 * value on every poll (so it's never unknown just because you didn't weigh
 * in today — see the README), the raw history contains many repeated
 * values between real weigh-ins; this card collapses consecutive identical
 * readings into a single step so the chart reads as "value at each actual
 * weigh-in," not a few hundred flat poll points.
 *
 * Same entity-prefix convention as the other SparkyFitness cards — see
 * sparkyfitness-summary-card.js for how to find yours.
 *
 * Install:
 *   1. Copy this file to <config>/www/sparkyfitness-weight-card.js
 *   2. Settings -> Dashboards -> (top-right ⋮) -> Resources -> Add Resource
 *        URL:  /local/sparkyfitness-weight-card.js
 *        Type: JavaScript Module
 *   3. Edit a dashboard -> Add Card -> search "SparkyFitness Weight" (or
 *      add manually in YAML mode):
 *        type: custom:sparkyfitness-weight-card
 *        entity_prefix: sparkyfitness_fitness_jerrybrooke_com   # required
 *        title: Weight                                          # optional
 *        days: 30                                                # optional
 */

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // matches the integration's default poll interval

class SparkyFitnessWeightCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._history = null;
    this._loading = false;
    this._lastFetch = 0;
  }

  setConfig(config) {
    if (!config.entity_prefix) {
      throw new Error(
        "sparkyfitness-weight-card: 'entity_prefix' is required — see the card's install comment for how to find yours."
      );
    }
    this._config = {
      title: "Weight",
      days: 30,
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
    return 4;
  }

  static getStubConfig() {
    return { entity_prefix: "", days: 30 };
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
    this._render();
    try {
      const end = new Date();
      const start = new Date(end.getTime() - this._config.days * 24 * 60 * 60 * 1000);
      const result = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: [this._entityId("weight")],
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      const raw = result?.[this._entityId("weight")] || [];
      const points = [];
      for (const entry of raw) {
        const value = Number(entry.s);
        if (!isFinite(value)) continue;
        const ts = entry.lu ? entry.lu * 1000 : null;
        if (!ts) continue;
        // Collapse consecutive identical readings into one point (see file
        // header) — keeps the chart to "one point per real weigh-in."
        const prev = points[points.length - 1];
        if (prev && Math.abs(prev.value - value) < 0.01) {
          prev.ts = ts; // extend the step to the latest poll that still saw this value
          continue;
        }
        points.push({ value, ts });
      }
      this._history = points;
    } catch (err) {
      this._history = [];
      this._error = (err && err.message) || "Failed to load weight history.";
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

  _chartSvg(points) {
    const width = 300;
    const height = 100;
    const padding = 8;
    if (!points || points.length < 2) {
      return `<div class="no-data">Not enough weigh-ins yet to chart a trend.</div>`;
    }
    const values = points.map((p) => p.value);
    const times = points.map((p) => p.ts);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const spanV = maxV - minV || 1;
    const spanT = maxT - minT || 1;

    const x = (t) => padding + ((t - minT) / spanT) * (width - 2 * padding);
    const y = (v) => height - padding - ((v - minV) / spanV) * (height - 2 * padding);

    const path = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`)
      .join(" ");

    return `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="chart">
        <path d="${path}" fill="none" stroke="var(--primary-color)" stroke-width="2" vector-effect="non-scaling-stroke"/>
        <circle cx="${x(points[points.length - 1].ts).toFixed(1)}" cy="${y(
      points[points.length - 1].value
    ).toFixed(1)}" r="3" fill="var(--primary-color)"/>
      </svg>
      <div class="chart-range">
        <span>${minV.toFixed(1)}</span>
        <span>${maxV.toFixed(1)}</span>
      </div>
    `;
  }

  _render() {
    if (!this.shadowRoot || !this._hass || !this._config) return;

    const weightState = this._hass.states[this._entityId("weight")];
    const weightChangeState = this._hass.states[this._entityId("weight_change")];
    const avgWeightState = this._hass.states[this._entityId("avg_weight_30d")];

    const unit = weightState?.attributes?.unit_of_measurement || "kg";
    const currentWeight = weightState ? Number(weightState.state) : null;
    const measurementDate = weightState?.attributes?.measurement_date;

    const change = weightChangeState ? Number(weightChangeState.state) : null;
    const trend = weightChangeState?.attributes?.trend;
    const since = weightChangeState?.attributes?.since;

    const avgWeight = avgWeightState ? Number(avgWeightState.state) : null;

    const trendArrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
    const trendColor =
      trend === "up"
        ? "var(--error-color, #db4437)"
        : trend === "down"
          ? "var(--success-color, #4caf50)"
          : "var(--secondary-text-color)";

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
        .current-value {
          font-size: 1.8em;
          font-weight: 600;
        }
        .current-sub {
          font-size: 0.8em;
          color: var(--secondary-text-color);
        }
        .stats-row {
          display: flex;
          gap: 20px;
          margin-bottom: 12px;
          font-size: 0.85em;
        }
        .stat-label {
          color: var(--secondary-text-color);
          font-size: 0.85em;
        }
        .stat-value { font-weight: 500; }
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
      </style>
      <ha-card>
        <div class="header">${this._escape(this._config.title)}</div>
        <div class="current-row">
          <div>
            <div class="current-value">${
              currentWeight != null ? currentWeight.toFixed(1) : "—"
            } ${this._escape(unit)}</div>
            ${measurementDate ? `<div class="current-sub">as of ${this._escape(measurementDate)}</div>` : ""}
          </div>
          ${
            change != null
              ? `<div style="text-align:right; color:${trendColor};">
                  <div class="current-value" style="font-size:1.2em;">${trendArrow} ${Math.abs(change).toFixed(1)}</div>
                  <div class="current-sub">${since ? `since ${this._escape(since)}` : ""}</div>
                </div>`
              : ""
          }
        </div>
        ${
          avgWeight != null
            ? `<div class="stats-row"><span class="stat-label">Avg (${this._config.days}d):</span> <span class="stat-value">${avgWeight.toFixed(1)} ${this._escape(unit)}</span></div>`
            : ""
        }
        ${this._loading && !this._history ? `<div class="no-data">Loading…</div>` : this._chartSvg(this._history)}
      </ha-card>
    `;
  }
}

customElements.define("sparkyfitness-weight-card", SparkyFitnessWeightCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "sparkyfitness-weight-card",
  name: "SparkyFitness Weight Trend",
  description: "A small line chart of logged weight over the trend window, plus weight-change stats.",
});
