/**
 * SparkyFitness Personal Records Card — a ranked list of your estimated
 * one-rep-maxes (1RM) across strength exercises, so you can see your top
 * lifts at a glance instead of digging through SparkyFitness's own reports.
 *
 * Calls the sparky_fitness.get_one_rep_maxes service (added in integration
 * v0.11.0 — update custom_components/sparky_fitness/ and restart/reload HA
 * if this card shows a "service not found" error), which is a thin wrapper
 * around SparkyFitness's own Personal Records matrix
 * (/api/exercise-stats/prs): up to 10 strength exercises, ranked by
 * estimated 1RM, using the Epley formula (weight * (1 + reps/30)) —
 * SparkyFitness's own calculation, not reimplemented here, so these numbers
 * always match what SparkyFitness itself would show.
 *
 * Entirely service-driven, like the muscle-map and measurements cards — no
 * `entity_prefix` needed.
 *
 * Install:
 *   1. Copy this file to <config>/www/sparkyfitness-personal-records-card.js
 *   2. Settings -> Dashboards -> (top-right ⋮) -> Resources -> Add Resource
 *        URL:  /local/sparkyfitness-personal-records-card.js
 *        Type: JavaScript Module
 *   3. Edit a dashboard -> Add Card -> search "SparkyFitness Personal
 *      Records" (or add manually in YAML mode):
 *        type: custom:sparkyfitness-personal-records-card
 *        title: Personal Records   # optional
 */

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // matches the integration's default poll interval

class SparkyFitnessPersonalRecordsCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._lifts = null;
    this._loading = false;
    this._error = null;
  }

  setConfig(config) {
    this._config = {
      title: "Personal Records",
      ...config,
    };
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      this._fetchLifts();
      this._timer = setInterval(() => this._fetchLifts(), REFRESH_INTERVAL_MS);
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
    return { title: "Personal Records" };
  }

  async _fetchLifts() {
    if (!this._hass || this._loading) return;
    this._loading = true;
    this._error = null;
    this._render();
    try {
      const result = await this._hass.callWS({
        type: "call_service",
        domain: "sparky_fitness",
        service: "get_one_rep_maxes",
        service_data: {},
        return_response: true,
      });
      const response = (result && (result.response ?? result)) || {};
      this._lifts = response.lifts || [];
    } catch (err) {
      this._lifts = [];
      this._error =
        (err && err.message) ||
        "Couldn't load personal records (requires integration v0.11.0+).";
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

  _formatDate(iso) {
    if (!iso) return "";
    const d = new Date(`${iso}T00:00:00`);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  _rowHtml(lift, rank) {
    const oneRm = Number(lift.estimated_one_rm);
    const weight = Number(lift.weight);
    const reps = lift.reps;
    return `
      <div class="row">
        <div class="rank">#${rank}</div>
        <div class="row-main">
          <div class="row-top">
            <div class="row-name">${this._escape(lift.exercise_name || "Exercise")}</div>
            <div class="row-value">${isFinite(oneRm) ? oneRm.toFixed(1) : "—"} <span class="unit">kg</span></div>
          </div>
          <div class="row-sub">
            ${isFinite(weight) && reps != null ? `${weight} kg × ${this._escape(reps)} reps` : ""}
            ${lift.achieved_at ? ` · ${this._escape(this._formatDate(lift.achieved_at))}` : ""}
          </div>
        </div>
      </div>
    `;
  }

  _render() {
    if (!this.shadowRoot || !this._hass || !this._config) return;

    let body;
    if (this._error) {
      body = `<div class="empty error">${this._escape(this._error)}</div>`;
    } else if (this._loading && !this._lifts) {
      body = `<div class="empty">Loading…</div>`;
    } else if (!this._lifts || this._lifts.length === 0) {
      body = `<div class="empty">No strength personal records yet — log some weighted sets to see them here.</div>`;
    } else {
      body = `<div class="rows">${this._lifts.map((l, i) => this._rowHtml(l, i + 1)).join("")}</div>`;
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 16px; }

        .header {
          margin-bottom: 4px;
        }
        .title {
          font-size: 1.15em;
          font-weight: 600;
          color: var(--ha-card-header-color, var(--primary-text-color));
        }
        .subtitle {
          font-size: 0.78em;
          color: var(--secondary-text-color);
          margin-bottom: 12px;
        }

        .canvas {
          background: #17171c;
          border-radius: 14px;
          padding: 10px 12px;
        }

        .rows {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px;
          border-radius: 12px;
          background: #26262e;
        }
        .rank {
          flex: 0 0 28px;
          text-align: center;
          font-size: 0.85em;
          font-weight: 700;
          color: #7e9cff;
        }
        .row-main { flex: 1; min-width: 0; }
        .row-top {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 8px;
        }
        .row-name {
          font-size: 0.92em;
          font-weight: 600;
          color: #f2f2f4;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .row-value {
          flex: 0 0 auto;
          font-size: 0.95em;
          font-weight: 700;
          color: #ff9f45;
        }
        .row-value .unit {
          font-size: 0.7em;
          font-weight: 500;
          color: #9a9aa5;
        }
        .row-sub {
          font-size: 0.72em;
          color: #9a9aa5;
          margin-top: 2px;
        }

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
          <div class="title">${this._escape(this._config.title)}</div>
          <div class="subtitle">Estimated one-rep max (Epley formula)</div>
        </div>
        <div class="canvas">
          ${body}
        </div>
      </ha-card>
    `;
  }
}

customElements.define("sparkyfitness-personal-records-card", SparkyFitnessPersonalRecordsCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "sparkyfitness-personal-records-card",
  name: "SparkyFitness Personal Records",
  description: "A ranked list of your estimated one-rep-maxes across strength exercises.",
});
