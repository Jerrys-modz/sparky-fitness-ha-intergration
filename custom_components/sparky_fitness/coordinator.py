"""DataUpdateCoordinator for SparkyFitness."""

from __future__ import annotations

import json
import logging
from datetime import date as date_type, timedelta

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api import (
    SparkyFitnessApiClient,
    SparkyFitnessApiError,
    SparkyFitnessAuthError,
)
from .const import DEFAULT_TREND_WINDOW_DAYS, DOMAIN

_LOGGER = logging.getLogger(__name__)


def _get(d: dict, *keys, default=None):
    """Safely walk a nested dict."""
    cur = d
    for key in keys:
        if not isinstance(cur, dict) or key not in cur:
            return default
        cur = cur[key]
    return cur if cur is not None else default


# SparkyFitness auto-creates an "Active Calories" individual session when a
# connected wearable/step tracker syncs passive activity for the day. It's
# real data, but it isn't something you "did a workout" for, so it's excluded
# from the workout name list / workout count (it still counts toward
# exercise_sessions_logged, which reflects every exercise-related entry).
_AUTO_SYNC_SESSION_NAME = "Active Calories"


def _session_name(session: dict) -> str:
    """Best-effort human label for one exercise session."""
    if session.get("type") == "preset":
        return session.get("name") or "Workout"
    name = session.get("name")
    if name:
        return name
    snapshot = session.get("exercise_snapshot") or {}
    return snapshot.get("name") or "Exercise"


def _session_calories(session: dict) -> float:
    if session.get("type") == "preset":
        return sum(
            (ex.get("calories_burned") or 0) for ex in session.get("exercises", [])
        )
    return session.get("calories_burned") or 0


def _session_duration_minutes(session: dict) -> float:
    if session.get("type") == "preset":
        return session.get("total_duration_minutes") or 0
    return session.get("duration_minutes") or 0


def _compute_bmi(weight_kg, height_cm):
    """BMI isn't returned by the check-in endpoint (SparkyFitness's own DB
    schema only stores weight/height/body_fat_percentage/neck/waist/hips/steps
    for a check-in — no bmi column), so it's computed here the standard way:
    kg / m^2. Requires both weight and height to be logged for the same day.
    """
    try:
        weight_kg = float(weight_kg)
        height_cm = float(height_cm)
    except (TypeError, ValueError):
        return None
    if weight_kg <= 0 or height_cm <= 0:
        return None
    height_m = height_cm / 100
    return round(weight_kg / (height_m**2), 1)


def _session_sets(session: dict) -> list:
    """All logged sets for a session, regardless of preset/individual shape."""
    if session.get("type") == "preset":
        sets = []
        for exercise in session.get("exercises") or []:
            sets.extend(exercise.get("sets") or [])
        return sets
    return session.get("sets") or []


def _session_is_completed(session: dict) -> bool:
    """SparkyFitness workout plans pre-fill exercise entries for scheduled days
    ahead of time (including today), so a row existing in the diary doesn't
    mean it was actually performed. Each set carries its own `completed_at`
    timestamp, set only once you actually check it off, so a session counts as
    done once at least one of its sets has been. Sessions with no set-level
    detail at all (e.g. a manually logged run) have no such signal, so their
    mere presence is treated as sufficient — same as before this check existed.
    """
    sets = _session_sets(session)
    if not sets:
        return True
    return any(s.get("completed_at") for s in sets)


def _summarize_exercise_sessions(sessions: list) -> dict:
    """Split today's exercise sessions into 'real workouts' vs auto-synced
    activity, after dropping sessions that are only scheduled/pre-filled from
    a workout plan and haven't actually been started yet."""
    done = [s for s in sessions if _session_is_completed(s)]
    workouts = [
        s
        for s in done
        if not (
            s.get("type") == "individual" and s.get("name") == _AUTO_SYNC_SESSION_NAME
        )
    ]
    return {
        "workout_logged": len(workouts) > 0,
        "workout_count": len(workouts),
        "workout_names": [_session_name(s) for s in workouts],
        "exercise_sessions_logged": len(done),
        "total_exercise_calories": round(sum(_session_calories(s) for s in done)),
        "total_exercise_minutes": round(
            sum(_session_duration_minutes(s) for s in done)
        ),
    }


_MUSCLE_ALIASES = {
    "lower back": "lower_back",
    "middle back": "upper_back",
    "upper back": "upper_back",
    "abs": "abdominals",
    "abdomen": "abdominals",
    "quads": "quadriceps",
    "hams": "hamstrings",
    "delts": "shoulders",
    "deltoids": "shoulders",
    "lat": "lats",
}

_KNOWN_MUSCLES = {
    "abdominals",
    "abductors",
    "adductors",
    "biceps",
    "calves",
    "chest",
    "forearms",
    "glutes",
    "hamstrings",
    "lats",
    "lower_back",
    "upper_back",
    "neck",
    "quadriceps",
    "shoulders",
    "traps",
    "triceps",
}


def _normalize_muscle(raw) -> str | None:
    """Map SparkyFitness's free-text muscle/category names onto the fixed
    set of keys the muscle-map card knows how to draw a body region for.
    Returns None for values with no paintable region (e.g. "cardio", "full
    body") so callers can leave those out of the body diagram entirely."""
    if not raw:
        return None
    key = str(raw).strip().lower().replace("-", " ")
    key = _MUSCLE_ALIASES.get(key, key.replace(" ", "_"))
    return key if key in _KNOWN_MUSCLES else None


def _parse_muscle_list(value) -> list:
    """SparkyFitness stores primary_muscles/secondary_muscles as a
    JSON-encoded array *string* (e.g. '["chest"]') on the exercise
    entry/snapshot, not a real list — this handles both shapes, plus a
    bare non-JSON string as a single muscle name."""
    if isinstance(value, list):
        items = value
    elif isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            parsed = None
        items = parsed if isinstance(parsed, list) else [value]
    else:
        items = []
    return [m for m in (_normalize_muscle(v) for v in items) if m]


def _exercise_muscle_groups(exercise: dict) -> list:
    """Primary muscles for one exercise (from a preset session's
    `exercises[]` entry, or an individual session itself), falling back to
    its broad category (e.g. "Chest", "Shoulders") if SparkyFitness has no
    per-muscle data for it — some catalog entries and all manually-created
    exercises only carry a category, not primary_muscles/secondary_muscles.
    Checks both the exercise dict directly and a nested `exercise_snapshot`,
    since which shape carries the catalog fields varies by session type."""
    snapshot = exercise.get("exercise_snapshot") or {}
    merged = {**snapshot, **exercise}
    primary = _parse_muscle_list(merged.get("primary_muscles"))
    if primary:
        return primary
    category = _normalize_muscle(
        merged.get("category") or merged.get("exercise_category_from_catalog")
    )
    return [category] if category else []


def _exercise_secondary_muscle_groups(exercise: dict) -> list:
    snapshot = exercise.get("exercise_snapshot") or {}
    merged = {**snapshot, **exercise}
    return _parse_muscle_list(merged.get("secondary_muscles"))


def _exercise_set_count(exercise: dict) -> int:
    """How many sets to credit this exercise with. Prefers sets actually
    checked off (`completed_at` set); if the exercise has set-level data but
    none carry a completed_at (older/manually-logged entries), every logged
    set is counted — the same lenient fallback `_session_is_completed` uses.
    An exercise with no set-level detail at all (e.g. a duration-based
    cardio entry) counts as a single unit of work."""
    sets = exercise.get("sets") or []
    if not sets:
        return 1
    completed = [s for s in sets if s.get("completed_at")]
    return len(completed) if completed else len(sets)


def _muscle_group_summary(days_data: list) -> dict:
    """Aggregate sets-per-muscle-group across a range of daily-summary
    payloads (as returned by SparkyFitnessApiClient.async_get_daily_summaries_range),
    for the muscle-map card. Secondary muscles are credited at half weight —
    "this exercise also worked X, but less" — a common convention among
    workout trackers. Reuses the exact same "actually completed" /
    auto-sync-exclusion rules as workout_logged_today so a pre-filled-but-
    not-started workout-plan session or an "Active Calories" wearable entry
    doesn't inflate the totals.

    Exercises with no recognizable primary_muscles or category (custom
    exercises with neither set) are silently skipped — there's nothing to
    attribute their sets to."""
    totals: dict[str, float] = {}
    for day in days_data:
        sessions = _get(day.get("summary"), "exerciseSessions", default=[]) or []
        for session in sessions:
            if not _session_is_completed(session):
                continue
            if (
                session.get("type") == "individual"
                and session.get("name") == _AUTO_SYNC_SESSION_NAME
            ):
                continue
            exercises = (
                session.get("exercises")
                if session.get("type") == "preset"
                else [session]
            ) or []
            for exercise in exercises:
                count = _exercise_set_count(exercise)
                for muscle in _exercise_muscle_groups(exercise):
                    totals[muscle] = totals.get(muscle, 0) + count
                for muscle in _exercise_secondary_muscle_groups(exercise):
                    totals[muscle] = totals.get(muscle, 0) + count * 0.5
    return {k: round(v, 1) for k, v in totals.items()}


def _sum_food_macro(food_entries: list, field: str) -> float:
    """Sum one macro across today's food entries, scaled by quantity/serving
    size — the same formula SparkyFitness's own server uses for eaten
    calories (per-serving values scaled by quantity / serving_size, default
    serving size 100)."""
    total = 0.0
    for entry in food_entries:
        value = entry.get(field) or 0
        qty = entry.get("quantity") or 0
        serving_size = entry.get("serving_size") or 100
        total += (value * qty) / serving_size
    return round(total)


def _extract_macro_goals(summary: dict) -> dict:
    """Prefer the day's adjusted goals (TDEE/dynamic mode) over the raw
    stored goals, same precedence SparkyFitness uses for calorie_goal."""
    adjusted = summary.get("adjustedGoals")
    goals = summary.get("goals") or {}
    source = adjusted if adjusted else goals
    return {
        "protein_goal": _round_or_none(source.get("protein")),
        "carbs_goal": _round_or_none(source.get("carbs")),
        "fat_goal": _round_or_none(source.get("fat")),
        "water_goal_ml": _round_or_none(goals.get("water_goal_ml")),
    }


def _round_or_none(value):
    return round(value) if isinstance(value, (int, float)) else None


def _nutrition_trend_stats(trends: list, today: date_type) -> dict:
    """Rolling averages + logging streak from the mini-nutrition-trends
    endpoint. Only days with something logged appear in `trends` at all, so
    presence of a date in the results IS "logged that day"."""
    by_date = {row.get("date"): row for row in trends if row.get("date")}

    def avg_over(field: str, days: int) -> float | None:
        total = 0.0
        for offset in range(days):
            row = by_date.get((today - timedelta(days=offset)).isoformat())
            if row:
                total += row.get(field) or 0
        return round(total / days, 1) if days else None

    def days_logged_in(days: int) -> int:
        return sum(
            1
            for offset in range(days)
            if (today - timedelta(days=offset)).isoformat() in by_date
        )

    # Don't penalize "haven't logged yet today" — start the streak count from
    # today if it's there, otherwise from yesterday.
    cursor = today
    if today.isoformat() not in by_date:
        cursor = today - timedelta(days=1)
    streak = 0
    while cursor.isoformat() in by_date:
        streak += 1
        cursor -= timedelta(days=1)

    return {
        "avg_calories_7d": round(avg_over("calories", 7) or 0),
        "avg_calories_30d": round(avg_over("calories", 30) or 0),
        "logging_streak_days": streak,
        # 30-day macro averages — per-calendar-day (a day with nothing logged
        # counts as 0 toward the sum, same convention as avg_calories_30d),
        # not per-logged-day, so this reads as "your daily average over the
        # last month" rather than "average on days you happened to log."
        "avg_protein_30d": avg_over("protein", 30),
        "avg_carbs_30d": avg_over("carbs", 30),
        "avg_fat_30d": avg_over("fat", 30),
        # % of the last 30 calendar days with at least one food entry.
        "logging_consistency_30d": round(days_logged_in(30) / 30 * 100),
    }


def _weight_trend(check_in_range: list) -> dict:
    """Compare the earliest and latest logged weight in the polled window."""
    dated_weights = sorted(
        (
            (row.get("entry_date"), row.get("weight"))
            for row in check_in_range
            if row.get("weight") is not None
        ),
        key=lambda pair: pair[0] or "",
    )
    if len(dated_weights) < 2:
        return {
            "weight_change": None,
            "weight_trend": None,
            "weight_trend_since": None,
        }
    first_date, first_weight = dated_weights[0]
    _last_date, last_weight = dated_weights[-1]
    delta = round(last_weight - first_weight, 1)
    trend = "steady"
    if delta > 0.1:
        trend = "up"
    elif delta < -0.1:
        trend = "down"
    return {
        "weight_change": delta,
        "weight_trend": trend,
        "weight_trend_since": first_date,
    }


def _avg_weight_30d(check_in_range: list, today: date_type, days: int = 30) -> float | None:
    """Average of every logged weight within the last `days` calendar days
    (not per-logged-day — simply the mean of whatever check-ins exist in the
    window, since weigh-ins are naturally sparser than daily food logging)."""
    cutoff = today - timedelta(days=days)
    weights = [
        row.get("weight")
        for row in check_in_range
        if row.get("weight") is not None
        and row.get("entry_date")
        and row.get("entry_date") >= cutoff.isoformat()
    ]
    if not weights:
        return None
    return round(sum(weights) / len(weights), 1)


def _latest_sleep(sleep_entries: list) -> dict:
    """Most recent sleep entry in the polled window (usually "last night")."""
    if not sleep_entries:
        return {"sleep_hours": None, "sleep_score": None, "sleep_date": None}
    latest = max(sleep_entries, key=lambda e: e.get("entry_date") or "")
    seconds = latest.get("time_asleep_in_seconds") or latest.get(
        "duration_in_seconds"
    )
    hours = round(seconds / 3600, 1) if isinstance(seconds, (int, float)) else None
    return {
        "sleep_hours": hours,
        "sleep_score": latest.get("sleep_score"),
        "sleep_date": latest.get("entry_date"),
    }


def _mood_summary(mood: dict) -> dict:
    return {
        "mood_value": mood.get("mood_value"),
        "mood_tags": mood.get("mood_tags") or [],
        "mood_notes": mood.get("notes"),
    }


def _fasting_summary(fasting: dict | None) -> dict:
    if not fasting:
        return {
            "fasting_active": False,
            "fasting_start_time": None,
            "fasting_target_end_time": None,
            "fasting_type": None,
            "fasting_elapsed_hours": None,
            "fasting_remaining_hours": None,
        }
    start = dt_util.parse_datetime(fasting.get("start_time") or "")
    target = dt_util.parse_datetime(fasting.get("target_end_time") or "")
    now = dt_util.utcnow()
    elapsed_hours = round((now - start).total_seconds() / 3600, 1) if start else None
    remaining_hours = (
        round((target - now).total_seconds() / 3600, 1) if target else None
    )
    return {
        "fasting_active": fasting.get("status") == "ACTIVE",
        "fasting_start_time": fasting.get("start_time"),
        "fasting_target_end_time": fasting.get("target_end_time"),
        "fasting_type": fasting.get("fasting_type"),
        "fasting_elapsed_hours": elapsed_hours,
        "fasting_remaining_hours": remaining_hours,
    }


def _exercise_dashboard_summary(dashboard: dict) -> dict:
    """Weekly workout stats from /api/reports/exercise-dashboard. SparkyFitness's
    own `consistencyData.currentStreak` already excludes auto-synced "Active
    Calories" entries, matching how `workout_logged_today` defines a workout.

    Unlike `workout_logged_today` (built from today's daily-summary, which
    includes per-set `completed_at` data), this comes pre-aggregated from
    SparkyFitness's own dashboard endpoint with no set-level detail, so it
    can't apply the same "at least one set actually checked off" filter — a
    workout plan that pre-fills days ahead of time may inflate these weekly
    numbers until you've actually done those sessions. See the README."""
    key_stats = dashboard.get("keyStats") or {}
    consistency = dashboard.get("consistencyData") or {}
    muscle_volume = dashboard.get("muscleGroupVolume") or {}
    return {
        "weekly_workouts": key_stats.get("totalWorkouts"),
        "weekly_volume": _round_or_none(key_stats.get("totalVolume")),
        "weekly_reps": key_stats.get("totalReps"),
        "workout_streak": consistency.get("currentStreak"),
        "workout_longest_streak": consistency.get("longestStreak"),
        "weekly_frequency": _round_or_none(consistency.get("weeklyFrequency")),
        "muscle_group_volume": {
            k: _round_or_none(v) for k, v in muscle_volume.items()
        },
    }


def _exercise_dashboard_monthly_summary(dashboard: dict) -> dict:
    """Same report as _exercise_dashboard_summary, but fetched over the full
    trend window (30 days by default) instead of a fixed 7 days — gives a
    longer-range workout count/volume/reps distinct from the weekly_*
    sensors. Streak fields are deliberately not duplicated here since
    workout_streak/workout_longest_streak already reflect all-time
    consistency regardless of which window's report they come from."""
    key_stats = dashboard.get("keyStats") or {}
    return {
        "monthly_workouts": key_stats.get("totalWorkouts"),
        "monthly_volume": _round_or_none(key_stats.get("totalVolume")),
        "monthly_reps": key_stats.get("totalReps"),
    }


def _custom_measurement_sensors(categories: list, values: dict) -> dict:
    """One entry per custom measurement category: {category_id: {name, value, date, unit_hint}}.

    Categories that have never had a single value logged (SparkyFitness marks
    these with measurement_type "N/A" — a real, in-use category always has a
    unit) AND have no value within the current trend window are skipped
    entirely, rather than getting a sensor that can only ever read
    "unknown". This is what a wearable-sync integration typically leaves
    behind: placeholder categories it created but never actually populated.
    A category with a real unit but simply no *recent* entry still gets a
    sensor (legitimately "unknown" until its next log), since that's an
    actively-used metric rather than dead clutter."""
    result = {}
    for cat in categories:
        cat_id = cat.get("id")
        if not cat_id:
            continue
        latest = values.get(cat_id) or {}
        has_value = latest.get("value") is not None
        measurement_type = cat.get("measurement_type")
        has_real_unit = bool(measurement_type) and measurement_type != "N/A"
        if not has_value and not has_real_unit:
            continue
        result[cat_id] = {
            "name": cat.get("display_name") or cat.get("name") or cat_id,
            "measurement_type": measurement_type,
            "data_type": cat.get("data_type"),
            "value": latest.get("value"),
            "date": latest.get("date"),
        }
    return result


def _adaptive_tdee_summary(tdee_data: dict) -> dict:
    return {
        "adaptive_tdee": _round_or_none(tdee_data.get("tdee")),
        "adaptive_tdee_confidence": tdee_data.get("confidence"),
        "adaptive_tdee_is_fallback": tdee_data.get("isFallback"),
        "adaptive_tdee_fallback_reason": tdee_data.get("fallbackReason"),
        "adaptive_tdee_days_of_data": tdee_data.get("daysOfData"),
    }


# SparkyFitness returns this shape whether or not you've actually set a
# primary container: {id: null, name: 'Default Container', volume: 2000,
# unit: 'ml', is_primary: true} is the server's own fallback.
_DEFAULT_WATER_CONTAINER_ML = 2000


def _water_container_summary(container: dict) -> dict:
    volume = container.get("volume")
    unit = (container.get("unit") or "ml").lower()
    volume_ml = volume if unit in ("ml", "milliliter", "milliliters") else None
    if volume_ml is None and isinstance(volume, (int, float)) and unit in ("l", "liter", "liters"):
        volume_ml = volume * 1000
    return {
        "water_container_name": container.get("name") or "Default Container",
        "water_container_ml": volume_ml or _DEFAULT_WATER_CONTAINER_ML,
    }


class SparkyFitnessCoordinator(DataUpdateCoordinator[dict]):
    """Polls the SparkyFitness server and flattens the result for sensors."""

    def __init__(
        self,
        hass: HomeAssistant,
        client: SparkyFitnessApiClient,
        update_interval_minutes: int,
        trend_window_days: int = DEFAULT_TREND_WINDOW_DAYS,
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(minutes=update_interval_minutes),
        )
        self.client = client
        self.trend_window_days = trend_window_days

    async def _async_update_data(self) -> dict:
        today = dt_util.now().date()
        try:
            result = await self.client.async_get_data(
                today, trend_window_days=self.trend_window_days
            )
        except SparkyFitnessAuthError as err:
            # Raising this specific exception (rather than UpdateFailed) is what
            # makes HA offer reauth — on both the first refresh and later polls.
            raise ConfigEntryAuthFailed(str(err)) from err
        except SparkyFitnessApiError as err:
            raise UpdateFailed(str(err)) from err

        summary = result.daily_summary
        check_in = result.check_in
        latest_check_in = result.latest_check_in
        exercise_sessions = _get(summary, "exerciseSessions", default=[]) or []
        exercise_summary = _summarize_exercise_sessions(exercise_sessions)
        food_entries = _get(summary, "foodEntries", default=[]) or []

        # Weight/height/body fat come from the "latest on or before today"
        # snapshot, which still has a value on days you didn't log a fresh
        # check-in. Steps come from the exact-date check-in since that's a
        # per-day count that should genuinely reset.
        weight = _get(latest_check_in, "weight")
        height = _get(latest_check_in, "height")

        return {
            "date": result.date,
            "calories_eaten": _get(summary, "calorieBalance", "eaten"),
            "calories_burned": _get(summary, "calorieBalance", "burned"),
            "calories_remaining": _get(summary, "calorieBalance", "remaining"),
            "calorie_goal": _get(summary, "calorieBalance", "goal"),
            "net_calories": _get(summary, "calorieBalance", "net"),
            "calorie_progress": _get(summary, "calorieBalance", "progress"),
            "bmr": _get(summary, "calorieBalance", "bmr"),
            "water_intake_ml": _get(summary, "waterIntake"),
            "step_calories": _get(summary, "stepCalories"),
            "food_entries_logged": len(food_entries),
            "weight": weight,
            "body_fat": _get(latest_check_in, "body_fat_percentage"),
            "bmi": _compute_bmi(weight, height),
            "height": height,
            "measurement_date": _get(latest_check_in, "entry_date"),
            "steps": _get(check_in, "steps"),
            **exercise_summary,
            # Macros eaten today + today's goals.
            "protein_eaten": _sum_food_macro(food_entries, "protein"),
            "carbs_eaten": _sum_food_macro(food_entries, "carbs"),
            "fat_eaten": _sum_food_macro(food_entries, "fat"),
            **_extract_macro_goals(summary),
            # Rolling trends + logging streak.
            **_nutrition_trend_stats(result.nutrition_trends, today),
            # Weight trend across the polled window.
            **_weight_trend(result.check_in_range),
            "avg_weight_30d": _avg_weight_30d(result.check_in_range, today),
            # Sleep, mood, fasting.
            **_latest_sleep(result.sleep_entries),
            **_mood_summary(result.mood),
            **_fasting_summary(result.fasting_current),
            # Weekly + 30-day exercise stats.
            **_exercise_dashboard_summary(result.exercise_dashboard),
            **_exercise_dashboard_monthly_summary(result.exercise_dashboard_monthly),
            # Dynamic custom measurement categories (blood pressure, etc.).
            "custom_categories": result.custom_categories,
            "custom_measurements": _custom_measurement_sensors(
                result.custom_categories, result.custom_measurements
            ),
            # Adaptive TDEE estimate + preferred water container size.
            **_adaptive_tdee_summary(result.adaptive_tdee),
            **_water_container_summary(result.primary_water_container),
            # Raw payloads kept around as extra entity attributes.
            "_raw_daily_summary": summary,
            "_raw_check_in": check_in,
            "_raw_latest_check_in": latest_check_in,
        }
