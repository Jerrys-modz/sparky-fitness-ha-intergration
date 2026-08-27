"""Binary sensor platform for SparkyFitness."""

from __future__ import annotations

from dataclasses import dataclass

from homeassistant.components.binary_sensor import (
    BinarySensorEntity,
    BinarySensorEntityDescription,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_URL, DOMAIN, MANUFACTURER
from .coordinator import SparkyFitnessCoordinator


@dataclass(frozen=True, kw_only=True)
class SparkyFitnessBinarySensorDescription(BinarySensorEntityDescription):
    """Adds the data key this binary sensor reads from the coordinator."""

    value_key: str = ""


BINARY_SENSOR_DESCRIPTIONS: tuple[SparkyFitnessBinarySensorDescription, ...] = (
    SparkyFitnessBinarySensorDescription(
        key="workout_logged_today",
        value_key="workout_logged",
        translation_key="workout_logged_today",
        icon="mdi:weight-lifter",
    ),
    SparkyFitnessBinarySensorDescription(
        key="fasting_active",
        value_key="fasting_active",
        translation_key="fasting_active",
        icon="mdi:timer-sand",
    ),
    SparkyFitnessBinarySensorDescription(
        key="pr_today",
        value_key="pr_today",
        translation_key="pr_today",
        icon="mdi:trophy",
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up SparkyFitness binary sensors from a config entry."""
    coordinator: SparkyFitnessCoordinator = hass.data[DOMAIN][entry.entry_id]

    device_info = DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name=MANUFACTURER,
        manufacturer=MANUFACTURER,
        configuration_url=entry.data[CONF_URL],
    )

    async_add_entities(
        SparkyFitnessBinarySensor(coordinator, entry, description, device_info)
        for description in BINARY_SENSOR_DESCRIPTIONS
    )


class SparkyFitnessBinarySensor(
    CoordinatorEntity[SparkyFitnessCoordinator], BinarySensorEntity
):
    """A single SparkyFitness on/off signal."""

    _attr_has_entity_name = True

    entity_description: SparkyFitnessBinarySensorDescription

    def __init__(
        self,
        coordinator: SparkyFitnessCoordinator,
        entry: ConfigEntry,
        description: SparkyFitnessBinarySensorDescription,
        device_info: DeviceInfo,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"
        self._attr_device_info = device_info

    @property
    def is_on(self) -> bool | None:
        if not self.coordinator.data:
            return None
        return bool(self.coordinator.data.get(self.entity_description.value_key))

    @property
    def extra_state_attributes(self):
        if not self.coordinator.data:
            return None
        data = self.coordinator.data
        attrs = {"date": data.get("date")}

        if self.entity_description.key == "workout_logged_today":
            attrs.update(
                {
                    "workout_names": data.get("workout_names", []),
                    "workout_count": data.get("workout_count", 0),
                    "total_exercise_sessions_logged": data.get(
                        "exercise_sessions_logged", 0
                    ),
                    "total_exercise_calories": data.get("total_exercise_calories"),
                    "total_exercise_minutes": data.get("total_exercise_minutes"),
                }
            )
        if self.entity_description.key == "fasting_active":
            attrs.update(
                {
                    "fasting_type": data.get("fasting_type"),
                    "start_time": data.get("fasting_start_time"),
                    "target_end_time": data.get("fasting_target_end_time"),
                    "elapsed_hours": data.get("fasting_elapsed_hours"),
                    "remaining_hours": data.get("fasting_remaining_hours"),
                }
            )
        if self.entity_description.key == "pr_today":
            attrs["exercises"] = data.get("pr_exercises_today", [])
        return attrs
