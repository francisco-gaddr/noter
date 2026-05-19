# Polish Pass — CI / Cross-cutting

[← Index](./index.md)

## 1. actionlint with custom `persist-credentials` rule

**Files:** `.github/workflows/actionlint.yml`,
`.github/scripts/check-checkout-credentials.sh`

actionlint catches GitHub Actions syntax errors and runs shellcheck on `run:`
blocks. We extend it with a custom AWK-based scanner that fails the workflow
if any `actions/checkout@*` step is missing `with: persist-credentials: false`.

**Why it matters:** when `persist-credentials: true` (the default), the
runner's `GITHUB_TOKEN` is left on disk in `.git/config`. A subsequent step
that gets compromised (malicious dependency, prompt injection in a job
script, etc.) can `git push` back to the repo. Forcing the explicit
opt-out makes the safe default the only path.

**Test the rule locally:**
```bash
./.github/scripts/check-checkout-credentials.sh
# "all workflows pass persist-credentials policy"
```

To verify it catches violations, temporarily add a workflow with a bare
`uses: actions/checkout@v4` step and re-run — you'll see an
`::error file=…::actions/checkout step missing` annotation.

## 2. Renovate automerge for low-CVE patches

**File:** `renovate.json`

Configured for safe automation:

| Match | Behaviour |
|---|---|
| Patch + pin + digest on `^1.x+` packages | Automerge ✓ |
| `devDependencies` patch + minor | Automerge ✓ |
| Vulnerability severity `LOW`/`MEDIUM` patches | Automerge ✓ |
| Vulnerability severity `HIGH`/`CRITICAL` | Manual review (priority 10) |
| Any `major` bump | Manual review |
| `0.x` packages, any update | Manual review (treat minor as breaking) |
| `react`/`react-native`/`next`/`expo` major+minor | Manual review |
| Electron + `electron-builder` | Manual review |
| GitHub Actions | `pinDigests: true` (commit SHA, not floating tag) |

Schedule: Mondays before 7am Europe/Stockholm. Lockfile maintenance: first
of the month, same window.

PR concurrency capped at 10, hourly cap at 4 — won't flood reviewers.

## 3. Sigstore Rekor transparency-log audit

**File:** `.github/workflows/rekor-audit.yml`

Runs every 6 hours (`17 */6 * * *` cron). Queries the Rekor public
transparency log for entries matching our release subjects, decodes each
entry's certificate, and verifies the SAN URI against an allow-list of
trusted GitHub Actions workflow identities.

**Configuration via repo Actions variables:**

- `REKOR_URL` — public Rekor (default) or self-hosted
- `SIGSTORE_ALLOWED_IDENTITIES` — comma-separated SAN prefixes
- `REKOR_AUDIT_SUBJECTS` — comma-separated subject names to audit

**Outcome:** any unexpected signature triggers a labelled GitHub issue
(`security`, `supply-chain`, `rekor-audit`) with a link to the run artifacts
that contain the offending Rekor entries as JSON.

This is the supply-chain "trip-wire" — even if an attacker manages to push
a signed release, the act of signing itself appears in the public log, and
we'll see it within 6 hours.

## Not done (out of scope / require infrastructure)

- **Tekton/Argo Workflows CI** — would replace GitHub Actions; needs a
  Kubernetes cluster + Argo CD/Workflows operators. Documented as a
  future migration.
- **OSV-Scanner local mirror** — needs storage for the OSV database
  (~few GB). osv-scanner.yml workflow (in the stashed E2E branch) currently
  hits the public API.
- **Goldilocks-based VPA** — needs the Kubernetes cluster to host
  VerticalPodAutoscaler + Goldilocks.
- **gitsign tag signing** — needs a release pipeline; the rekor-audit
  workflow is ready to verify signed tags once we start producing them.

## Verification

See [testing.md → ci](./testing.md#ci).
