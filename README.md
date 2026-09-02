# SparkyFitness for Home Assistant

A custom integration that polls a self-hosted [SparkyFitness](https://github.com/CodeWithCJ/SparkyFitness)
server and exposes your fitness/nutrition/wellness data as Home Assistant sensors,
plus several write-back services, so it can appear on dashboards and drive
automations in both directions.

There's no official SparkyFitness integration. This uses the same Personal API Key
that powers SparkyFitness's own MCP server and mobile app, against endpoints
confirmed directly from SparkyFitness's server source (its published API docs don't
always match the real field names/behavior).

## Installation

### HACS (recommended)

1. HACS -> the (top right) menu -> **Custom repositories**.
2. Add this repository's URL, category **Integration**.
3. Find **SparkyFitness** in HACS -> **Download**.
4. Restart Home Assistant.
5. **Settings -> Devices & Services -> Add Integration**, search for
   **SparkyFitness**, and follow the prompts.

### Manual

1. Copy `custom_components/sparky_fitness` into your Home Assistant config's
   `custom_components` folder, so you end up with:
   `<config>/custom_components/sparky_fitness/...`
2. Restart Home Assistant.
3. **Settings -> Devices & Services -> Add Integration**, search for
   **SparkyFitness**, and follow the prompts.

### Getting a Personal API Key

In the SparkyFitness web UI: **Profile -> Personal API Key** -> generate a key.
(This is the same key format used for the SparkyFitness MCP server, and the same
key this integration both reads with and -- for the write-back services --
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
| Trend window | 30 days (7-90) | Lookback window for weight change, custom measurement "latest value," and nutrition averages. |

### Reauthentication

If SparkyFitness rejects the API key (revoked, regenerated, etc.), Home Assistant
will surface a "Reconfigure" / reauthentication prompt on the integration instead of
just going unavailable -- enter a fresh Personal API Key there and it reconnects
without needing to remove and re-add the integration.

## Entities created

Per configured server, one device with:

### Nutrition (today)
- Calories eaten / burned / remaining / goal / net / goal progress (%)
- Protein / carbs / fat eaten (g) -- summed from today's food log the same way
  SparkyFitness sums calories (per-entry, scaled by quantity/serving size)
- Protein / carbs / fat / water goals (prefers your adjusted/TDEE goal for the day
  over the flat stored goal, same precedence SparkyFitness itself uses)
- Water intake (mL)
- BMR (with a `source` attribute: `formula` or `external`)
- Food entries logged today (count)

### Exercise
- Step calories, steps (resets daily; `unknown` if nothing logged today)
- Exercise sessions logged today (count -- includes auto-synced wearable activity)
- **`binary_sensor.workout_logged_today`** -- on/off "did I actually work out," with
  `workout_names`, `workout_count`, `total_exercise_calories`,
  `total_exercise_minutes` attributes. Excludes SparkyFitness's auto-created
  "Active Calories" wearable-sync entries -- see note below. Also excludes
  workout-plan sessions that are only scheduled/pre-filled for today and
  haven't actually been started (SparkyFitness pre-populates the diary ahead
  of time if you're on an active plan; a session only counts as done once at
  least one of its sets has actually been checked off).
- **Weekly exercise stats** (rolling 7 days, from SparkyFitness's own
  exercise-dashboard report): weekly workouts, weekly volume (kg, with a
  `by_muscle_group` breakdown attribute), weekly reps, workout streak / longest
  streak (with a `weekly_frequency` attribute) -- the streak calc is SparkyFitness's
  own and already excludes "Active Calories" the same way `workout_logged_today` does.
  Unlike `workout_logged_today`, this comes pre-aggregated from SparkyFitness with
  no set-level completion data, so it can't apply the same "actually started"
  filter -- see Limitations below if you're on an active workout plan.
- **Monthly exercise stats** -- the same exercise-dashboard report as above, but
  fetched over the full trend window (30 days by default, configurable) instead
  of a fixed 7 days: monthly workouts, monthly volume (kg), monthly reps. Distinct
  entities from the weekly ones so you can compare "this week" vs. "this month" at
  a glance; workout streak isn't duplicated here since it's already an all-time
  running count regardless of which window's report it's read from.
- **`binary_sensor.pr_today`** -- on if any strength exercise hit a new
  estimated one-rep-max today, with an `exercises` attribute listing which
  ones. Derived from SparkyFitness's own Personal Records matrix (the same
  data `get_one_rep_maxes`/`get_cardio_prs` below read), polled every cycle
  so it flips the same poll a PR happens rather than only when a
  personal-records card happens to be open.

### Body measurements
- Weight (kg), body fat (%), BMI -- carried forward from your most recently logged
  check-in rather than requiring a fresh entry every day (these don't change
  daily); each has a `measurement_date` attribute showing how current it is.
  BMI is computed by this integration (weight/height^2 -- SparkyFitness's API
  doesn't return a BMI value at all).
- **Weight change** over the trend window (30 days by default, configurable --
  see Options above), with `trend` (`up`/`down`/`steady`) and `since` (the date of
  the oldest sample used) attributes.
- **Custom measurements** -- one sensor per custom measurement category you've
  defined in SparkyFitness (blood pressure, glucose, etc.), named after the
  category, showing its most recent value within the trend window. Created
  dynamically from whatever categories exist when the integration starts --
  a category added later needs Settings -> Devices & Services -> SparkyFitness ->
  **Reload** to pick up.
  A category is skipped entirely (no sensor created) if it has never had a
  value logged **and** was never assigned a real unit -- SparkyFitness marks
  unused categories with `measurement_type: "N/A"`. This is what a
  wearable/health-app sync into SparkyFitness typically leaves behind:
  placeholder categories (e.g. `active_calories`, `heart_rate`) it created
  but never actually populated, which would otherwise sit at "unknown"
  forever. A category with a real unit but simply no *recent* entry still
  gets a sensor -- that's a metric you actively use, not dead clutter.
- **Adaptive TDEE** -- SparkyFitness's rolling calorie-burn estimate derived from
  your actual logged weight and intake over time (distinct from `bmr`, which is
  a formula-based estimate). Has `confidence` (`HIGH`/`MEDIUM`/`LOW`),
  `is_fallback`, `fallback_reason`, and `days_of_data` attributes -- SparkyFitness
  falls back to a formula estimate until you have enough history, so check
  `is_fallback` before relying on the value.

### Trends & streak
- Average calories, 7-day and 30-day (rolling, includes non-logged days as 0 in
  the average -- i.e. "average calories per day this week/month")
- Logging streak (consecutive days with something logged; doesn't break just
  because you haven't logged *today* yet)
- **30-day macro averages** -- average protein/carbs/fat per day over the last 30
  calendar days, same "non-logged days count as 0" convention as the calorie
  averages above (so it reads as "your daily average this month," not "average
  on days you happened to log").
- **Logging consistency (30 day)** -- % of the last 30 calendar days with at
  least one food entry. A steadier signal than the streak sensor for "how
  consistent have I actually been," since one missed day resets the streak to
  zero but barely dents this percentage.
- **Average weight (30 day)** -- mean of every weight check-in logged within the
  last 30 days (simple average of whatever weigh-ins exist, not weighted by
  day -- weigh-ins are naturally sparser than food logging). Distinct from
  `weight_change`, which compares the *first vs. last* logged value in the
  trend window rather than averaging all of them.

### Sleep, mood, fasting
- Sleep duration (hours) and sleep score, from the most recent sleep entry in the
  last 2 days (works whether your tracker/you log sleep under the bedtime date or
  the wake-up date)
- Mood (SparkyFitness's numeric mood rating for today), with `tags` and `notes`
  attributes
- **`binary_sensor.fasting_active`** -- on while a fast is in progress, with
  `fasting_type`, `start_time`, `target_end_time`, `elapsed_hours`,
  `remaining_hours` attributes
- **Sleep debt** -- SparkyFitness's own rolling sleep-debt estimate from its
  MCTQ sleep model, distinct from the plain "last night's hours" sleep
  duration sensor above. Has `category` (`low`/`moderate`/`high`/`critical`),
  `trend`, `change_7d_hours`, `payback_hours`, and `sleep_need_hours`
  attributes. Empty until SparkyFitness has enough sleep history logged to
  compute a baseline.
- **Fasting total completed** / **fasting average duration** -- all-time
  fasting totals, distinct from `fasting_active` above (which only reflects
  a fast currently in progress).
- **Fasting streak** -- consecutive days with a completed fast, derived here
  the same way the nutrition logging streak is (SparkyFitness's own fasting
  stats don't include a streak) -- see Limitations for its day-boundary
  approximation. Has a `completed_today` attribute (true once today's fast
  is done, even after `fasting_active` reads back off) -- what the fasting
  streak reminder blueprint below checks to avoid a false "you haven't
  started yet" reminder.

### Write-back
- **`button.log_glass_of_water`** -- one tap logs your actual preferred water
  container size (read from SparkyFitness's Settings -> Water Containers ->
  primary container; falls back to 2000 mL, SparkyFitness's own default, if
  you haven't set one). Has `container_name` and `container_volume_ml`
  attributes so you can see what a tap will log before pressing it. For a
  one-off different amount, use the `sparky_fitness.log_water` service instead.
- **`sparky_fitness.log_water`** service -- log any water amount (mL)
- **`sparky_fitness.log_weight`** service -- log a weight reading (kg)
- **`sparky_fitness.log_food`** service -- search SparkyFitness's food database by
  name (e.g. "banana") and log the closest match for today; takes optional `meal_type`
  (must match a meal type name in your account, default `snacks`) and `servings`
  (multiplier on the default serving, default 1). Returns what was actually logged.
- **`sparky_fitness.log_exercise`** service -- search SparkyFitness's exercise database
  by name (e.g. "running") and log it for today with the given `duration_minutes`;
  SparkyFitness calculates calories burned from the matched exercise's calorie rate.
- **`sparky_fitness.search_food_choices`** service -- read-only food search that
  returns up to `limit` candidates instead of logging anything, so a caller (like
  the chat card below) can show "did you mean X, Y, or Z?" before committing.
- **`sparky_fitness.log_food_choice`** service -- logs one specific food entry by
  `food_id`/`variant_id` (from `search_food_choices`), bypassing search entirely --
  the follow-up half of picking a disambiguated match.
- **`sparky_fitness.search_exercise_choices`** / **`sparky_fitness.log_exercise_choice`**
  services -- the same search-then-pick pattern as food, for exercises.
- **`sparky_fitness.get_exercise_history`** service -- read-only, on-demand list of
  recent completed workouts over `days` (default 14), for the exercise-history
  card below. Fetches one daily-summary request per day in range, so it's meant
  to be called when a card loads/refreshes rather than on the regular poll cycle.
- **`sparky_fitness.get_muscle_group_summary`** service -- read-only, on-demand
  sets-per-muscle-group breakdown for the muscle-map card below, over a `days`
  (default 7) window ending at `end_date` (default today -- pass an earlier date
  to page back a previous week). Sets are attributed from SparkyFitness's own
  exercise catalog data: primary muscles get full credit per set, secondary
  muscles get half credit, and an exercise falls back to its broad `category`
  (e.g. "Chest") if it has no per-muscle catalog data at all. Exercises with
  neither -- fully custom, uncataloged exercises -- can't be attributed to
  anything and are silently skipped, the same limitation apps like Hevy have
  for unmatched custom exercises. Reuses the same "actually completed" /
  auto-sync-exclusion rules as `workout_logged_today`. Pass
  `include_recovery: true` (off by default) to also get a
  `recovery_days_since` map of days-since-last-worked per muscle group,
  looking back further than `days` when needed -- see the muscle-map card
  below, which enables this.
- **`sparky_fitness.get_exercise_trend`** service -- read-only, on-demand
  one-rep-max (1RM) trend for a single exercise, for the exercise-trend card
  below. Resolves the given `name` to an exercise the same way `log_exercise`
  does (first search match), then estimates a 1RM per session -- via the
  Epley formula, `weight * (1 + reps/30)` -- from its last `sessions`
  (default 20, workouts not calendar days) sessions.
- **`sparky_fitness.get_one_rep_maxes`** service -- read-only current
  estimated 1RMs across all strength exercises, for the personal-records
  card below. A thin wrapper around SparkyFitness's own Personal Records
  matrix -- up to 10 exercises, ranked by estimated 1RM, using
  SparkyFitness's own Epley-formula calculation rather than a
  reimplementation, so the numbers always match SparkyFitness itself. Reads
  the copy already polled every cycle (see `binary_sensor.pr_today` above)
  rather than re-fetching live.
- **`sparky_fitness.get_cardio_prs`** service -- read-only cardio
  distance-milestone personal records (1k, 1 mile, 5k, 10k, 15k, half/full
  marathon -- best time per sport group), for the cardio-records card below.
  The cardio half of the same Personal Records matrix `get_one_rep_maxes`
  reads the strength half of; also reads the polled copy.
- **`sparky_fitness.get_favorite_routes`** service -- read-only repeated
  route/loop stats (the same run/ride done more than once, with a best time
  and its recent activities) for the favorite-routes card below, from
  SparkyFitness's own matched-courses report.
- **`sparky_fitness.get_custom_measurement_trend`** service -- read-only,
  on-demand full trend (not just "latest value") for one custom measurement
  category, for the custom-measurement-trend card below. `category` matches
  a category's id, display name, or name (case-insensitive); `days`
  (default 30) controls how far back to fetch.

## Dashboard cards (optional)

Twelve small Lovelace cards live in this repo's `www/` folder, each with full install
instructions in its header comment. HACS doesn't manage these automatically (this
repo is registered as an Integration, not a Plugin) -- copy whichever ones you want
into `<config>/www/` and register them as dashboard resources
(**Settings -> Dashboards -> menu -> Resources -> Add Resource**, type **JavaScript Module**).

- **`sparkyfitness-chat-card.js`** -- a chat-style box for typing things like "I ate a
  banana", "log 150g of chicken", "log my weight as 175", or "log running for 30
  minutes" instead of using a voice assistant.
- **`sparkyfitness-summary-card.js`** -- at-a-glance card for today: calories
  eaten/remaining/goal, macro progress bars vs. goals, water progress, and
  workout status.
- **`sparkyfitness-weight-card.js`** -- a small line chart of logged weight over
  the trend window, plus the `weight_change`/`avg_weight_30d` stats.
- **`sparkyfitness-exercise-card.js`** -- a list of recent completed workouts
  (name, calories, duration) with weekly/monthly totals.
- **`sparkyfitness-sleep-fasting-card.js`** -- last night's sleep (hours, score)
  and current fasting status/progress in one small card.
- **`sparkyfitness-measurements-card.js`** -- a list of your active custom
  measurement categories with their latest value and date. Discovers entities
  automatically rather than needing an `entity_prefix`.
- **`sparkyfitness-muscle-map-card.js`** -- a Hevy-style "Body distribution"
  view: front/back body diagrams with worked muscle groups highlighted in
  blue, a sets-per-muscle-group list below (with a "Xd ago" / "Today"
  recovery tag per muscle), and prev/next week navigation. Calls the
  `get_muscle_group_summary` service above once per week shown. No
  `entity_prefix` needed -- entirely service-driven. The body diagram is a
  stylized schematic covering the 17 discrete muscle groups SparkyFitness's
  catalog data can resolve to; cardio- and full-body-only exercises have no
  single region to highlight and aren't represented.
- **`sparkyfitness-personal-records-card.js`** -- a ranked list of your
  estimated one-rep-maxes across strength exercises, via the
  `get_one_rep_maxes` service above. No `entity_prefix` needed -- entirely
  service-driven.
- **`sparkyfitness-exercise-trend-card.js`** -- search any strength exercise
  and see its estimated 1RM progress over recent sessions: a current/best
  1RM summary with a change indicator, a small line chart, and the
  underlying sessions it was computed from. Via the `get_exercise_trend`
  service above. Also entirely service-driven; an optional `exercise:`
  config option preloads a default exercise instead of requiring a search
  on first load.
- **`sparkyfitness-cardio-records-card.js`** -- a ranked list of your best
  times per distance milestone (1k through marathon, by sport group), via
  the `get_cardio_prs` service above. The cardio counterpart to the
  personal-records card; entirely service-driven.
- **`sparkyfitness-favorite-routes-card.js`** -- routes/loops you've
  repeated, each with a best time and (tap to expand) its recent
  activities, via the `get_favorite_routes` service above. Entirely
  service-driven.
- **`sparkyfitness-custom-measurement-trend-card.js`** -- a small line chart
  of one custom measurement category over time, via the
  `get_custom_measurement_trend` service above. Takes a required
  `category:` config option (a category's id, display name, or name)
  instead of `entity_prefix`; only numeric categories can be charted.

The other four (plus the chat card) take an `entity_prefix` config option -- the
shared middle part of your entity IDs (e.g. `sparkyfitness_fitness_jerrybrooke_com`
in `sensor.sparkyfitness_fitness_jerrybrooke_com_weight`). Check Developer Tools ->
States for your actual prefix. **Note:** depending on when a given sensor was
first added to your install, HA may have assigned it a *shorter* prefix (just
`sparkyfitness_`, no hostname) -- each of these four cards tries your configured
prefix first and automatically falls back to the bare `sparkyfitness_` prefix
per-entity if that specific one isn't found, so a mixed install still works
without extra configuration.

All write-back calls use the same Personal API Key already configured for reading --
there's no separate "write" key to set up. If you configure more than one
SparkyFitness server, pass `config_entry_id` to pick which one a service call targets.

**Note on the workout binary sensor / weekly streak:** SparkyFitness auto-creates an
"Active Calories" entry when a connected wearable syncs passive activity for the day.
That entry counts toward `exercise_sessions_logged` (the plain sensor) but is
excluded from `workout_logged_today`, `workout_names`, and the weekly workout streak,
so all three only reflect actual logged workouts.

**Note on weight/body fat/BMI units:** SparkyFitness stores weight in kg and height
in cm internally regardless of the unit shown in its own UI, so `kg` here is
accurate -- HA will display it in lb automatically if your profile is set to
imperial. Custom measurement values have no unit info from the API, so none is
set -- check what unit you used when creating the category in SparkyFitness.

## Automation blueprints (optional)

Two ready-made automation blueprints live in this repo's `blueprints/automation/`
folder. Import one via **Settings -> Automations & Scenes -> Blueprints -> Import
Blueprint**, pasting the blueprint's raw GitHub URL, or copy the file manually to
`<config>/blueprints/automation/Jerrys-modz/`. Both require Home Assistant
2024.10 or later (for the `triggers:`/`conditions:`/`actions:` syntax) and the
integration entities they reference (v0.12.0+, or v0.13.0+ for the fasting
streak reminder's completed-today check below).

- **`sparky_fitness_pr_notification.yaml`** -- notifies you the moment
  `binary_sensor.pr_today` turns on, i.e. as soon as today's workout sets a new
  estimated one-rep-max or cardio personal record, listing which exercises hit
  a new record.
- **`sparky_fitness_fasting_streak_reminder.yaml`** -- a daily reminder, at a
  time you pick, if `sensor.fasting_streak` is greater than zero and
  `binary_sensor.fasting_active` is off AND today's fast hasn't already
  completed (via the streak sensor's `completed_today` attribute, v0.13.0+) --
  i.e. you have a streak going but genuinely haven't started today's fast yet.

Both let you pick the notify target (person, device, or notify group) and
customize the title/message text.

## How it talks to SparkyFitness

Per poll: `daily-summary`, `check-in/{date}`, `check-in/latest-on-or-before-date`,
`check-in-measurements-range`, `mini-nutrition-trends`, `sleep`, `mood/date/{date}`,
`fasting/current`, `custom-categories` (+ one `custom-measurements-range` call per
custom category you have), `exercise-dashboard`, `adaptive-tdee`, and
`water-containers/primary`, `exercise-stats/prs` (for `binary_sensor.pr_today`
and the `get_one_rep_maxes`/`get_cardio_prs` services), `sleep-science/sleep-debt`,
`fasting/stats`, and `fasting/history/range/{start}/{end}` -- all read-only GETs.
On-demand GETs power `get_exercise_trend` (`v2/exercise-entries/history?exerciseId=`,
already server-filtered to one exercise), `get_favorite_routes`
(`exercise-stats/matched-courses`), and `get_custom_measurement_trend` (a
`custom-measurements-range` call over a wider date range than the per-poll
"latest value" one above). On-demand POSTs power the write-back services:
`health-data` (water/weight), `food-entries` (log_food, after a
`foods/search`), and `exercise-entries` (log_exercise, after an
`exercises/search`). Everything is authenticated with
`Authorization: Bearer <API key>`.

Reading or writing your own data never requires special API key permission scopes --
SparkyFitness always allows a key to act on the data of the account it belongs to.

## Limitations / ideas for later

- Only "today" (plus the trend window for averages/weight-change/custom
  measurements) is polled -- no full historical backfill or Home Assistant
  long-term statistics import.
- Sleep stages and mood display preferences aren't surfaced -- mood is still
  only the "current/latest" snapshot. Sleep debt/fasting totals-and-streak
  are now surfaced (see above), but SparkyFitness's deeper sleep-science
  features (chronotype, energy curve, MCTQ baseline) aren't.
- Custom measurement sensors are discovered once at startup; a newly created
  category needs a manual reload to appear.
- If you're on an active SparkyFitness workout plan, the **weekly exercise stats**
  come straight from SparkyFitness's own exercise-dashboard report, which doesn't
  expose per-set completion -- so a scheduled-but-not-yet-done session may still
  count there, even though `workout_logged_today` correctly excludes it.
- `log_food` / `log_exercise` (the voice/automation-facing services) always log
  the *first* search result -- there's no disambiguation step. Use the chat card
  for multi-match disambiguation instead.
- Quantities ("log 2 bananas", "log 150g of chicken") are only understood by the
  **chat card**, not by voice -- voice logging always logs one default serving.
- `get_exercise_trend` / `get_one_rep_maxes` only surface **strength**
  exercises with a real weight and rep count logged on at least one set --
  a set logged as reps-only (bodyweight) or duration/distance-only never
  produces a 1RM estimate. `get_one_rep_maxes` is additionally capped at the
  top 10 exercises by estimated 1RM, since that's the size SparkyFitness's
  own Personal Records endpoint returns.
- `get_muscle_group_summary`'s `include_recovery` only looks back as far as
  the larger of `days` or its own default lookback (21 days) -- a muscle
  last worked further back than that shows no recovery tag at all (treat
  that as "no recent data," not "never trained").
- The fasting streak is derived from completed fasts' start/end timestamps
  by calendar day, not a real per-user-timezone day boundary -- an
  approximation, same caveat as the exercise-dashboard-based weekly stats
  above, just for a different endpoint.
- Cardio PRs (`get_cardio_prs`) use SparkyFitness's own distance-milestone
  bands (1k/mile/5k/10k/15k/half/marathon), which are running distances --
  a Ride or Swim section may show a running-shaped band instead of a
  sport-appropriate one (SparkyFitness itself notes this isn't yet
  idiomatic for cycling/swimming).

## Releasing (maintainers)

Bump `version` in `custom_components/sparky_fitness/manifest.json` and merge that
to `main`. A workflow (`.github/workflows/release.yml`) picks up the change and
publishes a GitHub Release for `v<version>` with an auto-generated changelog (a
"What's Changed" list plus a full-diff link, GitHub's standard `--generate-notes`
output) -- no separate tagging step needed. It's idempotent: if a release for that
version already exists (e.g. manifest.json changed without a version bump), the
workflow just skips rather than erroring or duplicating. `workflow_dispatch` is
also enabled for a manual re-run if a release ever needs retrying.

## Troubleshooting

- **"The API key was rejected"** during setup, or a reauth prompt appears later:
  regenerate the Personal API Key in SparkyFitness and make sure you copied it in
  full (no `Bearer` prefix -- the integration adds that for you).
- **"Could not reach the server"**: check the URL is reachable from the machine
  running Home Assistant (not just your browser), including any port number.
- **A service call fails with "More than one SparkyFitness server is configured"**:
  pass `config_entry_id`, found under Settings -> Devices & Services ->
  SparkyFitness -> pick the entry -> device info.
- **`log_food` fails with a meal-type error**: `meal_type` must exactly match a
  meal type name that exists in your SparkyFitness account (case-insensitive).
- Logs: **Settings -> System -> Logs**, filter for `sparky_fitness`.
