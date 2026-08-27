/**
 * SparkyFitness Cardio Records Card — a ranked list of your best times per
 * distance milestone (1k, 1 mile, 5k, 10k, 15k, half marathon, marathon),
 * one per sport group (run/ride/swim/walk/hike), so you can see your top
 * cardio efforts at a glance instead of digging through SparkyFitness's own
 * reports. The cardio counterpart to the Personal Records card's strength
 * one-rep-maxes.
 *
 * Calls the sparky_fitness.get_cardio_prs service (added in integration
 * v0.12.0 — update custom_components/sparky_fitness/ and restart/reload HA
 * if this card shows a "service not found" error), a thin wrapper around
 * SparkyFitness's own Personal Records matrix (/api/exercise-stats/prs) —
 * the same endpoint the Personal Records card reads the strength half of.
 * Records are only comparable within a sport group (a 1 km walk is slower
 * than a 1 mile run), so this groups by sport group rather than a flat list.
 *
 * Entirely service-driven, like the muscle-map and measurements cards — no
 * `entity_prefix` needed.
 *
 * Install:
 *   1. Copy this file to <config>/www/sparkyfitness-cardio-records-card.js
 *   2. Settings -> Dashboards -> (top-right ⋮) -> Resources -> Add Resource
 *        URL:  /local/sparkyfitness-cardio-records-card.js
 *        Type: JavaScript Module
 *   3. Edit a dashboard -> Add Card -> search "SparkyFitness Cardio Records"
 *      (or add manually in YAML mode):
 *        type: custom:sparkyfitness-cardio-records-card
 *        title: Cardio Records   # optional
 */

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // matches the integration's default poll interval

const SPORT_GROUP_LABELS = {
  run: "Run",
  ride: "Ride",
  swim: "Swim",
  walk: "Walk",
  hike: "Hike",
};

class SparkyFitnessCardioRecordsCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._records = null;
    this._loading = false;
    this._error = null;
  }

  setConfig(config) {
    this._config = {
      title: "Cardio Records",
      ...config,
    };
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      this._fetchRecords();
      this._timer = setInterval(() => this._fetchRecords(), REFRESH_INTERVAL_MS);
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
      this._timer = setInterval(() => this._fetchRecords(), REFRESH_INTERVAL_MS);
    }
  }

  getCardSize() {
    return 5;
  }

  static getStubConfig() {
    return { title: "Cardio Records" };
  }

  async _fetchRecords() {
    if (!this._hass || this._loading) return;
    this._loading = true;
    this._error = null;
    this._render();
    try {
      const result = await this._hass.callWS({
        type: "call_service",
        domain: "sparky_fitness",
        service: "get_cardio_prs",
        service_data: {},
        return_response: true,
      });
      const response = (result && (result.response ?? result)) || {};
      this._records = response.records || [];
    } catch (err) {
      this._records = [];
      this._error =
        (err && err.message) ||
        "Couldn't load cardio records (requires integration v0.12.0+).";
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

  _rowHtml(record) {
    const groupLabel = SPORT_GROUP_LABELS[record.sport_group] || record.sport_group || "";
    return `
      <div class="row">
        <div class="badge">${this._escape(groupLabel)}</div>
        <div class="row-main">
          <div class="row-top">
            <div class="row-name">${this._escape(record.label)}</div>
            <div class="row-value">${this._escape(record.time)}</div>
          </div>
          <div class="row-sub">
            ${record.pace ? `${this._escape(record.pace)} · ` : ""}${this._escape(record.activity_name)}
            ${record.achieved_at ? ` · ${this._escape(this._formatDate(record.achieved_at))}` : ""}
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
    } else if (this._loading && !this._records) {
      body = `<div class="empty">Loading…</div>`;
    } else if (!this._records || this._records.length === 0) {
      body = `<div class="empty">No cardio personal records yet — log a run, ride, or other distance-based activity to see them here.</div>`;
    } else {
      body = `<div class="rows">${this._records.map((r) => this._rowHtml(r)).join("")}</div>`;
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 16px; }

        .header { margin-bottom: 4px; }
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
        .badge {
          flex: 0 0 auto;
          font-size: 0.65em;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #17171c;
          background: #4fc3f7;
          border-radius: 999px;
          padding: 4px 8px;
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
          color: #4fc3f7;
        }
        .row-sub {
          font-size: 0.72em;
          color: #9a9aa5;
          margin-top: 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
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
          <div class="subtitle">Best time per distance, by sport</div>
        </div>
        <div class="canvas">
          ${body}
        </div>
      </ha-card>
    `;
  }
}

customElements.define("sparkyfitness-cardio-records-card", SparkyFitnessCardioRecordsCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "sparkyfitness-cardio-records-card",
  name: "SparkyFitness Cardio Records",
  description: "A ranked list of your best times per distance milestone, by sport.",
});
