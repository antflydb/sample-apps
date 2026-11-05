#!/usr/bin/env bash
# Run Antfly and the app natively (macOS on Apple silicon uses Metal).
# Needs: antfly >= 0.3.0-rc.10 on PATH, Go 1.26, pnpm.
set -euo pipefail
cd "$(dirname "$0")/.."

ANTFLY_DATA=${ANTFLY_DATA:-$PWD/data/antfly}
mkdir -p data "$ANTFLY_DATA"

antfly inference pull hf:google/embeddinggemma-2:bf16-safetensors-bundle-v1
antfly inference pull openai/whisper-small --tasks transcribe

# The default inference memory budget cannot hold embeddinggemma2 and Whisper
# at once; raise it so both stay loaded.
antfly standalone --config deploy/antfly.json --data-dir "$ANTFLY_DATA" \
  --inference-host-budget-mb 6000 --inference-backend-budget-mb 14000 \
  --inference-combined-budget-mb 18000 > data/antfly.log 2>&1 &
ANTFLY_PID=$!
trap 'kill $ANTFLY_PID 2>/dev/null' EXIT
until curl -sf http://127.0.0.1:8080/db/v1/status >/dev/null; do sleep 1; done

(cd web && pnpm install --frozen-lockfile && pnpm build)
go run ./cmd/server
