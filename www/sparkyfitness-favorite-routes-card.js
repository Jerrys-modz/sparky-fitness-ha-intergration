/**
 * SparkyFitness Favorite Routes Card — routes/loops you've run (or ridden,
 * walked, etc.) more than once, each with a best time and its most recent
 * activities, so you can track how a repeated route is trending without
 * digging through SparkyFitness's own reports.
 *
 * Calls the sparky_fitness.get_favorite_routes service (added in
 * integration v0.12.0 — update custom_components/sparky_fitness/ and
 * restart/reload HA if this card shows a "service not found" error), a thin
 * wrapper around SparkyFitness's own matched-courses report
 * (/api/exercise-stats/matched-courses), which groups activities sharing
 * the same name and shows the fastest per group.
 *
 * Entirely service-driven, like the muscle-map and measurements cards — no
 * `entity_prefix` needed.
 *
 * Install:
 *   1. Copy this file to <config>/www/sparkyfitness-favorite-routes-card.js
 *   2. Settings -> Dashboards -> (top-right ⋮) -> Resources -> Add Resource
 *        URL:  /local/sparkyfitness-favorite-routes-card.js
 *        Type: JavaScript Module
 *   3. Edit a dashboard -> Add Card -> search "SparkyFitness Favorite
 *      Routes" (or add manually in YAML mode):
 *        type: custom:sparkyfitness-favorite-routes-card
 *        title: Favorite Routes   # optional
 */

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // matches the integration's default poll interval

class SparkyFitnessFavoriteRoutesCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._routes = null;
    this._loading = false;
    this._error = null;
    this._expanded = null; // course_name currently expanded, if any
  }

  setConfig(config) {
    this._config = {
      title: "Favorite Routes",
      ...config,
    };
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      this._fetchRoutes();
      this._timer = setInterval(() => this._fetchRoutes(), REFRESH_INTERVAL_MS);
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
    return { title: "Favorite Routes" };
  }

  async _fetchRoutes() {
    if (!this._hass || this._loading) return;
    this._loading = true;
    this._error = null;
    this._render();
    try {
      const result = await this._hass.callWS({
        type: "call_service",
        domain: "sparky_fitness",
        service: "get_favorite_routes",
        service_data: {},
        return_response: true,
      });
      const response = (result && (result.response ?? result)) || {};
      this._routes = response.routes || [];
    } catch (err) {
      this._routes = [];
      this._error =
        (err && err.message) ||
        "Couldn't load favorite routes (requires integration v0.12.0+).";
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
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  _formatBestTime(seconds) {
    if (!seconds && seconds !== 0) return "";
    const totalSecs = Math.round(seconds);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
    return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
  }

  _recentActivityHtml(activity) {
    return `
      <div class="activity-row">
        <span class="activity-date">${this._escape(this._formatDate(activity.date))}</span>
        <span class="activity-dur">${activity.duration_minutes != null ? `${Math.round(activity.duration_minutes)} min` : ""}</span>
        <span class="activity-pace">${this._escape(activity.pace || "")}</span>
      </div>
    `;
  }

  _routeHtml(route) {
    const isExpanded = this._expanded === route.course_name;
    const recent = route.recent_activities || [];
    return `
      <div class="route">
        <button class="route-header" data-course="${this._escape(route.course_name)}">
          <div class="route-main">
            <div class="route-name">${this._escape(route.course_name)}</div>
            <div class="route-sub">
              ${route.activity_count} runs${route.avg_distance != null ? ` · ~${route.avg_distance} avg` : ""}
            </div>
          </div>
          <div class="route-best">
            <div class="route-best-time">${this._escape(this._formatBestTime(route.best_time_seconds))}</div>
            <div class="route-best-pace">${this._escape(route.best_pace || "")}</div>
          </div>
          <span class="chevron">${isExpanded ? "▾" : "▸"}</span>
        </button>
        ${
          isExpanded
            ? `<div class="activities">${recent.length ? recent.map((a) => this._recentActivityHtml(a)).join("") : `<div class="empty-sub">No recent activities.</div>`}</div>`
            : ""
        }
      </div>
    `;
  }

  _render() {
    if (!this.shadowRoot || !this._hass || !this._config) return;

    let body;
    if (this._error) {
      body = `<div class="empty error">${this._escape(this._error)}</div>`;
    } else if (this._loading && !this._routes) {
      body = `<div class="empty">Loading…</div>`;
    } else if (!this._routes || this._routes.length === 0) {
      body = `<div class="empty">No repeated routes yet — run the same route more than once to see it here.</div>`;
    } else {
      body = `<div class="routes">${this._routes.map((r) => this._routeHtml(r)).join("")}</div>`;
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

        .routes {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .route {
          border-radius: 12px;
          background: #26262e;
          overflow: hidden;
        }
        .route-header {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px;
          background: none;
          border: none;
          color: inherit;
          font: inherit;
          text-align: left;
          cursor: pointer;
        }
        .route-main { flex: 1; min-width: 0; }
        .route-name {
          font-size: 0.92em;
          font-weight: 600;
          color: #f2f2f4;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .route-sub {
          font-size: 0.72em;
          color: #9a9aa5;
          margin-top: 2px;
        }
        .route-best {
          flex: 0 0 auto;
          text-align: right;
        }
        .route-best-time {
          font-size: 0.92em;
          font-weight: 700;
          color: #4fc3f7;
        }
        .route-best-pace {
          font-size: 0.68em;
          color: #9a9aa5;
        }
        .chevron {
          flex: 0 0 auto;
          color: #7e9cff;
          font-size: 0.8em;
        }
        .activities {
          padding: 0 10px 10px 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .activity-row {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          font-size: 0.72em;
          color: #cfcfd6;
          background: #17171c;
          border-radius: 8px;
          padding: 5px 8px;
        }
        .activity-date { color: #9a9aa5; flex: 0 0 auto; }
        .activity-dur { flex: 1; text-align: center; }
        .activity-pace { flex: 0 0 auto; color: #4fc3f7; }
        .empty-sub {
          font-size: 0.72em;
          color: #9a9aa5;
          padding: 4px 0;
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
          <div class="subtitle">Routes you've repeated · tap for recent runs</div>
        </div>
        <div class="canvas">
          ${body}
        </div>
      </ha-card>
    `;

    this.shadowRoot.querySelectorAll(".route-header").forEach((btn) => {
      btn.addEventListener("click", () => {
        const course = btn.getAttribute("data-course");
        this._expanded = this._expanded === course ? null : course;
        this._render();
      });
    });
  }
}

customElements.define("sparkyfitness-favorite-routes-card", SparkyFitnessFavoriteRoutesCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "sparkyfitness-favorite-routes-card",
  name: "SparkyFitness Favorite Routes",
  description: "Routes you've repeated, with a best time and recent activities for each.",
});
