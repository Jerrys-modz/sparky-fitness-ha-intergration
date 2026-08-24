"""Button platform for SparkyFitness — one-tap water logging."""

from __future__ import annotations

import logging

from homeassistant.components.button import ButtonEntity, ButtonEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .api import SparkyFitnessApiError
from .const import CONF_URL, DOMAIN, MANUFACTURER
from .coordinator import SparkyFitnessCoordinator

_LOGGER = logging.getLogger(__name__)

# Fallback if the coordinator hasn't polled the container endpoint yet
# (matches SparkyFitness's own server-side default).
DEFAULT_WATER_CONTAINER_ML = 2000

LOG_WATER_GLASS_DESCRIPTION = ButtonEntityDescription(
    key="log_water_glass",
    translation_key="log_water_glass",
    icon="mdi:cup-water",
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the SparkyFitness 'log a glass of water' button."""
    coordinator: SparkyFitnessCoordinator = hass.data[DOMAIN][entry.entry_id]

    device_info = DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name=MANUFACTURER,
        manufacturer=MANUFACTURER,
        configuration_url=entry.data[CONF_URL],
    )

    async_add_entities(
        [
            SparkyFitnessLogWaterButton(
                coordinator, entry, LOG_WATER_GLASS_DESCRIPTION, device_info
            )
        ]
    )


class SparkyFitnessLogWaterButton(
    CoordinatorEntity[SparkyFitnessCoordinator], ButtonEntity
):
    """Logs your actual preferred water container size to SparkyFitness on press.

    Reads the container volume from SparkyFitness itself (Settings > Water
    Containers > primary) rather than a hardcoded amount. For any other
    amount, use the sparky_fitness.log_water service instead (see the README).
    """

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: SparkyFitnessCoordinator,
        entry: ConfigEntry,
        description: ButtonEntityDescription,
        device_info: DeviceInfo,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"
        self._attr_device_info = device_info

    @property
    def extra_state_attributes(self):
        if not self.coordinator.data:
            return None
        data = self.coordinator.data
        return {
            "container_name": data.get("water_container_name", "Default Container"),
            "container_volume_ml": data.get(
                "water_container_ml", DEFAULT_WATER_CONTAINER_ML
            ),
        }

    async def async_press(self) -> None:
        volume_ml = DEFAULT_WATER_CONTAINER_ML
        if self.coordinator.data:
            volume_ml = self.coordinator.data.get(
                "water_container_ml", DEFAULT_WATER_CONTAINER_ML
            )
        try:
            await self.coordinator.client.async_log_health_data(
                volume_ml, "water", dt_util.now().date()
            )
        except SparkyFitnessApiError:
            _LOGGER.exception("Failed to log water to SparkyFitness")
            raise
        await self.coordinator.async_request_refresh()
