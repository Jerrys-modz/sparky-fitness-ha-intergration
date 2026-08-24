/**
 * SparkyFitness Muscle Map Card — a Hevy-style "Body distribution" view:
 * front/back body diagrams with worked muscle groups highlighted in blue,
 * plus a sets-per-muscle-group list below, with prev/next week navigation.
 *
 * Calls the sparky_fitness.get_muscle_group_summary service (added in
 * integration v0.10.0 — update custom_components/sparky_fitness/ and
 * restart/reload HA if this card shows a "service not found" error) once per
 * week shown. Sets are attributed to muscle groups from SparkyFitness's own
 * exercise catalog data (primary muscles get full credit per set, secondary
 * muscles half credit); exercises with no catalog muscle/category data
 * (fully custom exercises) can't be attributed to anything and are skipped —
 * same limitation Hevy itself has for unmatched custom exercises.
 *
 * The body diagram is a stylized schematic, not an anatomical render — it's
 * built from simple shapes, not a 3D model, so proportions are approximate.
 * It only covers the 17 discrete muscle groups SparkyFitness's catalog data
 * can resolve to (see the README); cardio- and full-body-only exercises
 * aren't represented since they have no single region to highlight.
 *
 * Install:
 *   1. Copy this file to <config>/www/sparkyfitness-muscle-map-card.js
 *   2. Settings -> Dashboards -> (top-right ⋮) -> Resources -> Add Resource
 *        URL:  /local/sparkyfitness-muscle-map-card.js
 *        Type: JavaScript Module
 *   3. Edit a dashboard -> Add Card -> search "SparkyFitness Muscle Map"
 *      (or add manually in YAML mode):
 *        type: custom:sparkyfitness-muscle-map-card
 *        title: Muscle Groups   # optional
 *        days: 7                # optional, size of the window shown, default 7
 */

const MUSCLE_LABELS = {
  abdominals: "Abdominals",
  abductors: "Abductors",
  adductors: "Adductors",
  biceps: "Biceps",
  calves: "Calves",
  chest: "Chest",
  forearms: "Forearms",
  glutes: "Glutes",
  hamstrings: "Hamstrings",
  lats: "Lats",
  lower_back: "Lower Back",
  upper_back: "Upper Back",
  neck: "Neck",
  quadriceps: "Quadriceps",
  shoulders: "Shoulders",
  traps: "Traps",
  triceps: "Triceps",
};

// Base silhouette — the same primitive shapes for both front and back views,
// filled with a neutral base color so unworked regions still read as a body.
const BASE_SHAPES = [
  { t: "circle", cx: 80, cy: 28, r: 20 },
  { t: "rect", x: 70, y: 46, width: 20, height: 14, rx: 4 },
  { t: "path", d: "M48,60 L112,60 L104,172 L56,172 Z" },
  { t: "rect", x: 22, y: 64, width: 22, height: 64, rx: 10 },
  { t: "rect", x: 116, y: 64, width: 22, height: 64, rx: 10 },
  { t: "rect", x: 20, y: 128, width: 18, height: 60, rx: 8 },
  { t: "rect", x: 122, y: 128, width: 18, height: 60, rx: 8 },
  { t: "rect", x: 54, y: 170, width: 52, height: 30, rx: 10 },
  { t: "rect", x: 50, y: 196, width: 28, height: 80, rx: 12 },
  { t: "rect", x: 82, y: 196, width: 28, height: 80, rx: 12 },
  { t: "rect", x: 54, y: 272, width: 20, height: 68, rx: 9 },
  { t: "rect", x: 86, y: 272, width: 20, height: 68, rx: 9 },
  { t: "ellipse", cx: 62, cy: 346, rx: 14, ry: 7 },
  { t: "ellipse", cx: 98, cy: 346, rx: 14, ry: 7 },
];

// Muscle-group overlay regions per view, drawn on top of the base
// silhouette with blue fill-opacity scaled by how many sets that muscle got.
const FRONT_REGIONS = [
  { muscle: "neck", t: "rect", x: 70, y: 46, width: 20, height: 14, rx: 4 },
  { muscle: "shoulders", t: "ellipse", cx: 36, cy: 72, rx: 15, ry: 13 },
  { muscle: "shoulders", t: "ellipse", cx: 124, cy: 72, rx: 15, ry: 13 },
  { muscle: "chest", t: "path", d: "M54,64 Q80,54 106,64 L102,104 Q80,116 58,104 Z" },
  { muscle: "biceps", t: "rect", x: 24, y: 80, width: 18, height: 44, rx: 8 },
  { muscle: "biceps", t: "rect", x: 118, y: 80, width: 18, height: 44, rx: 8 },
  { muscle: "forearms", t: "rect", x: 21, y: 130, width: 16, height: 54, rx: 7 },
  { muscle: "forearms", t: "rect", x: 123, y: 130, width: 16, height: 54, rx: 7 },
  { muscle: "abdominals", t: "rect", x: 62, y: 106, width: 36, height: 60, rx: 8 },
  { muscle: "adductors", t: "path", d: "M68,168 L92,168 L88,194 L72,194 Z" },
  { muscle: "quadriceps", t: "rect", x: 51, y: 198, width: 26, height: 72, rx: 10 },
  { muscle: "quadriceps", t: "rect", x: 83, y: 198, width: 26, height: 72, rx: 10 },
];

const BACK_REGIONS = [
  { muscle: "neck", t: "rect", x: 70, y: 46, width: 20, height: 14, rx: 4 },
  { muscle: "traps", t: "path", d: "M52,58 L80,50 L108,58 L98,88 L80,94 L62,88 Z" },
  { muscle: "shoulders", t: "ellipse", cx: 36, cy: 72, rx: 15, ry: 13 },
  { muscle: "shoulders", t: "ellipse", cx: 124, cy: 72, rx: 15, ry: 13 },
  { muscle: "lats", t: "path", d: "M40,90 L66,84 L62,140 L42,138 Z" },
  { muscle: "lats", t: "path", d: "M120,90 L94,84 L98,140 L118,138 Z" },
  { muscle: "upper_back", t: "rect", x: 66, y: 92, width: 28, height: 42, rx: 6 },
  { muscle: "lower_back", t: "rect", x: 63, y: 136, width: 34, height: 32, rx: 8 },
  { muscle: "triceps", t: "rect", x: 24, y: 80, width: 18, height: 44, rx: 8 },
  { muscle: "triceps", t: "rect", x: 118, y: 80, width: 18, height: 44, rx: 8 },
  { muscle: "forearms", t: "rect", x: 21, y: 130, width: 16, height: 54, rx: 7 },
  { muscle: "forearms", t: "rect", x: 123, y: 130, width: 16, height: 54, rx: 7 },
  { muscle: "glutes", t: "ellipse", cx: 64, cy: 182, rx: 18, ry: 16 },
  { muscle: "glutes", t: "ellipse", cx: 96, cy: 182, rx: 18, ry: 16 },
  { muscle: "abductors", t: "rect", x: 42, y: 176, width: 14, height: 36, rx: 6 },
  { muscle: "abductors", t: "rect", x: 104, y: 176, width: 14, height: 36, rx: 6 },
  { muscle: "hamstrings", t: "rect", x: 52, y: 200, width: 25, height: 68, rx: 10 },
  { muscle: "hamstrings", t: "rect", x: 83, y: 200, width: 25, height: 68, rx: 10 },
  { muscle: "calves", t: "rect", x: 55, y: 274, width: 20, height: 62, rx: 9 },
  { muscle: "calves", t: "rect", x: 85, y: 274, width: 20, height: 62, rx: 9 },
];

function shapeToSvg(shape, extraAttrs) {
  const attrs = Object.entries(extraAttrs || {})
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  switch (shape.t) {
    case "circle":
      return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" ${attrs}/>`;
    case "ellipse":
      return `<ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}" ${attrs}/>`;
    case "rect":
      return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${shape.rx || 0}" ${attrs}/>`;
    case "path":
      return `<path d="${shape.d}" ${attrs}/>`;
    default:
      return "";
  }
}

function formatDateRange(startIso, endIso) {
  if (!startIso || !endIso) return "";
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  const opts = { month: "short", day: "numeric" };
  const startStr = start.toLocaleDateString(undefined, opts);
  const endStr = end.toLocaleDateString(undefined, { ...opts, year: "numeric" });
  return `${startStr} – ${endStr}`;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Matches the integration's default poll interval, and the same refresh
// pattern the exercise-history/weight cards use. Without this, editing an
// exercise's category/muscles in SparkyFitness (or logging a new workout)
// wouldn't show up here until the popup/card happened to remount.
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

class SparkyFitnessMuscleMapCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._muscleGroups = {};
    this._totalSets = 0;
    this._startDate = null;
    this._endDate = null;
    this._loading = false;
    this._error = null;
    this._viewEndDate = null; // the end_date currently being viewed
  }

  setConfig(config) {
    this._config = {
      title: "Muscle Groups",
      days: 7,
      ...config,
    };
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      this._viewEndDate = new Date();
      this._viewEndDate.setHours(0, 0, 0, 0);
      this._fetchSummary();
      this._timer = setInterval(() => this._fetchSummary(), REFRESH_INTERVAL_MS);
    }
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer);
  }

  getCardSize() {
    return 8;
  }

  static getStubConfig() {
    return {};
  }

  _escape(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  async _fetchSummary() {
    if (!this._hass) return;
    this._loading = true;
    this._error = null;
    this._render();
    try {
      const result = await this._hass.callWS({
        type: "call_service",
        domain: "sparky_fitness",
        service: "get_muscle_group_summary",
        service_data: {
          days: this._config.days,
          end_date: isoDate(this._viewEndDate),
        },
        return_response: true,
      });
      const response = (result && (result.response ?? result)) || {};
      this._muscleGroups = response.muscle_groups || {};
      this._totalSets = response.total_sets || 0;
      this._startDate = response.start_date;
      this._endDate = response.end_date;
    } catch (err) {
      this._muscleGroups = {};
      this._totalSets = 0;
      this._error =
        (err && err.message) ||
        "Couldn't load muscle group data (requires integration v0.10.0+).";
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _shiftWeek(deltaDays) {
    const next = new Date(this._viewEndDate);
    next.setDate(next.getDate() + deltaDays);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (next > today) return; // don't page into the future
    this._viewEndDate = next;
    this._fetchSummary();
  }

  _isCurrentWeek() {
    if (!this._viewEndDate) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return isoDate(this._viewEndDate) === isoDate(today);
  }

  _maxValue() {
    const values = Object.values(this._muscleGroups);
    return values.length ? Math.max(...values) : 0;
  }

  _intensity(muscle) {
    const value = this._muscleGroups[muscle] || 0;
    if (value <= 0) return 0;
    const max = this._maxValue();
    if (max <= 0) return 0;
    return 0.35 + 0.65 * (value / max);
  }

  _renderBody(regions) {
    const base = BASE_SHAPES.map((s) => shapeToSvg(s, { class: "base-shape" })).join("");
    const overlays = regions
      .map((r) => {
        const opacity = this._intensity(r.muscle);
        return shapeToSvg(r, {
          class: "muscle-region",
          "fill-opacity": opacity.toFixed(2),
          "data-muscle": r.muscle,
        });
      })
      .join("");
    return `<svg viewBox="0 0 160 360" xmlns="http://www.w3.org/2000/svg">${base}${overlays}</svg>`;
  }

  _rowsHtml() {
    const keys = Object.keys(MUSCLE_LABELS).sort((a, b) =>
      MUSCLE_LABELS[a].localeCompare(MUSCLE_LABELS[b])
    );
    const rows = keys
      .map(
        (k) => `
        <div class="row">
          <div class="row-label">${this._escape(MUSCLE_LABELS[k])}</div>
          <div class="row-value">${this._muscleGroups[k] ? this._muscleGroups[k] : 0}</div>
        </div>`
      )
      .join("");
    return `
      <div class="row row-total">
        <div class="row-label">Total</div>
        <div class="row-value">${this._totalSets}</div>
      </div>
      ${rows}
    `;
  }

  _render() {
    if (!this.shadowRoot || !this._hass || !this._config) return;

    const dateRange = formatDateRange(this._startDate, this._endDate);
    const nextDisabled = this._isCurrentWeek();

    let body;
    if (this._error) {
      body = `<div class="empty error">${this._escape(this._error)}</div>`;
    } else if (this._loading && !this._startDate) {
      body = `<div class="empty">Loading…</div>`;
    } else {
      body = `
        <div class="bodies">
          <div class="body-col">
            ${this._renderBody(FRONT_REGIONS)}
            <div class="body-label">Front</div>
          </div>
          <div class="body-col">
            ${this._renderBody(BACK_REGIONS)}
            <div class="body-label">Back</div>
          </div>
        </div>
        <div class="rows">${this._rowsHtml()}</div>
      `;
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 16px; }
        .header {
          font-size: 1.1em;
          font-weight: 500;
          margin-bottom: 8px;
          color: var(--ha-card-header-color, var(--primary-text-color));
        }
        .nav {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          margin-bottom: 12px;
          font-size: 0.9em;
          color: var(--secondary-text-color);
        }
        .nav button {
          background: none;
          border: none;
          color: var(--primary-color);
          font-size: 1.2em;
          line-height: 1;
          cursor: pointer;
          padding: 4px 8px;
        }
        .nav button:disabled {
          color: var(--disabled-text-color, #999);
          cursor: default;
        }
        .canvas {
          background: #17171c;
          border-radius: 12px;
          padding: 12px 8px 4px;
        }
        .bodies {
          display: flex;
          justify-content: center;
          gap: 8px;
        }
        .body-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 46%;
        }
        .body-col svg {
          width: 100%;
          height: auto;
        }
        .base-shape {
          fill: #52525c;
        }
        .muscle-region {
          fill: #3ea6ff;
          transition: fill-opacity 0.3s ease;
        }
        .body-label {
          font-size: 0.75em;
          color: #9a9aa5;
          margin-top: 2px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .rows {
          margin-top: 14px;
          display: flex;
          flex-direction: column;
        }
        .row {
          display: flex;
          justify-content: space-between;
          padding: 7px 4px;
          border-bottom: 1px solid var(--divider-color, #eee);
          font-size: 0.9em;
        }
        .row:last-child { border-bottom: none; }
        .row-total {
          font-weight: 600;
          border-bottom: 1px solid var(--divider-color, #eee);
        }
        .row-value { color: var(--secondary-text-color); }
        .row-total .row-value { color: var(--primary-text-color); }
        .empty {
          font-size: 0.9em;
          color: var(--secondary-text-color);
          padding: 20px 0;
          text-align: center;
        }
        .empty.error { color: var(--error-color, #db4437); }
      </style>
      <ha-card>
        <div class="header">${this._escape(this._config.title)}</div>
        <div class="nav">
          <button id="prev-week" aria-label="Previous week">&lt;</button>
          <span>${dateRange || "—"}</span>
          <button id="next-week" aria-label="Next week" ${nextDisabled ? "disabled" : ""}>&gt;</button>
        </div>
        <div class="canvas">
          ${body}
        </div>
      </ha-card>
    `;

    const prevBtn = this.shadowRoot.getElementById("prev-week");
    const nextBtn = this.shadowRoot.getElementById("next-week");
    if (prevBtn) prevBtn.addEventListener("click", () => this._shiftWeek(-this._config.days));
    if (nextBtn) nextBtn.addEventListener("click", () => this._shiftWeek(this._config.days));
  }
}

customElements.define("sparkyfitness-muscle-map-card", SparkyFitnessMuscleMapCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "sparkyfitness-muscle-map-card",
  name: "SparkyFitness Muscle Map",
  description: "Front/back body diagram highlighting which muscle groups you worked this week, Hevy-style.",
});
