"""Constants for the SparkyFitness integration."""

DOMAIN = "sparky_fitness"

CONF_API_KEY = "api_key"
CONF_URL = "url"
CONF_VERIFY_SSL = "verify_ssl"
CONF_SCAN_INTERVAL = "scan_interval"
CONF_TREND_WINDOW_DAYS = "trend_window_days"

DEFAULT_SCAN_INTERVAL_MINUTES = 15
MIN_SCAN_INTERVAL_MINUTES = 5

DEFAULT_TREND_WINDOW_DAYS = 30
MIN_TREND_WINDOW_DAYS = 7
MAX_TREND_WINDOW_DAYS = 90

# Endpoints (relative to the configured base URL)
ENDPOINT_DAILY_SUMMARY = "/api/daily-summary"
ENDPOINT_CHECK_IN = "/api/measurements/check-in/{date}"

MANUFACTURER = "SparkyFitness"
