#!/usr/bin/env bash
set -euo pipefail

env -u COMPOSE_ENV_FILES COMPOSE_DISABLE_ENV_FILE=1 COMPOSE_REMOVE_ORPHANS=0 \
  docker compose -p second-perspective-test -f compose.test.yaml up -d --wait postgres-test
DATABASE_URL=postgres://app:app@127.0.0.1:54330/second_perspective_test \
  pnpm vitest run tests/integration --maxWorkers=1
