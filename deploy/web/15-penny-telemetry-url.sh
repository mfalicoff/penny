#!/bin/sh
# MAZ-129: PENNY_WEB_TELEMETRY_URL is written into /telemetry.json and the page's
# Content-Security-Policy (default.conf.template). Refuse to start with anything but a plain
# https URL, so a typo cannot break either or widen the policy. Runs before the template is
# rendered (20-envsubst-on-templates.sh).
set -eu

url="${PENNY_WEB_TELEMETRY_URL:-}"
if [ -z "$url" ]; then
  exit 0
fi

if ! printf '%s' "$url" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$'; then
  echo "$0: PENNY_WEB_TELEMETRY_URL must be an https:// URL with no query, quotes, spaces or semicolons (for example https://faro-collector-prod-us-east-0.grafana.net/collect/<key>)" >&2
  exit 1
fi

echo "$0: browser telemetry on, sending to $(printf '%s' "$url" | cut -d/ -f1-3)"
