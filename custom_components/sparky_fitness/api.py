"""Minimal async API client for a self-hosted SparkyFitness server.

Endpoints used (all confirmed against SparkyFitness's own server source, since
its API docs don't fully match the real field names/behavior):

  * GET  /api/daily-summary?date=YYYY-MM-DD
        Goals, calorie balance, water, food entries (for macros), exercise
        sessions. Also called once per day over a range (N parallel
        requests, no dedicated range endpoint exists) for the
        get_exercise_history service backing the exercise-history card.
  * GET  /api/measurements/check-in/{date}
        Check-in fields for that *exact* day only (used here just for
        `steps`, which is meant to reset daily).
  * GET  /api/measurements/check-in/latest-on-or-before-date?date=...
        Most recently logged weight/height/body_fat_percentage as of that
        day (the same "carry forward" lookup SparkyFitness itself uses for
        BMR calculations) so these don't go unknown on days without a fresh
        weigh-in.
  * GET  /api/measurements/check-in-measurements-range/{start}/{end}
        Check-in rows across a date range, used to derive a weight trend.
  * GET  /api/reports/mini-nutrition-trends?userId=&startDate=&endDate=
        Per-day nutrition totals for days that have food logged (days with
        nothing logged simply don't appear in the result) — used for
        rolling averages and the logging streak.
  * GET  /api/sleep?startDate=&endDate=
        Sleep entries in a range; used for "last night's sleep."
  * GET  /api/mood/date/{date}
        Today's mood entry, if any.
  * GET  /api/fasting/current
        The currently active fast, if any.
  * GET  /api/measurements/custom-categories
        Your user-defined custom measurement categories (e.g. blood pressure).
  * GET  /api/measurements/custom-measurements-range/{categoryId}/{start}/{end}
        Latest logged value per custom category (one call per category).
  * GET  /api/reports/exercise-dashboard?startDate=&endDate=
        Weekly workout volume/reps, workout streak (SparkyFitness's own
        consistency calc, already excludes auto-synced "Active Calories"),
        and muscle-group volume breakdown. Called twice per poll: once with
        a fixed 7-day window (weekly_* sensors) and once with the full trend
        window (monthly_* sensors, 30 days by default).
  * GET  /api/adaptive-tdee
        SparkyFitness's rolling TDEE estimate from actual logged weight/intake
        (only meaningful once you have enough history — see `is_fallback`).
  * GET  /api/water-containers/primary
        Your preferred water container (falls back to a 2000 mL default if
        you haven't set one) — used to size the water-logging button.
  * GET  /api/foods/search?name=&broadMatch=true
        Food search, used to resolve a name to a food_id/variant_id for
        the `log_food` service.
  * GET  /api/exercises/search?searchTerm=
        Exercise search, used to resolve a name to an exercise_id for the
        `log_exercise` service.
  * POST /api/health-data
        Write-back for `log_water` / `log_weight` services.
        Body: [{"value": <number>, "type": "water"|"weight", "date": "YYYY-MM-DD"}]
  * POST /api/food-entries
        Write-back for the `log_food` service.
  * POST /api/exercise-entries
        Write-back for the `log_exercise` service (SparkyFitness
        auto-calculates calories_burned from the exercise's calories_per_hour
        when it's omitted).

All endpoints are reached through SparkyFitness's unified `authenticate`
middleware, which accepts a personal API key as a Bearer token (the same key
used for the SparkyFitness MCP server / mobile app), so no separate login
flow or JWT refresh is required. Access to your *own* data is always
permitted regardless of the key's granted permission scopes — including
writes through /api/health-data, which SparkyFitness's own API-key creation
endpoint has no way to scope down anyway (it always mints a full-access
personal key).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import date as date_type
from typing import Any

import aiohttp


class SparkyFitnessApiError(Exception):
    """Base error for SparkyFitness API problems."""


class SparkyFitnessAuthError(SparkyFitnessApiError):
    """Raised when the API key is missing, invalid, or expired."""


class SparkyFitnessConnectionError(SparkyFitnessApiError):
    """Raised when the server cannot be reached."""


@dataclass
class SparkyFitnessData:
    """Container for a single poll's worth of data."""

    date: str
    daily_summary: dict[str, Any] = field(default_factory=dict)
    check_in: dict[str, Any] = field(default_factory=dict)
    latest_check_in: dict[str, Any] = field(default_factory=dict)
    check_in_range: list[dict[str, Any]] = field(default_factory=list)
    nutrition_trends: list[dict[str, Any]] = field(default_factory=list)
    sleep_entries: list[dict[str, Any]] = field(default_factory=list)
    mood: dict[str, Any] = field(default_factory=dict)
    fasting_current: dict[str, Any] | None = None
    custom_categories: list[dict[str, Any]] = field(default_factory=list)
    # category_id -> most recent {value, date} within the trend window.
    custom_measurements: dict[str, dict[str, Any]] = field(default_factory=dict)
    exercise_dashboard: dict[str, Any] = field(default_factory=dict)
    # Same report as exercise_dashboard, but over the full trend window (30
    # days by default) instead of the fixed 7-day window, for longer-range
    # "monthly" workout stats distinct from the weekly_* sensors.
    exercise_dashboard_monthly: dict[str, Any] = field(default_factory=dict)
    adaptive_tdee: dict[str, Any] = field(default_factory=dict)
    primary_water_container: dict[str, Any] = field(default_factory=dict)


class SparkyFitnessApiClient:
    """Talks to a self-hosted SparkyFitness server."""

    def __init__(
        self,
        session: aiohttp.ClientSession,
        base_url: str,
        api_key: str,
        verify_ssl: bool = True,
    ) -> None:
        self._session = session
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._verify_ssl = verify_ssl

    async def async_validate(self) -> None:
        """Raise if the URL/API key combination does not work.

        Uses the check-in endpoint for "today" as a lightweight probe: it
        requires a valid identity but returns `{}` (HTTP 200) rather than an
        error when there's simply no check-in logged yet.
        """
        today = date_type.today().isoformat()
        await self._request(f"/api/measurements/check-in/{today}")

    async def async_get_data(
        self, for_date: date_type, trend_window_days: int = 30
    ) -> SparkyFitnessData:
        """Fetch everything needed for one poll for the given date."""
        date_str = for_date.isoformat()
        window_start = date_str_days_before(date_str, trend_window_days)
        sleep_start = date_str_days_before(date_str, 1)
        week_start = date_str_days_before(date_str, 6)

        (
            daily_summary,
            check_in,
            latest_check_in,
            check_in_range,
            nutrition_trends,
            sleep_entries,
            mood,
            fasting_current,
            custom_categories,
            exercise_dashboard,
            exercise_dashboard_monthly,
            adaptive_tdee,
            primary_water_container,
        ) = await asyncio.gather(
            self._request("/api/daily-summary", params={"date": date_str}),
            self._request(f"/api/measurements/check-in/{date_str}"),
            self._request(
                "/api/measurements/check-in/latest-on-or-before-date",
                params={"date": date_str},
            ),
            self._request(
                f"/api/measurements/check-in-measurements-range/{window_start}/{date_str}"
            ),
            self._request(
                "/api/reports/mini-nutrition-trends",
                params={"startDate": window_start, "endDate": date_str},
            ),
            self._request(
                "/api/sleep", params={"startDate": sleep_start, "endDate": date_str}
            ),
            self._request(f"/api/mood/date/{date_str}"),
            self._request("/api/fasting/current"),
            self._request("/api/measurements/custom-categories"),
            self._request(
                "/api/reports/exercise-dashboard",
                params={"startDate": week_start, "endDate": date_str},
            ),
            self._request(
                "/api/reports/exercise-dashboard",
                params={"startDate": window_start, "endDate": date_str},
            ),
            self._request("/api/adaptive-tdee", params={"date": date_str}),
            self._request("/api/water-containers/primary"),
        )

        custom_categories = _as_list(custom_categories)
        custom_measurements = await self._latest_custom_measurements(
            custom_categories, window_start, date_str
        )

        return SparkyFitnessData(
            date=date_str,
            daily_summary=_as_dict(daily_summary),
            check_in=_as_dict(check_in),
            latest_check_in=_as_dict(latest_check_in),
            check_in_range=_as_list(check_in_range),
            nutrition_trends=_as_list(nutrition_trends),
            sleep_entries=_as_list(sleep_entries),
            mood=_as_dict(mood),
            fasting_current=_as_dict(fasting_current) or None,
            custom_categories=custom_categories,
            custom_measurements=custom_measurements,
            exercise_dashboard=_as_dict(exercise_dashboard),
            exercise_dashboard_monthly=_as_dict(exercise_dashboard_monthly),
            adaptive_tdee=_as_dict(adaptive_tdee),
            primary_water_container=_as_dict(primary_water_container),
        )

    async def _latest_custom_measurements(
        self, categories: list[dict[str, Any]], window_start: str, date_str: str
    ) -> dict[str, dict[str, Any]]:
        """One range call per custom category, keeping only the most recent
        entry — there's no "latest across all categories" endpoint."""
        if not categories:
            return {}
        category_ids = [c["id"] for c in categories if c.get("id")]
        ranges = await asyncio.gather(
            *(
                self._request(
                    f"/api/measurements/custom-measurements-range/{cid}/{window_start}/{date_str}"
                )
                for cid in category_ids
            ),
            return_exceptions=True,
        )
        result: dict[str, dict[str, Any]] = {}
        for cid, entries in zip(category_ids, ranges):
            if isinstance(entries, BaseException):
                continue
            entries = _as_list(entries)
            if not entries:
                continue
            latest = max(entries, key=lambda e: e.get("date") or "")
            result[cid] = {"value": latest.get("value"), "date": latest.get("date")}
        return result

    async def async_get_daily_summaries_range(
        self, end_date: date_type, days: int
    ) -> list[dict[str, Any]]:
        """Fetch /api/daily-summary once per day over the last `days` days
        (most recent first) — there's no single endpoint that returns
        per-day exercise sessions across a range, only the single-day
        daily-summary used elsewhere for "today", so this is N parallel
        requests. Used for the exercise-history card's read-only service;
        not part of the regular poll cycle."""
        dates = [
            date_type.fromordinal(end_date.toordinal() - offset)
            for offset in range(days)
        ]
        summaries = await asyncio.gather(
            *(
                self._request("/api/daily-summary", params={"date": d.isoformat()})
                for d in dates
            )
        )
        return [
            {"date": d.isoformat(), "summary": _as_dict(s)}
            for d, s in zip(dates, summaries)
        ]

    async def async_search_foods(self, name: str) -> list[dict[str, Any]]:
        """Broad-match food search, used to resolve a name to a food_id for logging."""
        data = await self._request(
            "/api/foods/search", params={"name": name, "broadMatch": "true"}
        )
        return _as_list(_as_dict(data).get("searchResults"))

    async def async_search_exercises(self, search_term: str) -> list[dict[str, Any]]:
        """Exercise search, used to resolve a name to an exercise_id for logging."""
        data = await self._request(
            "/api/exercises/search", params={"searchTerm": search_term}
        )
        return _as_list(data)

    async def async_log_food(
        self,
        food_id: str,
        variant_id: str | None,
        quantity: float,
        unit: str | None,
        meal_type: str,
        for_date: date_type,
    ) -> dict[str, Any]:
        """POST a food entry (quick-log)."""
        payload = {
            "food_id": food_id,
            "variant_id": variant_id,
            "quantity": quantity,
            "unit": unit,
            "entry_date": for_date.isoformat(),
            "meal_type": meal_type,
        }
        return _as_dict(
            await self._request("/api/food-entries", method="POST", json=payload)
        )

    async def async_log_exercise(
        self, exercise_id: str, duration_minutes: float, for_date: date_type
    ) -> dict[str, Any]:
        """POST an exercise entry (quick-log). calories_burned is left out so
        SparkyFitness auto-calculates it from the exercise's calories_per_hour."""
        payload = {
            "exercise_id": exercise_id,
            "duration_minutes": duration_minutes,
            "entry_date": for_date.isoformat(),
        }
        return _as_dict(
            await self._request("/api/exercise-entries", method="POST", json=payload)
        )

    async def async_log_health_data(
        self, value: float, data_type: str, for_date: date_type
    ) -> dict[str, Any]:
        """POST a single health-data point (weight/water/etc.) back to SparkyFitness."""
        payload = [
            {"value": value, "type": data_type, "date": for_date.isoformat()}
        ]
        return _as_dict(
            await self._request("/api/health-data", method="POST", json=payload)
        )

    async def _request(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        method: str = "GET",
        json: Any = None,
    ) -> Any:
        url = f"{self._base_url}{path}"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
        }
        try:
            async with self._session.request(
                method,
                url,
                headers=headers,
                params=params,
                json=json,
                ssl=self._verify_ssl,
                timeout=aiohttp.ClientTimeout(total=20),
            ) as resp:
                if resp.status == 401:
                    raise SparkyFitnessAuthError(
                        "SparkyFitness rejected the API key (401)."
                    )
                if resp.status == 403:
                    raise SparkyFitnessAuthError(
                        "API key is valid but forbidden for this request (403)."
                    )
                if resp.status >= 400:
                    body = await resp.text()
                    raise SparkyFitnessApiError(
                        f"SparkyFitness returned HTTP {resp.status} for {path}: {body[:200]}"
                    )
                if resp.content_length == 0:
                    return None
                data = await resp.json(content_type=None)
                return data
        except SparkyFitnessApiError:
            raise
        except asyncio.TimeoutError as err:
            raise SparkyFitnessConnectionError(
                f"Timed out talking to SparkyFitness at {url}"
            ) from err
        except aiohttp.ClientError as err:
            raise SparkyFitnessConnectionError(
                f"Could not reach SparkyFitness at {url}: {err}"
            ) from err


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def date_str_days_before(date_str: str, days: int) -> str:
    """Return `date_str` minus `days` as YYYY-MM-DD, without pulling in datetime.date parsing twice."""
    from datetime import datetime, timedelta

    d = datetime.strptime(date_str, "%Y-%m-%d").date()
    return (d - timedelta(days=days)).isoformat()
