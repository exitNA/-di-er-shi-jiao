#!/bin/sh
set -eu

docker compose --env-file .env.langfuse.local -f compose.langfuse.yaml down
