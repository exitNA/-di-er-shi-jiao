#!/bin/sh
set -eu

docker compose --env-file .env -f docker/opik/compose.yaml down
