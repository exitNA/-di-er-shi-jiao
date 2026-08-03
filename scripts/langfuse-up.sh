#!/bin/sh
set -eu

umask 077
test -f .env.langfuse.local || {
  printf 'LANGFUSE_BASE_URL=http://localhost:3000\n' > .env.langfuse.local
  printf 'LANGFUSE_PUBLIC_KEY=pk-lf-local-%s\n' "$(openssl rand -hex 16)" >> .env.langfuse.local
  printf 'LANGFUSE_SECRET_KEY=sk-lf-local-%s\n' "$(openssl rand -hex 32)" >> .env.langfuse.local
  printf 'LANGFUSE_TRACING_ENVIRONMENT=local\n' >> .env.langfuse.local
  printf 'NEXTAUTH_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env.langfuse.local
  printf 'SALT=%s\n' "$(openssl rand -hex 16)" >> .env.langfuse.local
  printf 'ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" >> .env.langfuse.local
  printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 32)" >> .env.langfuse.local
  printf 'CLICKHOUSE_PASSWORD=%s\n' "$(openssl rand -hex 32)" >> .env.langfuse.local
  printf 'REDIS_AUTH=%s\n' "$(openssl rand -hex 32)" >> .env.langfuse.local
  printf 'MINIO_ROOT_PASSWORD=%s\n' "$(openssl rand -hex 32)" >> .env.langfuse.local
  printf 'LANGFUSE_INIT_USER_PASSWORD=%s\n' "$(openssl rand -hex 32)" >> .env.langfuse.local
}

docker compose --env-file .env.langfuse.local -f compose.langfuse.yaml up -d --wait
