#!/bin/sh
set -eu

docker compose --env-file .env -f compose.opik.yaml down
