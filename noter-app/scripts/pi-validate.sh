#!/usr/bin/env bash
#
# Pi-side validation — runs the SAME validation matrix as the local pre-push hook, on the Raspberry Pi.
# This is what replaced GitHub Actions: the gate runs on hardware we own instead of CI minutes.
#
# Usage:
#   bash scripts/pi-validate.sh            # run on the Pi (needs Node 24 on the host)
#   RUN_PI_TESTS=1 python deploy_pi.py     # deploy_pi.py runs this as a pre-build gate (opt-in)
#
# Note: the full matrix (typecheck across workspaces + the jest gates + guards) is heavy for a Pi —
# expect several minutes. The PRIMARY gate is the dev-machine pre-push hook (.husky/pre-push); this is
# the second line of defence on the deploy host. If the Pi has no host Node, run it in a container:
#   docker run --rm -v "$PWD":/w -w /w node:24 sh -c "npm ci && node scripts/validate-critical.mjs"
set -euo pipefail

cd "$(cd "$(dirname "$0")/.." && pwd)"  # → noter-app/

echo "==> Pi validation: installing dependencies (npm ci)…"
npm ci --no-audit --no-fund

echo "==> Pi validation: running the validation matrix (validate-critical)…"
node scripts/validate-critical.mjs

echo "==> Pi validation: PASSED"
