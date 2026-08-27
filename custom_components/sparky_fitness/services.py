"""Write-back services for SparkyFitness.

log_water / log_weight call SparkyFitness's POST /api/health-data endpoint
(the same one used by iOS Shortcuts / Android integrations upstream).

log_food / log_exercise are "quick log" helpers for automations/voice
assistants: they search SparkyFitness's own food/exercise database by name,
log the closest match, and report back what was actually logged (since a
fuzzy name match might not be what you expected).

All four use the same personal API key already configured for reading data —
SparkyFitness's API key creation flow has no way to mint a narrower
"write-only" key, so there's nothing extra to set up.
"""

from __future__ import annotations

import logging
from datetime import date as date_type

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import ServiceValidationError
from homeassistant.util import dt as dt_util

from .api import SparkyFitnessApiError
from .const import DOMAIN
from .coordinator import (
    SparkyFitnessCoordinator,
    _exercise_one_rm_trend,
    _get,
    _muscle_group_summary,
    _summarize_exercise_sessions,
)

_LOGGER = logging.getLogger(__name__)

SERVICE_LOG_WATER = "log_water"
SERVICE_LOG_WEIGHT = "log_weight"
SERVICE_LOG_FOOD = "log_food"
SERVICE_LOG_EXERCISE = "log_exercise"
SERVICE_SEARCH_FOOD_CHOICES = "search_food_choices"
SERVICE_LOG_FOOD_CHOICE = "log_food_choice"
SERVICE_SEARCH_EXERCISE_CHOICES = "search_exercise_choices"
SERVICE_LOG_EXERCISE_CHOICE = "log_exercise_choice"
SERVICE_GET_EXERCISE_HISTORY = "get_exercise_history"
SERVICE_GET_MUSCLE_GROUP_SUMMARY = "get_muscle_group_summary"
SERVICE_GET_EXERCISE_TREND = "get_exercise_trend"
SERVICE_GET_ONE_REP_MAXES = "get_one_rep_maxes"

ATTR_VALUE = "value"
ATTR_CONFIG_ENTRY_ID = "config_entry_id"
ATTR_NAME = "name"
ATTR_MEAL_TYPE = "meal_type"
ATTR_SERVINGS = "servings"
ATTR_DURATION_MINUTES = "duration_minutes"
ATTR_LIMIT = "limit"
ATTR_FOOD_ID = "food_id"
ATTR_VARIANT_ID = "variant_id"
ATTR_QUANTITY = "quantity"
ATTR_UNIT = "unit"
ATTR_EXERCISE_ID = "exercise_id"
ATTR_DAYS = "days"
ATTR_END_DATE = "end_date"
ATTR_SESSIONS = "sessions"

_ALL_SERVICES = (
    SERVICE_LOG_WATER,
    SERVICE_LOG_WEIGHT,
    SERVICE_LOG_FOOD,
    SERVICE_LOG_EXERCISE,
    SERVICE_SEARCH_FOOD_CHOICES,
    SERVICE_LOG_FOOD_CHOICE,
    SERVICE_SEARCH_EXERCISE_CHOICES,
    SERVICE_LOG_EXERCISE_CHOICE,
    SERVICE_GET_EXERCISE_HISTORY,
    SERVICE_GET_MUSCLE_GROUP_SUMMARY,
    SERVICE_GET_EXERCISE_TREND,
    SERVICE_GET_ONE_REP_MAXES,
)

_LOG_VALUE_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_VALUE): vol.Coerce(float),
        vol.Optional(ATTR_CONFIG_ENTRY_ID): str,
    }
)

_LOG_FOOD_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_NAME): str,
        vol.Optional(ATTR_MEAL_TYPE, default="snacks"): str,
        vol.Optional(ATTR_SERVINGS, default=1.0): vol.All(
            vol.Coerce(float), vol.Range(min=0.01)
        ),
        vol.Optional(ATTR_CONFIG_ENTRY_ID): str,
    }
)

_LOG_EXERCISE_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_NAME): str,
        vol.Required(ATTR_DURATION_MINUTES): vol.All(
            vol.Coerce(float), vol.Range(min=0.1)
        ),
        vol.Optional(ATTR_CONFIG_ENTRY_ID): str,
    }
)

_SEARCH_FOOD_CHOICES_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_NAME): str,
        vol.Optional(ATTR_LIMIT, default=5): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=10)
        ),
        vol.Optional(ATTR_CONFIG_ENTRY_ID): str,
    }
)

_SEARCH_EXERCISE_CHOICES_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_NAME): str,
        vol.Optional(ATTR_LIMIT, default=5): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=10)
        ),
        vol.Optional(ATTR_CONFIG_ENTRY_ID): str,
    }
)

_LOG_EXERCISE_CHOICE_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_EXERCISE_ID): str,
        vol.Required(ATTR_DURATION_MINUTES): vol.All(
            vol.Coerce(float), vol.Range(min=0.1)
        ),
        vol.Optional(ATTR_CONFIG_ENTRY_ID): str,
    }
)

_GET_EXERCISE_HISTORY_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_DAYS, default=14): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=90)
        ),
        vol.Optional(ATTR_CONFIG_ENTRY_ID): str,
    }
)

def _iso_date(value: str) -> date_type:
    try:
        return date_type.fromisoformat(value)
    except (TypeError, ValueError) as err:
        raise vol.Invalid(f"'{value}' is not a valid YYYY-MM-DD date") from err


_GET_MUSCLE_GROUP_SUMMARY_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_DAYS, default=7): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=90)
        ),
        vol.Optional(ATTR_END_DATE): _iso_date,
        vol.Optional(ATTR_CONFIG_ENTRY_ID): str,
    }
)

_GET_EXERCISE_TREND_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_NAME): str,
        vol.Optional(ATTR_SESSIONS, default=20): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=50)
        ),
        vol.Optional(ATTR_CONFIG_ENTRY_ID): str,
    }
)

_GET_ONE_REP_MAXES_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_CONFIG_ENTRY_ID): str,
    }
)

_LOG_FOOD_CHOICE_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_FOOD_ID): str,
        vol.Optional(ATTR_VARIANT_ID): str,
        vol.Required(ATTR_QUANTITY): vol.All(vol.Coerce(float), vol.Range(min=0.01)),
        vol.Optional(ATTR_UNIT): str,
        vol.Optional(ATTR_MEAL_TYPE, default="snacks"): str,
        vol.Optional(ATTR_CONFIG_ENTRY_ID): str,
    }
)


def _resolve_coordinator(hass: HomeAssistant, call: ServiceCall) -> SparkyFitnessCoordinator:
    """Pick which configured SparkyFitness server a service call targets."""
    coordinators: dict[str, SparkyFitnessCoordinator] = hass.data.get(DOMAIN, {})
    if not coordinators:
        raise ServiceValidationError("No SparkyFitness integration is configured.")

    entry_id = call.data.get(ATTR_CONFIG_ENTRY_ID)
    if entry_id:
        coordinator = coordinators.get(entry_id)
        if coordinator is None:
            raise ServiceValidationError(
                f"Unknown SparkyFitness config_entry_id '{entry_id}'. "
                f"Configured entries: {', '.join(coordinators)}"
            )
        return coordinator

    if len(coordinators) == 1:
        return next(iter(coordinators.values()))

    raise ServiceValidationError(
        "More than one SparkyFitness server is configured — pass "
        f"config_entry_id to pick one. Configured entries: {', '.join(coordinators)}"
    )


async def _handle_log_value(hass: HomeAssistant, call: ServiceCall, data_type: str) -> None:
    coordinator = _resolve_coordinator(hass, call)
    value = call.data[ATTR_VALUE]
    try:
        await coordinator.client.async_log_health_data(
            value, data_type, dt_util.now().date()
        )
    except SparkyFitnessApiError as err:
        raise ServiceValidationError(f"SparkyFitness rejected the write: {err}") from err
    await coordinator.async_request_refresh()


def _usable_variant(match: dict) -> dict | None:
    """A search result is only loggable if it has a real default_variant with
    an id — some entries (e.g. certain restaurant items) come back from
    SparkyFitness's search with an empty `variants: []`, and attempting to log
    those 500s server-side ("Food or variant not found for snapshotting").
    Filtering them out here means voice/chat logging silently tries the next
    real candidate instead of surfacing that as a confusing failure."""
    variant = match.get("default_variant") or {}
    if not variant.get("id"):
        return None
    return variant


async def _handle_log_food(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    coordinator = _resolve_coordinator(hass, call)
    name = call.data[ATTR_NAME]
    meal_type = call.data[ATTR_MEAL_TYPE]
    servings = call.data[ATTR_SERVINGS]

    try:
        results = await coordinator.client.async_search_foods(name)
    except SparkyFitnessApiError as err:
        raise ServiceValidationError(f"SparkyFitness food search failed: {err}") from err
    if not results:
        raise ServiceValidationError(f"No food found in SparkyFitness matching '{name}'.")

    match = None
    variant = None
    for candidate in results:
        usable = _usable_variant(candidate)
        if usable is not None:
            match, variant = candidate, usable
            break
    if match is None:
        raise ServiceValidationError(
            f"Found {len(results)} match(es) for '{name}' in SparkyFitness, but none "
            "have a loggable serving size — try a more specific name."
        )
    serving_size = variant.get("serving_size") or 100
    quantity = serving_size * servings

    try:
        await coordinator.client.async_log_food(
            food_id=match["id"],
            variant_id=variant.get("id"),
            quantity=quantity,
            unit=variant.get("serving_unit"),
            meal_type=meal_type,
            for_date=dt_util.now().date(),
        )
    except SparkyFitnessApiError as err:
        raise ServiceValidationError(
            f"SparkyFitness rejected the food entry (check that '{meal_type}' is a "
            f"valid meal type in your SparkyFitness account): {err}"
        ) from err
    await coordinator.async_request_refresh()

    return {
        "logged_food": match.get("name"),
        "brand": match.get("brand"),
        "servings": servings,
        "quantity": quantity,
        "unit": variant.get("serving_unit"),
        "meal_type": meal_type,
    }


async def _handle_log_exercise(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    coordinator = _resolve_coordinator(hass, call)
    name = call.data[ATTR_NAME]
    duration_minutes = call.data[ATTR_DURATION_MINUTES]

    try:
        results = await coordinator.client.async_search_exercises(name)
    except SparkyFitnessApiError as err:
        raise ServiceValidationError(f"SparkyFitness exercise search failed: {err}") from err
    if not results:
        raise ServiceValidationError(
            f"No exercise found in SparkyFitness matching '{name}'."
        )

    match = results[0]
    try:
        logged = await coordinator.client.async_log_exercise(
            exercise_id=match["id"],
            duration_minutes=duration_minutes,
            for_date=dt_util.now().date(),
        )
    except SparkyFitnessApiError as err:
        raise ServiceValidationError(f"SparkyFitness rejected the exercise entry: {err}") from err
    await coordinator.async_request_refresh()

    return {
        "logged_exercise": match.get("name"),
        "duration_minutes": duration_minutes,
        "calories_burned": logged.get("calories_burned"),
    }


async def _handle_search_exercise_choices(
    hass: HomeAssistant, call: ServiceCall
) -> ServiceResponse:
    """Read-only exercise search — same "let the user pick" pattern as
    search_food_choices, for callers like the chat card."""
    coordinator = _resolve_coordinator(hass, call)
    name = call.data[ATTR_NAME]
    limit = call.data[ATTR_LIMIT]

    try:
        results = await coordinator.client.async_search_exercises(name)
    except SparkyFitnessApiError as err:
        raise ServiceValidationError(f"SparkyFitness exercise search failed: {err}") from err

    choices = [
        {
            "exercise_id": match.get("id"),
            "name": match.get("name"),
            "category": match.get("category"),
            "calories_per_hour": match.get("calories_per_hour"),
        }
        for match in results[:limit]
    ]
    return {"query": name, "choices": choices}


async def _handle_log_exercise_choice(
    hass: HomeAssistant, call: ServiceCall
) -> ServiceResponse:
    """Log one specific, already-identified exercise — the follow-up half of
    search_exercise_choices once the user has picked which match they meant."""
    coordinator = _resolve_coordinator(hass, call)
    exercise_id = call.data[ATTR_EXERCISE_ID]
    duration_minutes = call.data[ATTR_DURATION_MINUTES]

    try:
        logged = await coordinator.client.async_log_exercise(
            exercise_id=exercise_id,
            duration_minutes=duration_minutes,
            for_date=dt_util.now().date(),
        )
    except SparkyFitnessApiError as err:
        raise ServiceValidationError(f"SparkyFitness rejected the exercise entry: {err}") from err
    await coordinator.async_request_refresh()

    return {
        "exercise_id": exercise_id,
        "duration_minutes": duration_minutes,
        "calories_burned": logged.get("calories_burned"),
    }


async def _handle_search_food_choices(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    """Read-only search — lets a caller (e.g. the SparkyFitness chat card)
    show multiple candidates and let the user pick, instead of log_food's
    auto-pick-the-first-match behavior."""
    coordinator = _resolve_coordinator(hass, call)
    name = call.data[ATTR_NAME]
    limit = call.data[ATTR_LIMIT]

    try:
        results = await coordinator.client.async_search_foods(name)
    except SparkyFitnessApiError as err:
        raise ServiceValidationError(f"SparkyFitness food search failed: {err}") from err

    # Skip candidates with no loggable default_variant (see _usable_variant) so
    # every option shown to the user actually works when picked.
    choices = []
    for match in results:
        variant = _usable_variant(match)
        if variant is None:
            continue
        choices.append(
            {
                "food_id": match.get("id"),
                "variant_id": variant.get("id"),
                "name": match.get("name"),
                "brand": match.get("brand"),
                "calories": variant.get("calories"),
                "serving_size": variant.get("serving_size") or 100,
                "serving_unit": variant.get("serving_unit"),
            }
        )
        if len(choices) >= limit:
            break
    return {"query": name, "choices": choices}


async def _handle_log_food_choice(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    """Log one specific, already-identified food — the follow-up half of
    search_food_choices once the user has picked which match they meant."""
    coordinator = _resolve_coordinator(hass, call)
    food_id = call.data[ATTR_FOOD_ID]
    variant_id = call.data.get(ATTR_VARIANT_ID)
    quantity = call.data[ATTR_QUANTITY]
    unit = call.data.get(ATTR_UNIT)
    meal_type = call.data[ATTR_MEAL_TYPE]

    try:
        await coordinator.client.async_log_food(
            food_id=food_id,
            variant_id=variant_id,
            quantity=quantity,
            unit=unit,
            meal_type=meal_type,
            for_date=dt_util.now().date(),
        )
    except SparkyFitnessApiError as err:
        raise ServiceValidationError(
            f"SparkyFitness rejected the food entry (check that '{meal_type}' is a "
            f"valid meal type in your SparkyFitness account): {err}"
        ) from err
    await coordinator.async_request_refresh()

    # The caller (e.g. the chat card) already knows which candidate's name
    # this was — from its own earlier search_food_choices call — so this just
    # echoes back what was actually sent rather than re-parsing the POST
    # response's shape, which SparkyFitness doesn't document.
    return {
        "food_id": food_id,
        "quantity": quantity,
        "unit": unit,
        "meal_type": meal_type,
    }


async def _handle_get_exercise_history(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    """Read-only, on-demand exercise history for the exercise-history card —
    NOT part of the regular poll cycle (it fetches one daily-summary per day
    in the range, so it's deliberately something a card calls when it loads
    rather than something the coordinator does every 15 minutes).

    Reuses the exact same "actually completed" filtering as
    workout_logged_today / weekly_workouts (via _summarize_exercise_sessions
    in coordinator.py) so a day that's only a pre-filled, not-yet-started
    workout-plan entry doesn't show up here as a workout either. Days with
    no completed workout are omitted from the returned list entirely — this
    is a *history of workouts*, not a full calendar of every day."""
    coordinator = _resolve_coordinator(hass, call)
    days = call.data[ATTR_DAYS]

    try:
        raw_days = await coordinator.client.async_get_daily_summaries_range(
            dt_util.now().date(), days
        )
    except SparkyFitnessApiError as err:
        raise ServiceValidationError(
            f"SparkyFitness exercise history fetch failed: {err}"
        ) from err

    history = []
    for day in raw_days:
        sessions = _get(day["summary"], "exerciseSessions", default=[]) or []
        summary = _summarize_exercise_sessions(sessions)
        if not summary["workout_count"]:
            continue
        history.append(
            {
                "date": day["date"],
                "workout_names": summary["workout_names"],
                "workout_count": summary["workout_count"],
                "total_exercise_calories": summary["total_exercise_calories"],
                "total_exercise_minutes": summary["total_exercise_minutes"],
            }
        )
    return {"days": history}


async def _handle_get_muscle_group_summary(
    hass: HomeAssistant, call: ServiceCall
) -> ServiceResponse:
    """Read-only, on-demand sets-per-muscle-group breakdown for the muscle-map
    card — like get_exercise_history, this fetches one daily-summary per day
    in range rather than running on the regular poll cycle.

    `end_date` lets the card page backward/forward by week (e.g. "last week"),
    defaulting to today so a plain call with just `days` gives "the last N
    days including today," matching get_exercise_history's default framing.

    See _muscle_group_summary in coordinator.py for how sets are counted and
    attributed to muscle groups — in short: primary muscles get full credit,
    secondary muscles get half credit, and exercises with no muscle/category
    data from SparkyFitness's catalog are skipped since there's nothing to
    attribute them to."""
    coordinator = _resolve_coordinator(hass, call)
    days = call.data[ATTR_DAYS]
    end_date = call.data.get(ATTR_END_DATE) or dt_util.now().date()

    try:
        raw_days = await coordinator.client.async_get_daily_summaries_range(
            end_date, days
        )
    except SparkyFitnessApiError as err:
        raise ServiceValidationError(
            f"SparkyFitness muscle group summary fetch failed: {err}"
        ) from err

    muscle_groups = _muscle_group_summary(raw_days)
    start_date = raw_days[-1]["date"] if raw_days else end_date.isoformat()
    return {
        "muscle_groups": muscle_groups,
        "total_sets": round(sum(muscle_groups.values()), 1),
        "start_date": start_date,
        "end_date": end_date.isoformat(),
        "days": days,
    }


async def _handle_get_exercise_trend(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    """Read-only, on-demand one-rep-max trend for a single exercise, for the
    exercise-trend dashboard card. Resolves `name` to an exercise_id the same
    way log_exercise does (first search match), then pulls that exercise's
    recent session history in a single request (unlike get_exercise_history/
    get_muscle_group_summary, which fetch one daily-summary per calendar day,
    /api/v2/exercise-entries/history is already filtered server-side to
    sessions containing this exercise, so `sessions` counts workouts, not
    days) and estimates a 1RM per session via the Epley formula — see
    _exercise_one_rm_trend in coordinator.py."""
    coordinator = _resolve_coordinator(hass, call)
    name = call.data[ATTR_NAME]
    sessions = call.data[ATTR_SESSIONS]

    try:
        results = await coordinator.client.async_search_exercises(name)
    except SparkyFitnessApiError as err:
        raise ServiceValidationError(f"SparkyFitness exercise search failed: {err}") from err
    if not results:
        raise ServiceValidationError(f"No exercise found in SparkyFitness matching '{name}'.")
    match = results[0]
    exercise_id = match["id"]

    try:
        raw_sessions = await coordinator.client.async_get_exercise_entry_history(
            exercise_id, page_size=sessions
        )
    except SparkyFitnessApiError as err:
        raise ServiceValidationError(
            f"SparkyFitness exercise trend fetch failed: {err}"
        ) from err

    points = _exercise_one_rm_trend(raw_sessions, exercise_id)
    if not points:
        return {
            "exercise_id": exercise_id,
            "exercise_name": match.get("name"),
            "points": [],
            "current_one_rm": None,
            "best_one_rm": None,
            "best_one_rm_date": None,
            "change_since_first": None,
            "change_percent": None,
            "sessions_analyzed": 0,
        }

    best_point = max(points, key=lambda p: p["estimated_one_rm"])
    first_one_rm = points[0]["estimated_one_rm"]
    current_one_rm = points[-1]["estimated_one_rm"]
    change = round(current_one_rm - first_one_rm, 1)
    change_percent = round(change / first_one_rm * 100, 1) if first_one_rm else None

    return {
        "exercise_id": exercise_id,
        "exercise_name": match.get("name"),
        "points": points,
        "current_one_rm": current_one_rm,
        "best_one_rm": best_point["estimated_one_rm"],
        "best_one_rm_date": best_point["date"],
        "change_since_first": change,
        "change_percent": change_percent,
        "sessions_analyzed": len(points),
    }


async def _handle_get_one_rep_maxes(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    """Read-only current estimated one-rep-maxes across all strength
    exercises, for the personal-records dashboard card — straight from
    SparkyFitness's own Personal Records matrix (/api/exercise-stats/prs).
    Only the strength side (`strength1RMs`, up to 10 exercises) is surfaced
    here; the endpoint's cardio distance-milestone PRs use a different shape
    and aren't part of "one rep max."""
    coordinator = _resolve_coordinator(hass, call)
    try:
        prs = await coordinator.client.async_get_exercise_prs()
    except SparkyFitnessApiError as err:
        raise ServiceValidationError(
            f"SparkyFitness personal records fetch failed: {err}"
        ) from err

    lifts = [
        {
            "exercise_name": lift.get("exerciseName"),
            "estimated_one_rm": lift.get("estimatedOneRMKg"),
            "weight": lift.get("weightKg"),
            "reps": lift.get("reps"),
            "achieved_at": lift.get("achievedAt"),
        }
        for lift in (prs.get("strength1RMs") or [])
    ]
    return {"lifts": lifts}


async def async_setup_services(hass: HomeAssistant) -> None:
    """Register the domain-level services (idempotent across config entries)."""
    if hass.services.has_service(DOMAIN, SERVICE_LOG_WATER):
        return

    async def handle_log_water(call: ServiceCall) -> None:
        await _handle_log_value(hass, call, "water")

    async def handle_log_weight(call: ServiceCall) -> None:
        await _handle_log_value(hass, call, "weight")

    async def handle_log_food(call: ServiceCall) -> ServiceResponse:
        return await _handle_log_food(hass, call)

    async def handle_log_exercise(call: ServiceCall) -> ServiceResponse:
        return await _handle_log_exercise(hass, call)

    hass.services.async_register(
        DOMAIN, SERVICE_LOG_WATER, handle_log_water, schema=_LOG_VALUE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_LOG_WEIGHT, handle_log_weight, schema=_LOG_VALUE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_LOG_FOOD,
        handle_log_food,
        schema=_LOG_FOOD_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_LOG_EXERCISE,
        handle_log_exercise,
        schema=_LOG_EXERCISE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def handle_search_food_choices(call: ServiceCall) -> ServiceResponse:
        return await _handle_search_food_choices(hass, call)

    async def handle_log_food_choice(call: ServiceCall) -> ServiceResponse:
        return await _handle_log_food_choice(hass, call)

    hass.services.async_register(
        DOMAIN,
        SERVICE_SEARCH_FOOD_CHOICES,
        handle_search_food_choices,
        schema=_SEARCH_FOOD_CHOICES_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_LOG_FOOD_CHOICE,
        handle_log_food_choice,
        schema=_LOG_FOOD_CHOICE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def handle_search_exercise_choices(call: ServiceCall) -> ServiceResponse:
        return await _handle_search_exercise_choices(hass, call)

    async def handle_log_exercise_choice(call: ServiceCall) -> ServiceResponse:
        return await _handle_log_exercise_choice(hass, call)

    hass.services.async_register(
        DOMAIN,
        SERVICE_SEARCH_EXERCISE_CHOICES,
        handle_search_exercise_choices,
        schema=_SEARCH_EXERCISE_CHOICES_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_LOG_EXERCISE_CHOICE,
        handle_log_exercise_choice,
        schema=_LOG_EXERCISE_CHOICE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )

    async def handle_get_exercise_history(call: ServiceCall) -> ServiceResponse:
        return await _handle_get_exercise_history(hass, call)

    hass.services.async_register(
        DOMAIN,
        SERVICE_GET_EXERCISE_HISTORY,
        handle_get_exercise_history,
        schema=_GET_EXERCISE_HISTORY_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )

    async def handle_get_muscle_group_summary(call: ServiceCall) -> ServiceResponse:
        return await _handle_get_muscle_group_summary(hass, call)

    hass.services.async_register(
        DOMAIN,
        SERVICE_GET_MUSCLE_GROUP_SUMMARY,
        handle_get_muscle_group_summary,
        schema=_GET_MUSCLE_GROUP_SUMMARY_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )

    async def handle_get_exercise_trend(call: ServiceCall) -> ServiceResponse:
        return await _handle_get_exercise_trend(hass, call)

    hass.services.async_register(
        DOMAIN,
        SERVICE_GET_EXERCISE_TREND,
        handle_get_exercise_trend,
        schema=_GET_EXERCISE_TREND_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )

    async def handle_get_one_rep_maxes(call: ServiceCall) -> ServiceResponse:
        return await _handle_get_one_rep_maxes(hass, call)

    hass.services.async_register(
        DOMAIN,
        SERVICE_GET_ONE_REP_MAXES,
        handle_get_one_rep_maxes,
        schema=_GET_ONE_REP_MAXES_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )


async def async_unload_services(hass: HomeAssistant) -> None:
    """Remove services once no SparkyFitness config entries remain."""
    if hass.data.get(DOMAIN):
        return
    for service in _ALL_SERVICES:
        hass.services.async_remove(DOMAIN, service)
