"""Config flow for SparkyFitness."""

from __future__ import annotations

import logging
from typing import Any, Mapping
from urllib.parse import urlparse

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import (
    SparkyFitnessApiClient,
    SparkyFitnessApiError,
    SparkyFitnessAuthError,
    SparkyFitnessConnectionError,
)
from .const import (
    CONF_API_KEY,
    CONF_SCAN_INTERVAL,
    CONF_TREND_WINDOW_DAYS,
    CONF_URL,
    CONF_VERIFY_SSL,
    DEFAULT_SCAN_INTERVAL_MINUTES,
    DEFAULT_TREND_WINDOW_DAYS,
    DOMAIN,
    MAX_TREND_WINDOW_DAYS,
    MIN_SCAN_INTERVAL_MINUTES,
    MIN_TREND_WINDOW_DAYS,
)

_LOGGER = logging.getLogger(__name__)


def _normalize_url(raw: str) -> str:
    raw = raw.strip().rstrip("/")
    if not raw.startswith(("http://", "https://")):
        raw = f"https://{raw}"
    return raw


async def _validate(hass, url: str, api_key: str, verify_ssl: bool) -> str | None:
    """Try the connection; return an error code, or None on success."""
    session = async_get_clientsession(hass, verify_ssl=verify_ssl)
    client = SparkyFitnessApiClient(session, url, api_key, verify_ssl)
    try:
        await client.async_validate()
    except SparkyFitnessAuthError:
        return "invalid_auth"
    except SparkyFitnessConnectionError:
        return "cannot_connect"
    except SparkyFitnessApiError:
        return "unknown"
    except Exception:  # noqa: BLE001
        _LOGGER.exception("Unexpected error validating SparkyFitness connection")
        return "unknown"
    return None


class SparkyFitnessConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for SparkyFitness."""

    VERSION = 1

    def __init__(self) -> None:
        self._reauth_entry: config_entries.ConfigEntry | None = None

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            url = _normalize_url(user_input[CONF_URL])
            api_key = user_input[CONF_API_KEY].strip()
            verify_ssl = user_input.get(CONF_VERIFY_SSL, True)

            unique_id = urlparse(url).netloc.lower()
            await self.async_set_unique_id(unique_id)
            self._abort_if_unique_id_configured()

            error = await _validate(self.hass, url, api_key, verify_ssl)
            if error:
                errors["base"] = error
            else:
                return self.async_create_entry(
                    title=f"SparkyFitness ({unique_id})",
                    data={
                        CONF_URL: url,
                        CONF_API_KEY: api_key,
                        CONF_VERIFY_SSL: verify_ssl,
                    },
                )

        data_schema = vol.Schema(
            {
                vol.Required(CONF_URL, default=(user_input or {}).get(CONF_URL, "")): str,
                vol.Required(CONF_API_KEY): str,
                vol.Optional(CONF_VERIFY_SSL, default=True): bool,
            }
        )
        return self.async_show_form(
            step_id="user", data_schema=data_schema, errors=errors
        )

    async def async_step_reauth(
        self, entry_data: Mapping[str, Any]
    ) -> config_entries.ConfigFlowResult:
        """Triggered by HA when the coordinator raises ConfigEntryAuthFailed
        (e.g. the Personal API Key was revoked/regenerated in SparkyFitness)."""
        self._reauth_entry = self.hass.config_entries.async_get_entry(
            self.context["entry_id"]
        )
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        errors: dict[str, str] = {}
        entry = self._reauth_entry
        assert entry is not None

        if user_input is not None:
            api_key = user_input[CONF_API_KEY].strip()
            verify_ssl = entry.data.get(CONF_VERIFY_SSL, True)

            error = await _validate(self.hass, entry.data[CONF_URL], api_key, verify_ssl)
            if error:
                errors["base"] = error
            else:
                self.hass.config_entries.async_update_entry(
                    entry, data={**entry.data, CONF_API_KEY: api_key}
                )
                await self.hass.config_entries.async_reload(entry.entry_id)
                return self.async_abort(reason="reauth_successful")

        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema({vol.Required(CONF_API_KEY): str}),
            errors=errors,
            description_placeholders={"url": entry.data.get(CONF_URL, "")},
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> SparkyFitnessOptionsFlow:
        return SparkyFitnessOptionsFlow(config_entry)


class SparkyFitnessOptionsFlow(config_entries.OptionsFlow):
    """Options flow: poll interval + trend/averages window."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        self._config_entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        current_scan_interval = self._config_entry.options.get(
            CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL_MINUTES
        )
        current_trend_window = self._config_entry.options.get(
            CONF_TREND_WINDOW_DAYS, DEFAULT_TREND_WINDOW_DAYS
        )
        data_schema = vol.Schema(
            {
                vol.Required(
                    CONF_SCAN_INTERVAL, default=current_scan_interval
                ): vol.All(vol.Coerce(int), vol.Range(min=MIN_SCAN_INTERVAL_MINUTES)),
                vol.Required(
                    CONF_TREND_WINDOW_DAYS, default=current_trend_window
                ): vol.All(
                    vol.Coerce(int),
                    vol.Range(min=MIN_TREND_WINDOW_DAYS, max=MAX_TREND_WINDOW_DAYS),
                ),
            }
        )
        return self.async_show_form(step_id="init", data_schema=data_schema)
