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
 * The body diagram is a stylized anatomical illustration (curved muscle
 * shapes with gradient shading), not a 3D model or photo — it's built from
 * SVG paths, not a rendered mesh, so proportions are approximate. It only
 * covers the 17 discrete muscle groups SparkyFitness's catalog data can
 * resolve to (see the README); cardio- and full-body-only exercises aren't
 * represented since they have no single region to highlight.
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

// Shared limb/torso path data, reused between the neutral base silhouette
// and the front/back muscle-region overlays so the overlay always lines up
// exactly with the body underneath it.
const D = {
  neck: "M90,46 L110,46 L108,60 L92,60 Z",
  torso: "M64,62 C64,57 71,54 80,54 L120,54 C129,54 136,57 136,62 L133,102 C131,136 126,158 122,172 L78,172 C74,158 69,136 67,102 Z",
  chest: "M80,56 C92,50 108,50 120,56 L118,96 C108,110 92,110 82,96 Z",
  abs: "M84,108 L116,108 L112,170 L88,170 Z",
  lUpperArm: "M46,80 C34,86 28,102 30,120 C29,134 32,146 37,156 L50,154 C48,142 47,128 47,116 C46,100 48,88 56,80 Z",
  rUpperArm: "M154,80 C166,86 172,102 170,120 C171,134 168,146 163,156 L150,154 C152,142 153,128 153,116 C154,100 152,88 144,80 Z",
  lForearm: "M37,156 L50,154 L48,204 C47,212 39,212 38,204 Z",
  rForearm: "M163,156 L150,154 L152,204 C153,212 161,212 162,204 Z",
  pelvis: "M78,172 C74,182 73,192 76,200 L124,200 C127,192 126,182 122,172 Z",
  lThigh: "M76,200 C68,210 64,232 65,258 C64,282 67,302 72,316 L98,316 C100,302 100,282 97,258 C98,232 95,210 90,200 Z",
  rThigh: "M124,200 C132,210 136,232 135,258 C136,282 133,302 128,316 L102,316 C100,302 100,282 103,258 C102,232 105,210 110,200 Z",
  lCalf: "M72,316 C68,326 67,342 70,358 C71,368 75,376 80,376 L92,376 C95,376 97,368 96,358 C97,342 96,326 94,316 Z",
  rCalf: "M128,316 C132,326 133,342 130,358 C129,368 125,376 120,376 L108,376 C105,376 103,368 104,358 C103,342 104,326 106,316 Z",
  traps: "M72,58 C86,50 114,50 128,58 L118,92 C110,98 90,98 82,92 Z",
  lLat: "M64,66 C58,82 56,102 62,120 L80,110 C77,92 77,74 82,62 Z",
  rLat: "M136,66 C142,82 144,102 138,120 L120,110 C123,92 123,74 118,62 Z",
  upperBack: "M84,94 L116,94 L112,132 L88,132 Z",
  lowerBack: "M86,132 L114,132 L112,170 L88,170 Z",
  lAbductor: "M65,206 C62,220 62,236 66,250 L78,246 C75,230 75,214 78,202 Z",
  rAbductor: "M135,206 C138,220 138,236 134,250 L122,246 C125,230 125,214 122,202 Z",
  lAdductor: "M88,200 C84,206 82,212 84,218 L116,218 C118,212 116,206 112,200 Z",
};

// Neutral silhouette — same shapes for both front and back views, filled
// with a muted gradient so unworked regions still read clearly as a body.
const BASE_SHAPES = [
  { t: "circle", cx: 100, cy: 28, r: 20 },
  { t: "path", d: D.neck },
  { t: "path", d: D.torso },
  { t: "ellipse", cx: 46, cy: 70, rx: 15, ry: 13 },
  { t: "ellipse", cx: 154, cy: 70, rx: 15, ry: 13 },
  { t: "path", d: D.lUpperArm },
  { t: "path", d: D.rUpperArm },
  { t: "path", d: D.lForearm },
  { t: "path", d: D.rForearm },
  { t: "ellipse", cx: 42, cy: 216, rx: 9, ry: 12 },
  { t: "ellipse", cx: 158, cy: 216, rx: 9, ry: 12 },
  { t: "path", d: D.pelvis },
  { t: "path", d: D.lThigh },
  { t: "path", d: D.rThigh },
  { t: "path", d: D.lCalf },
  { t: "path", d: D.rCalf },
  { t: "ellipse", cx: 80, cy: 388, rx: 14, ry: 8 },
  { t: "ellipse", cx: 120, cy: 388, rx: 14, ry: 8 },
];

// Muscle-group overlay regions per view, drawn on top of the base
// silhouette with blue fill-opacity scaled by how many sets that muscle got.
const FRONT_REGIONS = [
  { muscle: "neck", t: "path", d: D.neck },
  { muscle: "shoulders", t: "ellipse", cx: 46, cy: 70, rx: 15, ry: 13 },
  { muscle: "shoulders", t: "ellipse", cx: 154, cy: 70, rx: 15, ry: 13 },
  { muscle: "chest", t: "path", d: D.chest },
  { muscle: "biceps", t: "path", d: D.lUpperArm },
  { muscle: "biceps", t: "path", d: D.rUpperArm },
  { muscle: "forearms", t: "path", d: D.lForearm },
  { muscle: "forearms", t: "path", d: D.rForearm },
  { muscle: "abdominals", t: "path", d: D.abs },
  { muscle: "adductors", t: "path", d: D.lAdductor },
  { muscle: "quadriceps", t: "path", d: D.lThigh },
  { muscle: "quadriceps", t: "path", d: D.rThigh },
];

const BACK_REGIONS = [
  { muscle: "neck", t: "path", d: D.neck },
  { muscle: "traps", t: "path", d: D.traps },
  { muscle: "shoulders", t: "ellipse", cx: 46, cy: 70, rx: 15, ry: 13 },
  { muscle: "shoulders", t: "ellipse", cx: 154, cy: 70, rx: 15, ry: 13 },
  { muscle: "lats", t: "path", d: D.lLat },
  { muscle: "lats", t: "path", d: D.rLat },
  { muscle: "upper_back", t: "path", d: D.upperBack },
  { muscle: "lower_back", t: "path", d: D.lowerBack },
  { muscle: "triceps", t: "path", d: D.lUpperArm },
  { muscle: "triceps", t: "path", d: D.rUpperArm },
  { muscle: "forearms", t: "path", d: D.lForearm },
  { muscle: "forearms", t: "path", d: D.rForearm },
  { muscle: "glutes", t: "ellipse", cx: 86, cy: 190, rx: 17, ry: 16 },
  { muscle: "glutes", t: "ellipse", cx: 114, cy: 190, rx: 17, ry: 16 },
  { muscle: "abductors", t: "path", d: D.lAbductor },
  { muscle: "abductors", t: "path", d: D.rAbductor },
  { muscle: "hamstrings", t: "path", d: D.lThigh },
  { muscle: "hamstrings", t: "path", d: D.rThigh },
  { muscle: "calves", t: "path", d: D.lCalf },
  { muscle: "calves", t: "path", d: D.rCalf },
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

  _renderBody(regions, gradientSuffix) {
    const baseGradId = `muscleBase-${gradientSuffix}`;
    const highlightGradId = `muscleHighlight-${gradientSuffix}`;
    const base = BASE_SHAPES.map((s) => shapeToSvg(s, { class: "base-shape" })).join("");
    const overlays = regions
      .map((r) => {
        const opacity = this._intensity(r.muscle);
        // stroke-opacity MUST track fill-opacity here, not just be a fixed
        // value — otherwise every muscle region gets a fully-visible traced
        // outline even when it wasn't worked at all (fill-opacity 0), which
        // is what made every region look "outlined" regardless of data.
        return shapeToSvg(r, {
          class: "muscle-region",
          "fill-opacity": opacity.toFixed(2),
          "stroke-opacity": opacity.toFixed(2),
          "data-muscle": r.muscle,
        });
      })
      .join("");
    // gradientUnits="userSpaceOnUse" with fixed coordinates spanning the
    // whole 200x420 canvas — NOT the default objectBoundingBox — is the key
    // bit here. Without it, every individual shape (each arm segment, the
    // torso, each thigh, the pelvis...) computes its own independent
    // gradient from its own bounding box, so the shading resets at every
    // shape boundary and the body reads as a stack of separate panels
    // (like a toy action figure) instead of one continuously-lit form.
    // Sharing one gradient across all shapes makes adjoining parts blend.
    return `<svg viewBox="0 0 200 420" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${baseGradId}" gradientUnits="userSpaceOnUse" x1="20" y1="0" x2="180" y2="420">
          <stop offset="0%" stop-color="#7a7a85"/>
          <stop offset="55%" stop-color="#57575f"/>
          <stop offset="100%" stop-color="#3a3a42"/>
        </linearGradient>
        <linearGradient id="${highlightGradId}" gradientUnits="userSpaceOnUse" x1="20" y1="0" x2="180" y2="420">
          <stop offset="0%" stop-color="#7fcaff"/>
          <stop offset="55%" stop-color="#4aa8ee"/>
          <stop offset="100%" stop-color="#1f6fb8"/>
        </linearGradient>
      </defs>
      <g fill="url(#${baseGradId})" stroke="url(#${baseGradId})" stroke-width="1.25">
        ${base}
      </g>
      <g fill="url(#${highlightGradId})" stroke="url(#${highlightGradId})" stroke-width="1.25">
        ${overlays}
      </g>
    </svg>`;
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
            ${this._renderBody(FRONT_REGIONS, "front")}
            <div class="body-label">Front</div>
          </div>
          <div class="body-col">
            ${this._renderBody(BACK_REGIONS, "back")}
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
          padding: 14px 8px 4px;
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
