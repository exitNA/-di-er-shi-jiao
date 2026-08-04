#!/bin/sh
set -eu

docker compose --env-file .env -f docker/langfuse/compose.yaml down
