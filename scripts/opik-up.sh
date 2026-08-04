#!/bin/sh
set -eu

touch .env
grep -q '^OPIK_URL_OVERRIDE=' .env || printf '%s\n' 'OPIK_URL_OVERRIDE=http://localhost:5173/api' >> .env
grep -q '^OPIK_PROJECT_NAME=' .env || printf '%s\n' 'OPIK_PROJECT_NAME=second-perspective' >> .env

docker compose --env-file .env -f docker/opik/compose.yaml up -d --wait --wait-timeout 180
docker compose --env-file .env -f docker/opik/compose.yaml --profile init run --rm mc
