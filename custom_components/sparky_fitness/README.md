# SparkyFitness for Home Assistant

A custom integration that polls a self-hosted [SparkyFitness](https://github.com/CodeWithCJ/SparkyFitness)
server and exposes your fitness/nutrition/wellness data as Home Assistant sensors,
plus several write-back services, so it can appear on dashboards and drive
automations in both directions.

There's no official SparkyFitness integration. This uses the same Personal API Key
that powers SparkyFitness's own MCP server and mobile app, against endpoints
confirmed directly from SparkyFitness's server source (its published API docs don't
always match the real field names/behavior).

## Entities created

Per configured server, one device with:

### Nutrition (today)
- Calories eaten / burned / remaining / goal / net / goal progress (%)
- Protein / carbs / fat eaten (g) — summed from today's food log the same way
  SparkyFitness sums calories (per-entry, scaled by quantity/serving size)
- Protein / carbs / fat / water goals (prefers your adjusted/TDEE goal for the day
  over the flat stored goal, same precedence SparkyFitness itself uses)
- Water intake (mL)
- BMR (with a `source` attribute: `formula` or `external`)
- Food entries logged today (count)

### Exercise
- Step calories, steps (resets daily; `unknown` if nothing logged today)
- Exercise sessions logged today (count — includes auto-synced wearable activity)
- **`binary_sensor.workout_logged_today`** — on/off "did I actually work out," with
  `workout_names`, `workout_count`, `total_exercise_calories`,
  `total_exercise_minutes` attributes. Excludes SparkyFitness's auto-created
  "Active Calories" wearable-sync entries — see note below. Also excludes
  workout-plan sessions that are only scheduled/pre-filled for today and
  haven't actually been started (SparkyFitness pre-populates the diary ahead
  of time if you're on an active plan; a session only counts as done once at
  least one of its sets has actually been checked off).
- **Weekly exercise stats** (rolling 7 days, from SparkyFitness's own
  exercise-dashboard report): weekly workouts, weekly volume (kg, with a
  `by_muscle_group` breakdown attribute), weekly reps, workout streak / longest
  streak (with a `weekly_frequency` attribute) — the streak calc is SparkyFitness's
  own and already excludes "Active Calories" the same way `workout_logged_today` does.
  Unlike `workout_logged_today`, this comes pre-aggregated from SparkyFitness with
  no set-level completion data, so it can't apply the same "actually started"
  filter — see Limitations below if you're on an active workout plan.
- **Monthly exercise stats** — the same exercise-dashboard report as above, but
  fetched over the full trend window (30 days by default, configurable) instead
  of a fixed 7 days: monthly workouts, monthly volume (kg), monthly reps. Distinct
  entities from the weekly ones so you can compare "this week" vs. "this month" at
  a glance; workout streak isn't duplicated here since it's already an all-time
  running count regardless of which window's report it's read from.

### Body measurements
- Weight (kg), body fat (%), BMI — carried forward from your most recently logged
  check-in rather than requiring a fresh entry every day (these don't change
  daily); each has a `measurement_date` attribute showing how current it is.
  BMI is computed by this integration (weight/height² — SparkyFitness's API
  doesn't return a BMI value at all).
- **Weight change** over the trend window (30 days by default, configurable —
  see Options below), with `trend` (`up`/`down`/`steady`) and `since` (the date of
  the oldest sample used) attributes.
- **Custom measurements** — one sensor per custom measurement category you've
  defined in SparkyFitness (blood pressure, glucose, etc.), named after the
  category, showing its most recent value within the trend window. Created
  dynamically from whatever categories exist when the integration starts —
  a category added later needs Settings → Devices & Services → SparkyFitness →
  **Reload** to pick up.
  A category is skipped entirely (no sensor created) if it has never had a
  value logged **and** was never assigned a real unit — SparkyFitness marks
  unused categories with `measurement_type: "N/A"`. This is what a
  wearable/health-app sync into SparkyFitness typically leaves behind:
  placeholder categories (e.g. `active_calories`, `heart_rate`) it created
  but never actually populated, which would otherwise sit at "unknown"
  forever. A category with a real unit but simply no *recent* entry still
  gets a sensor — that's a metric you actively use, not dead clutter.
- **Adaptive TDEE** — SparkyFitness's rolling calorie-burn estimate derived from
  your actual logged weight and intake over time (distinct from `bmr`, which is
  a formula-based estimate). Has `confidence` (`HIGH`/`MEDIUM`/`LOW`),
  `is_fallback`, `fallback_reason`, and `days_of_data` attributes — SparkyFitness
  falls back to a formula estimate until you have enough history, so check
  `is_fallback` before relying on the value.

### Trends & streak
- Average calories, 7-day and 30-day (rolling, includes non-logged days as 0 in
  the average — i.e. "average calories per day this week/month")
- Logging streak (consecutive days with something logged; doesn't break just
  because you haven't logged *today* yet)
- **30-day macro averages** — average protein/carbs/fat per day over the last 30
  calendar days, same "non-logged days count as 0" convention as the calorie
  averages above (so it reads as "your daily average this month," not "average
  on days you happened to log").
- **Logging consistency (30 day)** — % of the last 30 calendar days with at
  least one food entry. A steadier signal than the streak sensor for "how
  consistent have I actually been," since one missed day resets the streak to
  zero but barely dents this percentage.
- **Average weight (30 day)** — mean of every weight check-in logged within the
  last 30 days (simple average of whatever weigh-ins exist, not weighted by
  day — weigh-ins are naturally sparser than food logging). Distinct from
  `weight_change`, which compares the *first vs. last* logged value in the
  trend window rather than averaging all of them.

### Sleep, mood, fasting
- Sleep duration (hours) and sleep score, from the most recent sleep entry in the
  last 2 days (works whether your tracker/you log sleep under the bedtime date or
  the wake-up date)
- Mood (SparkyFitness's numeric mood rating for today), with `tags` and `notes`
  attributes
- **`binary_sensor.fasting_active`** — on while a fast is in progress, with
  `fasting_type`, `start_time`, `target_end_time`, `elapsed_hours`,
  `remaining_hours` attributes

### Write-back
- **`button.log_glass_of_water`** — one tap logs your actual preferred water
  container size (read from SparkyFitness's Settings → Water Containers →
  primary container; falls back to 2000 mL, SparkyFitness's own default, if
  you haven't set one). Has `container_name` and `container_volume_ml`
  attributes so you can see what a tap will log before pressing it. For a
  one-off different amount, use the `sparky_fitness.log_water` service instead.
- **`sparky_fitness.log_water`** service — log any water amount (mL)
- **`sparky_fitness.log_weight`** service — log a weight reading (kg)
- **`sparky_fitness.log_food`** service — search SparkyFitness's food database by
  name (e.g. "banana") and log the closest match for today; takes optional `meal_type`
  (must match a meal type name in your account, default `snacks`) and `servings`
  (multiplier on the default serving, default 1). Returns what was actually logged.
- **`sparky_fitness.log_exercise`** service — search SparkyFitness's exercise database
  by name (e.g. "running") and log it for today with the given `duration_minutes`;
  SparkyFitness calculates calories burned from the matched exercise's calorie rate.
- **`sparky_fitness.search_food_choices`** service — read-only food search that
  returns up to `limit` candidates instead of logging anything, so a caller (like
  the chat card below) can show "did you mean X, Y, or Z?" before committing.
- **`sparky_fitness.log_food_choice`** service — logs one specific food entry by
  `food_id`/`variant_id` (from `search_food_choices`), bypassing search entirely —
  the follow-up half of picking a disambiguated match.
- **`sparky_fitness.search_exercise_choices`** / **`sparky_fitness.log_exercise_choice`**
  services — the same search-then-pick pattern as food, for exercises.
- **`sparky_fitness.get_exercise_history`** service — read-only, on-demand list of
  recent completed workouts over `days` (default 14), for the exercise-history
  card below. Fetches one daily-summary request per day in range, so it's meant
  to be called when a card loads/refreshes rather than on the regular poll cycle.
- **`sparky_fitness.get_muscle_group_summary`** service — read-only, on-demand
  sets-per-muscle-group breakdown for the muscle-map card below, over a `days`
  (default 7) window ending at `end_date` (default today — pass an earlier date
  to page back a previous week). Sets are attributed from SparkyFitness's own
  exercise catalog data: primary muscles get full credit per set, secondary
  muscles get half credit, and an exercise falls back to its broad `category`
  (e.g. "Chest") if it has no per-muscle catalog data at all. Exercises with
  neither — fully custom, uncataloged exercises — can't be attributed to
  anything and are silently skipped, the same limitation apps like Hevy have
  for unmatched custom exercises. Reuses the same "actually completed" /
  auto-sync-exclusion rules as `workout_logged_today`.
- **`sparky_fitness.get_exercise_trend`** service — read-only, on-demand
  one-rep-max (1RM) trend for a single exercise, for the exercise-trend card
  below. Resolves the given `name` to an exercise the same way `log_exercise`
  does (first search match), then estimates a 1RM per session — via the
  Epley formula, `weight * (1 + reps/30)` — from its last `sessions` (default
  20, workouts not calendar days) sessions. `/api/v2/exercise-entries/history`
  is already server-filtered to sessions containing that exercise, so this is
  a single request regardless of how far back those sessions fall.
- **`sparky_fitness.get_one_rep_maxes`** service — read-only current
  estimated 1RMs across all strength exercises, for the personal-records
  card below. A thin wrapper around SparkyFitness's own Personal Records
  matrix (`/api/exercise-stats/prs`) — up to 10 exercises, ranked by
  estimated 1RM, using SparkyFitness's own Epley-formula calculation rather
  than a reimplementation, so the numbers always match SparkyFitness itself.

### Chat card (optional)

A custom Lovelace card (`sparkyfitness-chat-card.js`, shipped alongside this
integration) gives you a chat-style box for typing things like "I ate a
banana", "log 150g of chicken", "log my weight as 175", or "log running for 30
minutes" instead of using a voice assistant. Food and exercise commands go
through `search_food_choices`/`search_exercise_choices` and show clickable
options when there's more than one match — picking one calls `log_food_choice`
/ `log_exercise_choice` with that exact match. Food quantities are understood
two ways: "log 150g of chicken" (an absolute amount, overriding the default
serving) or "log 2 bananas" (a plain multiplier on the default serving).
Weight commands ("log my weight as 175", "weight is 79.5 kg") call `log_weight`
directly, converting to kg if you gave lbs (or the card's configured
`weightUnit`, default `lbs`, if you didn't specify one). Everything else
(water, general Assist commands) is sent straight to Home Assistant's own
Assist (`conversation.process`), so it reuses whatever conversation-trigger
automations you've set up. See the comment header in the JS file for install
steps (copy to `www/`, register as a dashboard resource, add the card).

### Other dashboard cards (optional)

Eight more small Lovelace cards ship alongside the chat card, each in its own
file with full install instructions in its header comment:

- **`sparkyfitness-summary-card.js`** — at-a-glance card for today: calories
  eaten/remaining/goal, macro progress bars vs. goals, water progress, and
  workout status. Reads existing sensor states only — no new services needed.
- **`sparkyfitness-weight-card.js`** — a small line chart of logged weight over
  the trend window (using Home Assistant's own history API, not a new
  integration endpoint), plus the `weight_change`/`avg_weight_30d` stats.
- **`sparkyfitness-exercise-card.js`** — a list of recent completed workouts
  (name, calories, duration) with weekly/monthly totals, via the
  `get_exercise_history` service above.
- **`sparkyfitness-sleep-fasting-card.js`** — last night's sleep (hours, score)
  and current fasting status/progress (elapsed vs. remaining, as a bar) in one
  small card.
- **`sparkyfitness-measurements-card.js`** — a list of your active custom
  measurement categories with their latest value and date. Unlike the other
  cards, this one doesn't take an `entity_prefix` — since category names are
  user-defined and not a fixed key, it discovers them by scanning for entities
  that mention "sparkyfitness" and carry the custom-measurement sensor's
  distinguishing `measurement_type` attribute, so it works regardless of
  prefix.
- **`sparkyfitness-muscle-map-card.js`** — a Hevy-style "Body distribution"
  view: front/back body diagrams with worked muscle groups highlighted in
  blue, a sets-per-muscle-group list below, and prev/next week navigation.
  Calls the `get_muscle_group_summary` service above once per week shown.
  Like the measurements card, it needs no `entity_prefix` — it's entirely
  service-driven. The body diagram is a stylized schematic (simple shapes,
  not an anatomical render) covering the 17 discrete muscle groups
  SparkyFitness's catalog data can resolve to; cardio- and full-body-only
  exercises have no single region to highlight and aren't represented.
- **`sparkyfitness-personal-records-card.js`** — a ranked list of your
  estimated one-rep-maxes across strength exercises, via the
  `get_one_rep_maxes` service above. Like the measurements/muscle-map cards,
  it needs no `entity_prefix` — entirely service-driven.
- **`sparkyfitness-exercise-trend-card.js`** — search any strength exercise
  and see its estimated 1RM progress over recent sessions: a current/best
  1RM summary with a change indicator, a small line chart, and the
  underlying sessions (best set + volume) it was computed from. Via the
  `get_exercise_trend` service above. Also entirely service-driven — no
  `entity_prefix` needed, though an optional `exercise:` config option
  preloads a default exercise instead of requiring a search on first load.

The other four (plus the chat card) take an `entity_prefix` config option — the
shared middle part of your entity IDs (e.g. `sparkyfitness_fitness_jerrybrooke_com`
in `sensor.sparkyfitness_fitness_jerrybrooke_com_weight`). Check Developer Tools →
States for your actual prefix. **Note:** depending on when a given sensor was
first added to your install, HA may have assigned it a *shorter* prefix (just
`sparkyfitness_`, no hostname) — HA bakes a suggested entity_id in once at
creation time and never rewrites it, so older and newer sensors on the same
server can end up on different prefixes. Each of these four cards tries your
configured prefix first and automatically falls back to the bare
`sparkyfitness_` prefix per-entity if that specific one isn't found, so a mixed
install like that still works without extra configuration.

All write-back calls use the same Personal API Key already configured for reading —
there's no separate "write" key to set up (SparkyFitness's own key-creation endpoint
has no way to mint a narrower one anyway). If you configure more than one
SparkyFitness server, pass `config_entry_id` to pick which one a service call targets.

**Note on the workout binary sensor / weekly streak:** SparkyFitness auto-creates an
"Active Calories" entry when a connected wearable syncs passive activity for the day.
That entry counts toward `exercise_sessions_logged` (the plain sensor) but is
excluded from `workout_logged_today`, `workout_names`, and the weekly workout streak,
so all three only reflect actual logged workouts.

**Note on weight/body fat/BMI units:** SparkyFitness stores weight in kg and height
in cm internally regardless of the unit shown in its own UI (conversion happens
client-side there), so `kg` here is accurate — HA will display it in lb
automatically if your profile is set to imperial. Custom measurement values have no
unit info from the API, so none is set — check what unit you used when creating the
category in SparkyFitness.

## Installation

1. Copy the `sparky_fitness` folder into your Home Assistant config's
   `custom_components` folder, so you end up with:
   `<config>/custom_components/sparky_fitness/...`
2. Restart Home Assistant.
3. Go to **Settings → Devices & Services → Add Integration**, search for
   **SparkyFitness**, and follow the prompts.

### Getting a Personal API Key

In the SparkyFitness web UI: **Profile → Personal API Key** → generate a key.
(This is the same key format used for the SparkyFitness MCP server, and the same
key this integration both reads with and — for the write-back services —
writes with.)

### Config flow fields

| Field | Example | Notes |
|---|---|---|
| Server URL | `https://fitness.example.com` | Your SparkyFitness server's base URL (no trailing path). `http://` is fine for local/LAN servers. |
| API key | `sk_live_...` | The Personal API Key from your profile. |
| Verify SSL certificate | on | Turn off only for self-signed certs on a trusted local network. |

### Options (Configure button)

| Option | Default | Notes |
|---|---|---|
| Poll interval | 15 min (min 5) | How often to refresh all sensors. |
| Trend window | 30 days (7–90) | Lookback window for weight change, custom measurement "latest value," and nutrition averages. |

### Reauthentication

If SparkyFitness rejects the API key (revoked, regenerated, etc.), Home Assistant
will surface a "Reconfigure" / reauthentication prompt on the integration instead of
just going unavailable — enter a fresh Personal API Key there and it reconnects
without needing to remove and re-add the integration.

## How it talks to SparkyFitness

Per poll: `daily-summary`, `check-in/{date}`, `check-in/latest-on-or-before-date`,
`check-in-measurements-range`, `mini-nutrition-trends`, `sleep`, `mood/date/{date}`,
`fasting/current`, `custom-categories` (+ one `custom-measurements-range` call per
custom category you have), `exercise-dashboard`, `adaptive-tdee`, and
`water-containers/primary` — all read-only GETs. On-demand
GETs power `get_exercise_trend` (`v2/exercise-entries/history?exerciseId=`,
already server-filtered to one exercise) and `get_one_rep_maxes`
(`exercise-stats/prs`, SparkyFitness's own pre-computed Personal Records
matrix). On-demand POSTs power the write-back services: `health-data`
(water/weight), `food-entries` (log_food, after a `foods/search`), and
`exercise-entries` (log_exercise, after an `exercises/search`). Everything is
authenticated with `Authorization: Bearer <API key>`.

Reading or writing your own data never requires special API key permission scopes —
SparkyFitness always allows a key to act on the data of the account it belongs to.

## Limitations / ideas for later

- Only "today" (plus the trend window for averages/weight-change/custom
  measurements) is polled — no full historical backfill or Home Assistant
  long-term statistics import.
- Sleep stages, detailed fasting history/stats, and mood display preferences
  aren't surfaced — only the "current/latest" snapshot of each.
- Custom measurement sensors are discovered once at startup; a newly created
  category needs a manual reload to appear.
- If you're on an active SparkyFitness workout plan, the **weekly exercise stats**
  (weekly workouts/volume/reps, workout streak) come straight from SparkyFitness's
  own exercise-dashboard report, which doesn't expose per-set completion — so a
  scheduled-but-not-yet-done session may still count there, even though
  `workout_logged_today` correctly excludes it (it has set-level detail to check).
- `log_food` / `log_exercise` (the voice/automation-facing services) always log
  the *first* search result — there's no disambiguation step if your search term
  is ambiguous. Use a more specific name if the wrong food/exercise gets logged,
  or use the chat card, which shows multiple matches for both food and exercise
  and lets you pick (`search_food_choices`/`log_food_choice` and
  `search_exercise_choices`/`log_exercise_choice` services).
- Quantities ("log 2 bananas", "log 150g of chicken") are only understood by the
  **chat card**, not by voice. Home Assistant's sentence-matching engine can't
  reliably split a bare number from an adjacent free-text slot without a literal
  word to anchor on (tried; "log 2 chicken" kept parsing as food name "2
  chicken" no matter how the pattern was ordered), so voice logging always
  logs one default serving — say the quantity in the chat card instead if it matters.
- `get_exercise_trend` / `get_one_rep_maxes` only surface **strength**
  exercises with a real weight and rep count logged on at least one set — a
  set logged as reps-only (bodyweight) or duration/distance-only never
  produces a 1RM estimate. `get_one_rep_maxes` is additionally capped at the
  top 10 exercises by estimated 1RM, since that's the size SparkyFitness's
  own Personal Records endpoint returns.

## Troubleshooting

- **"The API key was rejected"** during setup, or a reauth prompt appears later:
  regenerate the Personal API Key in SparkyFitness and make sure you copied it in
  full (no `Bearer` prefix — the integration adds that for you).
- **"Could not reach the server"**: check the URL is reachable from the machine
  running Home Assistant (not just your browser), including any port number.
- **A service call fails with "More than one SparkyFitness server is configured"**:
  pass `config_entry_id`, found under Settings → Devices & Services →
  SparkyFitness → pick the entry → device info.
- **`log_food` fails with a meal-type error**: `meal_type` must exactly match a
  meal type name that exists in your SparkyFitness account (case-insensitive).
- Logs: **Settings → System → Logs**, filter for `sparky_fitness`.
