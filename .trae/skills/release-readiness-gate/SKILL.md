---
name: "release-readiness-gate"
description: "Runs cross-app release checks and build gates. Invoke before APK/Electron/web release or after major dependency/config changes."
---

# Release Readiness Gate

## Goal
Ensure a change is releasable across mobile, web, and Electron with reproducible validation.

## Invoke When
- Preparing mobile APK/EAS build.
- Preparing Electron package or web production deploy.
- Updating build configs, scripts, plugin settings, or dependencies.

## Steps
1. Validate readiness scripts and required config keys.
2. Run unit/integration/e2e suites relevant to changed surfaces.
3. Run lint and typecheck in the full workspace.
4. Run production builds for affected clients.
5. Check startup/performance regressions that could block release UX, including duplicate fetches and blocking foreground work.
6. Record failures as actionable blockers with file-level remediation.

## Deliverables
- Pass/fail matrix per client (mobile/web/electron).
- Missing prerequisites.
- EAS build id/status or explicit blocker if cloud build cannot be started.
- Final go/no-go recommendation.
