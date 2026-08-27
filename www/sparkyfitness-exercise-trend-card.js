/**
 * SparkyFitness Exercise Trend Card — pick any strength exercise and see its
 * estimated one-rep-max (1RM) progress over recent sessions: a current/best
 * 1RM summary, a change indicator since the earliest session in range, a
 * small line chart, and a list of the underlying sessions (best set +
 * volume) it was computed from.
 *
 * Calls the sparky_fitness.get_exercise_trend service (added in integration
 * v0.11.0 — update custom_components/sparky_fitness/ and restart/reload HA
 * if this card shows a "service not found" error), which resolves the typed
 * exercise name the same way log_exercise does (first search match), then
 * estimates a 1RM per session via the Epley formula (weight * (1 +
 * reps/30) — the same formula SparkyFitness's own Personal Records page
 * uses) from that exercise's recent session history. Sessions where the
 * exercise was only done for reps/bodyweight (no weight logged) don't
 * contribute a point — there's nothing to estimate a 1RM from.
 *
 * Visual style matches the sibling Exercise History / Muscle Map cards: a
 * dark "canvas" panel, labeled stat boxes, and a small SVG line chart in the
 * same technique as the Weight Trend card.
 *
 * Install:
 *   1. Copy this file to <config>/www/sparkyfitness-exercise-trend-card.js
 *   2. Settings -> Dashboards -> (top-right ⋮) -> Resources -> Add Resource
 *        URL:  /local/sparkyfitness-exercise-trend-card.js
 *        Type: JavaScript Module
 *   3. Edit a dashboard -> Add Card -> search "SparkyFitness Exercise
 *      Trend" (or add manually in YAML mode):
 *        type: custom:sparkyfitness-exercise-trend-card
 *        exercise: Bench Press   # optional — loads on start; otherwise search first
 *        sessions: 20             # optional — how many recent sessions to analyze
 *        title: Exercise Trend    # optional
 */

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // matches the integration's default poll interval

class SparkyFitnessExerciseTrendCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._trend = null;
    this._loading = false;
    this._error = null;
    this._searchValue = "";
    this._requestId = 0;
  }

  setConfig(config) {
    this._config = {
      title: "Exercise Trend",
      exercise: "",
      sessions: 20,
      ...config,
    };
    this._searchValue = this._config.exercise || this._searchValue;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      if (this._config.exercise) {
        this._fetchTrend(this._config.exercise);
      } else {
        this._render();
      }
      this._timer = setInterval(() => {
        if (this._currentExercise) this._fetchTrend(this._currentExercise);
      }, REFRESH_INTERVAL_MS);
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
    return { exercise: "", sessions: 20 };
  }

  async _fetchTrend(name) {
    if (!this._hass || !name) return;
    const requestId = ++this._requestId;
    this._loading = true;
    this._error = null;
    this._currentExercise = name;
    this._render();
    try {
      const result = await this._hass.callWS({
        type: "call_service",
        domain: "sparky_fitness",
        service: "get_exercise_trend",
        service_data: { name, sessions: this._config.sessions },
        return_response: true,
      });
      const response = (result && (result.response ?? result)) || {};
      if (requestId !== this._requestId) return;
      this._trend = response;
    } catch (err) {
      if (requestId !== this._requestId) return;
      this._trend = null;
      this._error =
        (err && err.message) ||
        "Couldn't load that exercise's trend (requires integration v0.11.0+).";
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

  _chartSvg(points) {
    const width = 300;
    const height = 90;
    const padding = 8;
    if (!points || points.length < 2) {
      return `<div class="no-data">Not enough sessions yet to chart a trend.</div>`;
    }
    const values = points.map((p) => p.estimated_one_rm);
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
        return `${i === 0 ? "M" : "L"}${x(t).toFixed(1)},${y(p.estimated_one_rm).toFixed(1)}`;
      })
      .join(" ");
    const lastT = times[times.length - 1];
    const lastV = values[values.length - 1];

    return `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="chart">
        <path d="${path}" fill="none" stroke="#3ea6ff" stroke-width="2" vector-effect="non-scaling-stroke"/>
        <circle cx="${x(lastT).toFixed(1)}" cy="${y(lastV).toFixed(1)}" r="3" fill="#3ea6ff"/>
      </svg>
      <div class="chart-range">
        <span>${minV.toFixed(1)} kg</span>
        <span>${maxV.toFixed(1)} kg</span>
      </div>
    `;
  }

  _sessionRowHtml(point) {
    return `
      <div class="row">
        <div class="date-badge">${this._escape(this._formatDate(point.date))}</div>
        <div class="row-main">
          <div class="row-top">
            <div class="row-name">${point.best_set_weight} kg × ${point.best_set_reps} reps</div>
            <div class="row-when">~${point.estimated_one_rm.toFixed(1)} kg 1RM</div>
          </div>
          <div class="row-chips">
            <span class="chip"><ha-icon icon="mdi:weight-kilogram"></ha-icon><span class="chip-value">${point.volume}</span><span class="chip-unit">kg volume</span></span>
            <span class="chip"><ha-icon icon="mdi:counter"></ha-icon><span class="chip-value">${point.total_reps}</span><span class="chip-unit">reps</span></span>
          </div>
        </div>
      </div>
    `;
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

    const trend = this._trend;
    const hasResult = !!(trend && trend.exercise_name);
    const points = (trend && trend.points) || [];
    const change = trend ? trend.change_since_first : null;
    const changePercent = trend ? trend.change_percent : null;
    const trendUp = typeof change === "number" && change > 0.05;
    const trendDown = typeof change === "number" && change < -0.05;
    const trendColor = trendUp
      ? "var(--success-color, #4caf50)"
      : trendDown
        ? "var(--error-color, #db4437)"
        : "var(--secondary-text-color)";
    const trendArrow = trendUp ? "↑" : trendDown ? "↓" : "→";

    let body;
    if (this._error) {
      body = `<div class="empty error">${this._escape(this._error)}</div>`;
    } else if (this._loading && !hasResult) {
      body = `<div class="empty">Loading…</div>`;
    } else if (!this._currentExercise) {
      body = `<div class="empty">Search an exercise above to see its one-rep-max trend.</div>`;
    } else if (hasResult && points.length === 0) {
      body = `<div class="empty">No weighted sets found for "${this._escape(trend.exercise_name)}" in the last ${this._config.sessions} sessions.</div>`;
    } else if (hasResult) {
      body = `
        <div class="summary">
          <div class="summary-box">
            <div class="summary-value">${trend.current_one_rm.toFixed(1)}</div>
            <div class="summary-label">Current 1RM (kg)</div>
          </div>
          <div class="summary-box">
            <div class="summary-value">${trend.best_one_rm.toFixed(1)}</div>
            <div class="summary-label">Best 1RM (kg)</div>
          </div>
          <div class="summary-box" style="color:${trendColor}">
            <div class="summary-value" style="color:${trendColor}">${trendArrow} ${Math.abs(change).toFixed(1)}</div>
            <div class="summary-label">${changePercent != null ? `${changePercent > 0 ? "+" : ""}${changePercent}%` : "Change"}</div>
          </div>
        </div>
        ${this._chartSvg(points)}
        <div class="rows">
          ${[...points].reverse().map((p) => this._sessionRowHtml(p)).join("")}
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
          font-size: 1.15em;
          font-weight: 700;
          color: #fff;
          line-height: 1.1;
        }
        .summary-label {
          font-size: 0.62em;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: #9a9aa5;
        }

        .chart { width: 100%; height: 90px; display: block; }
        .chart-range {
          display: flex;
          justify-content: space-between;
          font-size: 0.72em;
          color: #9a9aa5;
          margin: 2px 0 14px;
        }

        .rows {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 260px;
          overflow-y: auto;
        }
        .row {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          padding: 10px;
          border-radius: 12px;
          background: #26262e;
        }
        .date-badge {
          flex: 0 0 56px;
          font-size: 0.72em;
          font-weight: 700;
          color: #fff;
          background: #3ea6ff;
          border-radius: 10px;
          padding: 6px 4px;
          text-align: center;
        }
        .row-main { flex: 1; min-width: 0; }
        .row-top {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 8px;
          margin-bottom: 6px;
        }
        .row-name {
          font-size: 0.9em;
          font-weight: 600;
          color: #f2f2f4;
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
          color: #3ea6ff;
        }
        .chip-value { font-weight: 700; color: #fff; }
        .chip-unit { white-space: nowrap; }

        .no-data, .empty {
          font-size: 0.85em;
          color: #9a9aa5;
          padding: 20px 0;
          text-align: center;
        }
        .empty.error { color: var(--error-color, #ff6b6b); }
      </style>
      <ha-card>
        <div class="header">
          <div class="title">${this._escape(hasResult ? trend.exercise_name : this._config.title)}</div>
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
      if (value) this._fetchTrend(value);
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

customElements.define("sparkyfitness-exercise-trend-card", SparkyFitnessExerciseTrendCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "sparkyfitness-exercise-trend-card",
  name: "SparkyFitness Exercise Trend",
  description: "Search an exercise and see its estimated one-rep-max progress over recent sessions.",
});
