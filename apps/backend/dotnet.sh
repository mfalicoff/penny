#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ -f .env && "${1:-}" == "run" ]]; then
  set -a
  source .env
  set +a
fi
backend_cache="$PWD/../../.cache/backend"
mkdir -p "$backend_cache/temporary"
backend_repository="$(cd ../.. && pwd)"
export TESTINGPLATFORM_PIPE_DIRECTORY="${TESTINGPLATFORM_PIPE_DIRECTORY:-$backend_repository/.cache/p}"
mkdir -p "$TESTINGPLATFORM_PIPE_DIRECTORY"
export DOTNET_CLI_HOME="$backend_cache/dotnet"
export NUGET_PACKAGES="$backend_cache/nuget"
export DOTNET_BUNDLE_EXTRACT_BASE_DIR="$backend_cache/bundles"
export TMPDIR="$backend_cache/temporary"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1
exec dotnet "$@"
