#!/bin/sh
set -eu

umask 077
env_file=.env
touch "${env_file}"
chmod 600 "${env_file}"

append_if_missing() {
  key=$1
  value=$2
  if ! grep -q "^${key}=" "${env_file}"; then
    printf '%s=%s\n' "${key}" "${value}" >> "${env_file}"
  fi
}

append_if_missing LANGFUSE_BASE_URL http://localhost:3000
append_if_missing LANGFUSE_PUBLIC_KEY "pk-lf-local-$(openssl rand -hex 16)"
append_if_missing LANGFUSE_SECRET_KEY "sk-lf-local-$(openssl rand -hex 32)"
append_if_missing LANGFUSE_TRACING_ENVIRONMENT local
append_if_missing NEXTAUTH_SECRET "$(openssl rand -hex 32)"
append_if_missing SALT "$(openssl rand -hex 16)"
append_if_missing ENCRYPTION_KEY "$(openssl rand -hex 32)"
append_if_missing POSTGRES_PASSWORD "$(openssl rand -hex 32)"
append_if_missing CLICKHOUSE_PASSWORD "$(openssl rand -hex 32)"
append_if_missing REDIS_AUTH "$(openssl rand -hex 32)"
append_if_missing MINIO_ROOT_PASSWORD "$(openssl rand -hex 32)"
append_if_missing LANGFUSE_INIT_USER_PASSWORD "$(openssl rand -hex 32)"

docker compose --env-file .env -f compose.langfuse.yaml up -d --wait --wait-timeout 180
