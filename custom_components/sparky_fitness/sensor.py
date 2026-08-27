"""Sensor platform for SparkyFitness."""

from __future__ import annotations

from dataclasses import dataclass

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import PERCENTAGE, UnitOfMass, UnitOfTime, UnitOfVolume
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_URL, DOMAIN, MANUFACTURER
from .coordinator import SparkyFitnessCoordinator

KCAL = "kcal"


@dataclass(frozen=True, kw_only=True)
class SparkyFitnessSensorDescription(SensorEntityDescription):
    """Adds the data key this sensor reads from the coordinator."""

    value_key: str = ""


SENSOR_DESCRIPTIONS: tuple[SparkyFitnessSensorDescription, ...] = (
    SparkyFitnessSensorDescription(
        key="calories_eaten",
        value_key="calories_eaten",
        translation_key="calories_eaten",
        native_unit_of_measurement=KCAL,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:food-apple",
    ),
    SparkyFitnessSensorDescription(
        key="calories_burned",
        value_key="calories_burned",
        translation_key="calories_burned",
        native_unit_of_measurement=KCAL,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:fire",
    ),
    SparkyFitnessSensorDescription(
        key="calories_remaining",
        value_key="calories_remaining",
        translation_key="calories_remaining",
        native_unit_of_measurement=KCAL,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:scale-balance",
    ),
    SparkyFitnessSensorDescription(
        key="calorie_goal",
        value_key="calorie_goal",
        translation_key="calorie_goal",
        native_unit_of_measurement=KCAL,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:target",
    ),
    SparkyFitnessSensorDescription(
        key="net_calories",
        value_key="net_calories",
        translation_key="net_calories",
        native_unit_of_measurement=KCAL,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:calculator",
    ),
    SparkyFitnessSensorDescription(
        key="calorie_progress",
        value_key="calorie_progress",
        translation_key="calorie_progress",
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:progress-check",
    ),
    SparkyFitnessSensorDescription(
        key="bmr",
        value_key="bmr",
        translation_key="bmr",
        native_unit_of_measurement=KCAL,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:sleep",
    ),
    SparkyFitnessSensorDescription(
        key="water_intake",
        value_key="water_intake_ml",
        translation_key="water_intake",
        device_class=SensorDeviceClass.VOLUME,
        native_unit_of_measurement=UnitOfVolume.MILLILITERS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:cup-water",
    ),
    SparkyFitnessSensorDescription(
        key="step_calories",
        value_key="step_calories",
        translation_key="step_calories",
        native_unit_of_measurement=KCAL,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:shoe-print",
    ),
    SparkyFitnessSensorDescription(
        key="steps",
        value_key="steps",
        translation_key="steps",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:walk",
    ),
    SparkyFitnessSensorDescription(
        key="food_entries_logged",
        value_key="food_entries_logged",
        translation_key="food_entries_logged",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:notebook-outline",
    ),
    SparkyFitnessSensorDescription(
        key="exercise_sessions_logged",
        value_key="exercise_sessions_logged",
        translation_key="exercise_sessions_logged",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:dumbbell",
    ),
    # SparkyFitness stores weight/height in kg/cm internally regardless of the
    # unit shown in its own UI (that conversion happens client-side), so kg
    # here is accurate rather than a guess.
    SparkyFitnessSensorDescription(
        key="weight",
        value_key="weight",
        translation_key="weight",
        device_class=SensorDeviceClass.WEIGHT,
        native_unit_of_measurement=UnitOfMass.KILOGRAMS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:scale-bathroom",
    ),
    SparkyFitnessSensorDescription(
        key="body_fat",
        value_key="body_fat",
        translation_key="body_fat",
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:percent",
    ),
    SparkyFitnessSensorDescription(
        key="bmi",
        value_key="bmi",
        translation_key="bmi",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:human",
    ),
    # --- Macros + goals ---
    SparkyFitnessSensorDescription(
        key="protein_eaten",
        value_key="protein_eaten",
        translation_key="protein_eaten",
        native_unit_of_measurement=UnitOfMass.GRAMS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:food-steak",
    ),
    SparkyFitnessSensorDescription(
        key="carbs_eaten",
        value_key="carbs_eaten",
        translation_key="carbs_eaten",
        native_unit_of_measurement=UnitOfMass.GRAMS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:barley",
    ),
    SparkyFitnessSensorDescription(
        key="fat_eaten",
        value_key="fat_eaten",
        translation_key="fat_eaten",
        native_unit_of_measurement=UnitOfMass.GRAMS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:oil",
    ),
    SparkyFitnessSensorDescription(
        key="protein_goal",
        value_key="protein_goal",
        translation_key="protein_goal",
        native_unit_of_measurement=UnitOfMass.GRAMS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:target",
    ),
    SparkyFitnessSensorDescription(
        key="carbs_goal",
        value_key="carbs_goal",
        translation_key="carbs_goal",
        native_unit_of_measurement=UnitOfMass.GRAMS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:target",
    ),
    SparkyFitnessSensorDescription(
        key="fat_goal",
        value_key="fat_goal",
        translation_key="fat_goal",
        native_unit_of_measurement=UnitOfMass.GRAMS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:target",
    ),
    SparkyFitnessSensorDescription(
        key="water_goal",
        value_key="water_goal_ml",
        translation_key="water_goal",
        device_class=SensorDeviceClass.VOLUME,
        native_unit_of_measurement=UnitOfVolume.MILLILITERS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:cup-water",
    ),
    # --- Trends + streak ---
    SparkyFitnessSensorDescription(
        key="avg_calories_7d",
        value_key="avg_calories_7d",
        translation_key="avg_calories_7d",
        native_unit_of_measurement=KCAL,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:chart-line",
    ),
    SparkyFitnessSensorDescription(
        key="avg_calories_30d",
        value_key="avg_calories_30d",
        translation_key="avg_calories_30d",
        native_unit_of_measurement=KCAL,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:chart-line",
    ),
    SparkyFitnessSensorDescription(
        key="logging_streak_days",
        value_key="logging_streak_days",
        translation_key="logging_streak_days",
        native_unit_of_measurement=UnitOfTime.DAYS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:calendar-check",
    ),
    # weight_change reflects the configured trend window (default 30 days —
    # see the README), not a fixed calendar month.
    SparkyFitnessSensorDescription(
        key="weight_change",
        value_key="weight_change",
        translation_key="weight_change",
        native_unit_of_measurement=UnitOfMass.KILOGRAMS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:trending-up",
    ),
    # --- 30-day long-term trends (distinct from the 7d/30d calorie averages
    # above: these cover macros, logging consistency, and average weight) ---
    SparkyFitnessSensorDescription(
        key="avg_protein_30d",
        value_key="avg_protein_30d",
        translation_key="avg_protein_30d",
        native_unit_of_measurement=UnitOfMass.GRAMS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:food-steak",
    ),
    SparkyFitnessSensorDescription(
        key="avg_carbs_30d",
        value_key="avg_carbs_30d",
        translation_key="avg_carbs_30d",
        native_unit_of_measurement=UnitOfMass.GRAMS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:barley",
    ),
    SparkyFitnessSensorDescription(
        key="avg_fat_30d",
        value_key="avg_fat_30d",
        translation_key="avg_fat_30d",
        native_unit_of_measurement=UnitOfMass.GRAMS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:oil",
    ),
    SparkyFitnessSensorDescription(
        key="logging_consistency_30d",
        value_key="logging_consistency_30d",
        translation_key="logging_consistency_30d",
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:calendar-check-outline",
    ),
    SparkyFitnessSensorDescription(
        key="avg_weight_30d",
        value_key="avg_weight_30d",
        translation_key="avg_weight_30d",
        device_class=SensorDeviceClass.WEIGHT,
        native_unit_of_measurement=UnitOfMass.KILOGRAMS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:scale-bathroom",
    ),
    # --- Sleep / mood ---
    SparkyFitnessSensorDescription(
        key="sleep_hours",
        value_key="sleep_hours",
        translation_key="sleep_hours",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.HOURS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:sleep",
    ),
    SparkyFitnessSensorDescription(
        key="sleep_score",
        value_key="sleep_score",
        translation_key="sleep_score",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:sleep",
    ),
    SparkyFitnessSensorDescription(
        key="mood",
        value_key="mood_value",
        translation_key="mood",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:emoticon-outline",
    ),
    # --- Weekly exercise stats (rolling 7-day window, from SparkyFitness's
    # own exercise-dashboard report) ---
    SparkyFitnessSensorDescription(
        key="weekly_workouts",
        value_key="weekly_workouts",
        translation_key="weekly_workouts",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:calendar-week",
    ),
    SparkyFitnessSensorDescription(
        key="weekly_volume",
        value_key="weekly_volume",
        translation_key="weekly_volume",
        native_unit_of_measurement=UnitOfMass.KILOGRAMS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:weight-kilogram",
    ),
    SparkyFitnessSensorDescription(
        key="weekly_reps",
        value_key="weekly_reps",
        translation_key="weekly_reps",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:counter",
    ),
    SparkyFitnessSensorDescription(
        key="workout_streak",
        value_key="workout_streak",
        translation_key="workout_streak",
        native_unit_of_measurement=UnitOfTime.DAYS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:fire",
    ),
    SparkyFitnessSensorDescription(
        key="workout_longest_streak",
        value_key="workout_longest_streak",
        translation_key="workout_longest_streak",
        native_unit_of_measurement=UnitOfTime.DAYS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:trophy-outline",
    ),
    # --- Monthly exercise stats (rolling trend-window, default 30 days —
    # same exercise-dashboard report as weekly_*, fetched over a longer
    # window) ---
    SparkyFitnessSensorDescription(
        key="monthly_workouts",
        value_key="monthly_workouts",
        translation_key="monthly_workouts",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:calendar-month",
    ),
    SparkyFitnessSensorDescription(
        key="monthly_volume",
        value_key="monthly_volume",
        translation_key="monthly_volume",
        native_unit_of_measurement=UnitOfMass.KILOGRAMS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:weight-kilogram",
    ),
    SparkyFitnessSensorDescription(
        key="monthly_reps",
        value_key="monthly_reps",
        translation_key="monthly_reps",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:counter",
    ),
    # --- Adaptive TDEE (SparkyFitness's rolling estimate from actual logged
    # weight/intake, not just the Mifflin-St Jeor formula behind bmr) ---
    SparkyFitnessSensorDescription(
        key="adaptive_tdee",
        value_key="adaptive_tdee",
        translation_key="adaptive_tdee",
        native_unit_of_measurement=KCAL,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:chart-bell-curve-cumulative",
    ),
    # --- Sleep debt (SparkyFitness's MCTQ-based rolling estimate, distinct
    # from the plain "last night's hours" sleep_hours above) ---
    SparkyFitnessSensorDescription(
        key="sleep_debt",
        value_key="sleep_debt_hours",
        translation_key="sleep_debt",
        native_unit_of_measurement=UnitOfTime.HOURS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:sleep-off",
    ),
    # --- All-time fasting stats + streak (distinct from fasting_active,
    # which only reflects the currently in-progress fast, if any) ---
    SparkyFitnessSensorDescription(
        key="fasting_total_completed",
        value_key="fasting_total_completed",
        translation_key="fasting_total_completed",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:timer-check-outline",
    ),
    SparkyFitnessSensorDescription(
        key="fasting_avg_duration",
        value_key="fasting_avg_duration_hours",
        translation_key="fasting_avg_duration",
        native_unit_of_measurement=UnitOfTime.HOURS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:timer-sand",
    ),
    SparkyFitnessSensorDescription(
        key="fasting_streak",
        value_key="fasting_streak_days",
        translation_key="fasting_streak",
        native_unit_of_measurement=UnitOfTime.DAYS,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:calendar-check",
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up SparkyFitness sensors from a config entry."""
    coordinator: SparkyFitnessCoordinator = hass.data[DOMAIN][entry.entry_id]

    device_info = DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name=MANUFACTURER,
        manufacturer=MANUFACTURER,
        configuration_url=entry.data[CONF_URL],
    )

    async_add_entities(
        SparkyFitnessSensor(coordinator, entry, description, device_info)
        for description in SENSOR_DESCRIPTIONS
    )

    # Custom measurement categories (e.g. blood pressure) are user-defined in
    # SparkyFitness, so these entities are created dynamically from whatever
    # categories exist at startup rather than being a fixed list. A category
    # added later in SparkyFitness won't get a sensor until HA reloads this
    # integration (Settings -> Devices & Services -> SparkyFitness -> Reload).
    #
    # Iterating custom_measurements (not the raw custom_categories list) means
    # categories that have never had a value logged and were never assigned a
    # real unit are skipped — see _custom_measurement_sensors in
    # coordinator.py. Those show up as permanently-"unknown" clutter
    # otherwise (typically placeholder categories a wearable-sync left
    # behind but never actually populated).
    custom_measurements = (coordinator.data or {}).get("custom_measurements", {})
    if custom_measurements:
        async_add_entities(
            SparkyFitnessCustomMeasurementSensor(
                coordinator, entry, category_id, device_info
            )
            for category_id in custom_measurements
        )


class SparkyFitnessSensor(CoordinatorEntity[SparkyFitnessCoordinator], SensorEntity):
    """A single SparkyFitness metric."""

    _attr_has_entity_name = True

    entity_description: SparkyFitnessSensorDescription

    def __init__(
        self,
        coordinator: SparkyFitnessCoordinator,
        entry: ConfigEntry,
        description: SparkyFitnessSensorDescription,
        device_info: DeviceInfo,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"
        self._attr_device_info = device_info

    @property
    def native_value(self):
        if not self.coordinator.data:
            return None
        return self.coordinator.data.get(self.entity_description.value_key)

    @property
    def extra_state_attributes(self):
        if not self.coordinator.data:
            return None
        attrs = {"date": self.coordinator.data.get("date")}
        if self.entity_description.key == "bmr":
            summary = self.coordinator.data.get("_raw_daily_summary", {})
            balance = summary.get("calorieBalance", {}) if summary else {}
            attrs["source"] = balance.get("bmrSource")
        if self.entity_description.key in ("weight", "body_fat", "bmi"):
            # These carry forward from the most recent logged check-in, which
            # may not be today — this says which day the value is actually from.
            attrs["measurement_date"] = self.coordinator.data.get("measurement_date")
            if self.entity_description.key == "bmi":
                attrs["height_cm"] = self.coordinator.data.get("height")
        if self.entity_description.key == "weight_change":
            attrs["trend"] = self.coordinator.data.get("weight_trend")
            attrs["since"] = self.coordinator.data.get("weight_trend_since")
        if self.entity_description.key == "mood":
            attrs["tags"] = self.coordinator.data.get("mood_tags")
            attrs["notes"] = self.coordinator.data.get("mood_notes")
        if self.entity_description.key == "sleep_hours":
            attrs["sleep_date"] = self.coordinator.data.get("sleep_date")
        if self.entity_description.key == "weekly_volume":
            attrs["by_muscle_group"] = self.coordinator.data.get(
                "muscle_group_volume", {}
            )
        if self.entity_description.key == "workout_streak":
            attrs["weekly_frequency"] = self.coordinator.data.get("weekly_frequency")
        if self.entity_description.key == "sleep_debt":
            attrs["category"] = self.coordinator.data.get("sleep_debt_category")
            attrs["sleep_need_hours"] = self.coordinator.data.get("sleep_need_hours")
            attrs["trend"] = self.coordinator.data.get("sleep_debt_trend")
            attrs["change_7d_hours"] = self.coordinator.data.get(
                "sleep_debt_change_7d"
            )
            attrs["payback_hours"] = self.coordinator.data.get(
                "sleep_debt_payback_hours"
            )
        if self.entity_description.key == "adaptive_tdee":
            attrs["confidence"] = self.coordinator.data.get(
                "adaptive_tdee_confidence"
            )
            attrs["is_fallback"] = self.coordinator.data.get(
                "adaptive_tdee_is_fallback"
            )
            attrs["fallback_reason"] = self.coordinator.data.get(
                "adaptive_tdee_fallback_reason"
            )
            attrs["days_of_data"] = self.coordinator.data.get(
                "adaptive_tdee_days_of_data"
            )
        return attrs


class SparkyFitnessCustomMeasurementSensor(
    CoordinatorEntity[SparkyFitnessCoordinator], SensorEntity
):
    """One sensor per user-defined SparkyFitness custom measurement category
    (e.g. blood pressure, glucose). Value is the most recent entry within the
    configured trend window; SparkyFitness doesn't expose a unit for these, so
    none is set here — see the README."""

    _attr_has_entity_name = True
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(
        self,
        coordinator: SparkyFitnessCoordinator,
        entry: ConfigEntry,
        category_id: str,
        device_info: DeviceInfo,
    ) -> None:
        super().__init__(coordinator)
        self._category_id = category_id
        self._attr_unique_id = f"{entry.entry_id}_custom_{category_id}"
        self._attr_device_info = device_info
        self._attr_icon = "mdi:clipboard-pulse-outline"

    @property
    def _category_data(self) -> dict:
        if not self.coordinator.data:
            return {}
        return self.coordinator.data.get("custom_measurements", {}).get(
            self._category_id, {}
        )

    @property
    def name(self) -> str:
        return self._category_data.get("name") or "Custom measurement"

    @property
    def native_value(self):
        return self._category_data.get("value")

    @property
    def extra_state_attributes(self):
        data = self._category_data
        return {
            "measurement_date": data.get("date"),
            "measurement_type": data.get("measurement_type"),
            "data_type": data.get("data_type"),
        }
