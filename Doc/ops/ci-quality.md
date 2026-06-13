# CI & Code-Quality Pipeline

**Updated:** 2026-06-13

## What runs

`.github/workflows/ci.yml` runs on push (`dev`, `main`, `agent/**`) and PRs to
`dev`/`main`. Two jobs:

### `app-quality` (noter-app)
| Step | Gate | Notes |
|------|------|-------|
| `npm run check-types` | **blocking** | `turbo run check-types` across all workspaces |
| core tests (`@repo/shared`, `@repo/ai`) | **blocking** | fast, deterministic, green |
| `npm run knip:files` | **blocking** | **no dead/unimported source files** — backlog cleared 2026-06-13 (8 removed) |
| app tests (`mobile`, `backend`, `web`) | non-blocking | has a pre-existing flake backlog (see below) |
| `npm run knip` | non-blocking | broader dead-code / unused-dep report (deps still being triaged) |

### `electron-quality` (electron-noter)
| Step | Gate | Notes |
|------|------|-------|
| `npm test` | non-blocking | jest unit tests |

Blocking gates are deliberately limited to checks that are currently green so the
required status never goes red through no fault of a PR. The non-blocking steps are
**burn-down lists**: fix them, then promote each to blocking.

## Local commands
```bash
cd noter-app
npm run check-types          # tsc across workspaces
npm test                     # turbo run test (all workspaces)
npm run knip                 # dead-code + unused-dependency report
npm run knip:production      # stricter: production entry points only
```

## Promote-to-blocking checklist
1. **Mobile/web/backend test flakes.** Several suites fail from an
   `expo-modules-core` / `expo-clipboard` native-view mock gap
   (`viewManagersMetadata` undefined) plus a few render-env issues
   (`NoteItem.haptic`, `layout`, `project-selector`, `settings-press-feedback`,
   `video-embed`, `notifications`, `ai-header`, `ai-sidebar`). These predate the
   current work (verified identical on a clean `dev` checkout). Fix the shared mock,
   then flip the "app tests" step to blocking.
2. **knip backlog.** Current report (after false-positive tuning in `knip.json`):
   - ~8 unused files (verify each — some are dynamically imported; **do not bulk
     delete**). Platform files (`*.web.ts`) are already excluded as entry points.
   - ~7 unused devDeps, ~18 unused deps — confirm per item before removing.
   - **Unlisted dependencies (highest value):** used-but-undeclared packages
     (`archiver`, `mongodb`, `react-native-mmkv`, `body-parser`, `uuid`, `dnd-core`…).
     These are the same bug class as the EAS dep-strip trap — declare them in the
     owning workspace's `package.json`.
   Burn this down, then add `--strict` and make knip blocking.

## Already fixed this pass
- `packages/ai/jest.config.js` scanned the compiled `dist/__tests__` copy, failing the
  run with "must contain at least one test". Restricted to `src/` → green, now a
  blocking gate.
- `turbo.json` gained a `test` task (there was none, so no CI ran tests before).

## Config files
- `noter-app/turbo.json` — `test` task wired for `turbo run test`.
- `noter-app/knip.json` — per-workspace entry points so framework-routed files
  (expo-router `app/`, Next `app/`) and platform files aren't mis-flagged. `eslint`,
  `jest`, `next` plugins disabled (they crashed on this monorepo's configs); knip runs
  as a pure unused-code/dep analyzer.
