"""The SparkyFitness integration."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import SparkyFitnessApiClient
from .const import (
    CONF_API_KEY,
    CONF_SCAN_INTERVAL,
    CONF_TREND_WINDOW_DAYS,
    CONF_URL,
    CONF_VERIFY_SSL,
    DEFAULT_SCAN_INTERVAL_MINUTES,
    DEFAULT_TREND_WINDOW_DAYS,
    DOMAIN,
)
from .coordinator import SparkyFitnessCoordinator
from .services import async_setup_services, async_unload_services

PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.BINARY_SENSOR, Platform.BUTTON]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up SparkyFitness from a config entry."""
    verify_ssl = entry.data.get(CONF_VERIFY_SSL, True)
    session = async_get_clientsession(hass, verify_ssl=verify_ssl)

    client = SparkyFitnessApiClient(
        session,
        entry.data[CONF_URL],
        entry.data[CONF_API_KEY],
        verify_ssl,
    )

    scan_interval = entry.options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL_MINUTES)
    trend_window_days = entry.options.get(
        CONF_TREND_WINDOW_DAYS, DEFAULT_TREND_WINDOW_DAYS
    )
    coordinator = SparkyFitnessCoordinator(
        hass, client, scan_interval, trend_window_days
    )

    # Any failure here becomes ConfigEntryNotReady (connection problems) or
    # triggers HA's reauth flow (ConfigEntryAuthFailed) automatically —
    # both are raised from inside the coordinator's _async_update_data.
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await async_setup_services(hass)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the entry when options (e.g. scan interval) change."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        await async_unload_services(hass)
    return unload_ok
