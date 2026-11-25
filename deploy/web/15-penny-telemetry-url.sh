#!/bin/sh
# MAZ-129: browser telemetry no longer goes from the browser to a collector. The web app posts
# reports to the API, which forwards them (ClientTelemetry__FaroUrl on the api service). An old
# PENNY_WEB_TELEMETRY_URL is ignored; say so at start rather than silently dropping it.
set -eu

if [ -n "${PENNY_WEB_TELEMETRY_URL:-}" ]; then
  echo "$0: PENNY_WEB_TELEMETRY_URL is no longer used and is ignored. Set ClientTelemetry__FaroUrl on the API instead (docs/self-hosting/observability.md#client-telemetry)." >&2
fi
