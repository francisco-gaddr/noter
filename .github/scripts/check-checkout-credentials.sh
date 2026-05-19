#!/usr/bin/env bash
# Fail-fast scanner: every actions/checkout step MUST explicitly set
# persist-credentials: false. Persisted credentials let attacker-controlled
# subsequent steps push to the repo using the runner's token, even if the
# original workflow only intended a read-only checkout.
#
# This implements the custom rule we asked for on top of actionlint: actionlint
# itself doesn't ship this check natively, so we run this in CI alongside
# actionlint as a separate gate.

set -euo pipefail

shopt -s globstar nullglob

ROOT="${GITHUB_WORKSPACE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
WORKFLOW_DIR="${ROOT}/.github/workflows"

if [[ ! -d "${WORKFLOW_DIR}" ]]; then
  echo "no workflows directory found at ${WORKFLOW_DIR}; nothing to scan"
  exit 0
fi

violations=0

for file in "${WORKFLOW_DIR}"/*.yml "${WORKFLOW_DIR}"/*.yaml; do
  [[ -e "${file}" ]] || continue
  # Use awk to walk the file and inspect each actions/checkout step's `with:` block.
  awk -v file="${file}" '
    BEGIN { in_checkout = 0; saw_persist = 0; step_indent = -1 }
    /uses:[[:space:]]+actions\/checkout@/ {
      # Capture the indent prefix so we know when the step ends.
      match($0, /^[[:space:]]*/)
      step_indent = RLENGTH
      in_checkout = 1
      saw_persist = 0
      next
    }
    in_checkout {
      # End of step: a new step starts when we see a "- " token at <= step_indent
      match($0, /^[[:space:]]*/)
      cur_indent = RLENGTH
      is_step_start = ($0 ~ /^[[:space:]]*-[[:space:]]/) && (cur_indent <= step_indent)
      if (is_step_start && NR > 1) {
        if (!saw_persist) {
          printf "::error file=%s::actions/checkout step missing `with: persist-credentials: false`\n", file
          exit_code = 1
        }
        in_checkout = 0
      } else if ($0 ~ /persist-credentials:[[:space:]]*false/) {
        saw_persist = 1
      } else if ($0 ~ /persist-credentials:[[:space:]]*true/) {
        printf "::error file=%s::actions/checkout has persist-credentials: true (must be false)\n", file
        exit_code = 1
        in_checkout = 0
      }
    }
    END {
      if (in_checkout && !saw_persist) {
        printf "::error file=%s::actions/checkout step missing `with: persist-credentials: false` (end of file)\n", file
        exit_code = 1
      }
      exit (exit_code ? exit_code : 0)
    }
  ' "${file}" || violations=$((violations + 1))
done

if [[ ${violations} -gt 0 ]]; then
  echo "::error::${violations} workflow file(s) violate persist-credentials policy"
  exit 1
fi

echo "all workflows pass persist-credentials policy"
