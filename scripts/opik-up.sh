#!/bin/sh
set -eu

opik_dir=.opik
[ -d "$opik_dir/.git" ] || git clone --depth=1 https://github.com/comet-ml/opik.git "$opik_dir"

touch .env
grep -q '^OPIK_URL_OVERRIDE=' .env || printf '%s\n' 'OPIK_URL_OVERRIDE=http://localhost:5173/api' >> .env
grep -q '^OPIK_PROJECT_NAME=' .env || printf '%s\n' 'OPIK_PROJECT_NAME=second-perspective' >> .env

docker compose --env-file .env -f compose.opik.yaml up -d --wait --wait-timeout 180
