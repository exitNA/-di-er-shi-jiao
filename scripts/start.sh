#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"

PORT=5000
DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-$PORT}"


start_service() {
    cd "${COZE_WORKSPACE_PATH}"
    legacy_endpoint='OTEL_EXPORTER_OTLP_''ENDPOINT'
    legacy_exporter='OTLPTrace''Exporter'
    legacy_schema="${legacy_endpoint}[^;]{0,300}\\.string\\(\\)\\.url\\(\\)\\.optional"
    if grep -E -q "${legacy_endpoint}|${legacy_exporter}" dist/server.js ||
        grep -R -E -q --include='*.js' --include='*.map' "${legacy_schema}" .next/server; then
        echo "Refusing to start stale build artifacts; run pnpm build." >&2
        return 1
    fi
    echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
    PORT=${DEPLOY_RUN_PORT} node dist/server.js
}

echo "Starting HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
start_service
