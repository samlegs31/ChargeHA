#!/usr/bin/env bash
# Local validation only; does not start the application or deploy anything.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 validation/candidate.py verify
python3 -m unittest discover -s validation -p 'test_*.py'
deno fmt --check --ignore='**/client/**,**/*.tsx' packages/server/src packages/shared packages/plugins
deno lint --ignore='**/client/**,**/*.tsx' packages/server/src packages/shared packages/plugins
deno check --frozen packages/server/src/main.ts
deno test --frozen --import-map=validation/imports.json --lock=validation/deno.lock \
  --allow-env --allow-read --allow-write --allow-ffi \
  --allow-net=127.0.0.1,localhost,0.0.0.0 --unstable-ffi \
  --ignore='**/client/**,**/*.test.tsx' packages/server packages/shared packages/plugins
