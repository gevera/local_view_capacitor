#!/usr/bin/env bash
set -euo pipefail

cd /app

if [[ "${1:-}" == "start" ]]; then
  /app/bin/local_first eval "LocalFirst.Release.migrate"
  exec /app/bin/local_first start
fi

exec /app/bin/local_first "$@"
