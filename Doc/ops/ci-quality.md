# Validation & code-quality model (local + Raspberry Pi)

**Updated:** 2026-06-20 · **GitHub Actions: removed** (we don't burn CI minutes — the gate runs on
hardware we own).

## How it works now

There is **no GitHub Actions / CI service**. Quality is enforced at two points we control:

1. **Local pre-push gate (primary).** [`noter-app/.husky/pre-push`](../../noter-app/.husky/pre-push)
   runs `npm run validate:prepush` → `validate:critical` → [`scripts/validate-critical.mjs`](../../noter-app/scripts/validate-critical.mjs)
   before every `git push`. A failing gate blocks the push. This is the review-gate at push time.
2. **Raspberry Pi run (second line).** [`noter-app/scripts/pi-validate.sh`](../../noter-app/scripts/pi-validate.sh)
   runs the **same** matrix on the Pi. It's wired into the deploy as an **opt-in pre-build gate** —
   `RUN_PI_TESTS=1 python deploy_pi.py` runs it and aborts the deploy if it fails. Off by default
   because the full matrix is heavy on a Pi; enable it once the Pi host has Node 24 (or run it in a
   `node:24` container — see the script header).

The Pi deploy also keeps its **runtime health-gate + rollback** ([`deploy_pi.py`](../../noter-app/deploy_pi.py)):
after `docker compose up` it polls `/api/health` and rolls back to the previous revision if the new
build never becomes healthy. That is a runtime smoke test on the real hardware.

## What the matrix enforces (`validate-critical.mjs`, 19 gates)

Run it any time with `npm run validate:critical` (from `noter-app/`). Highlights:

- **Typecheck** across all workspaces (`turbo run check-types`).
- **Lockfile in sync** with package.json (npm@10 regen diff).
- **Core package tests** — `@repo/shared` + `@repo/ai` (crypto, locks, RAG/retrieval, agent runner,
  vector index, related-notes/summarize, error reporter, …).
- **Security/invariant guards** (mechanical, each with a `--selftest`):
  - Crypto-boundary — encryption only via `@repo/shared`.
  - Locked-content leak — the UI unlock set never reaches an index/publish surface.
  - Route-scoping & SQL cascade-replace.
  - **Secret-scanning** — no committed credentials / `.env` files ([`scripts/check-secrets.mjs`](../../noter-app/scripts/check-secrets.mjs)).
- **Named correctness gates** — CalDAV/calendar 2-way, AI-chat persistence, AI search & RAG, GDPR
  export/delete, audit-log tamper-evidence, task-list windowing.

## What used to be CI-only (now run on demand / on the Pi)

The removed `ci.yml` also ran a few heavier, non-blocking steps. Run them locally or on the Pi when
relevant (deliberately **not** in the fast pre-push gate, so pushing stays quick):

- **Web SSR build** — `cd apps/web && npx next build`.
- **Dead-code / unused-deps report** — `npm run knip` (and the blocking `npm run knip:files`).
- **Broad app test suite** — `npx turbo run test --filter=mobile --filter=backend --filter=web`
  (a known flake backlog under parallel load — the deterministic subset is in the matrix above).

## Re-enabling hosted CI later

If a hosted CI is ever wanted again, the gate is a single command (`node scripts/validate-critical.mjs`)
plus the heavier steps above — trivially re-expressible as a workflow. None of the gate logic lives in
GitHub Actions; it all lives in the repo scripts.
