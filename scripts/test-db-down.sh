#!/usr/bin/env bash
set -euo pipefail

env -u COMPOSE_ENV_FILES COMPOSE_DISABLE_ENV_FILE=1 COMPOSE_REMOVE_ORPHANS=0 \
  docker compose -p second-perspective-test -f compose.test.yaml down --volumes
