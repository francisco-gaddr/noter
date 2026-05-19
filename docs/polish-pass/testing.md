# Polish Pass — Testing

[← Index](./index.md)

## Backend

Run: `cd noter-app/apps/backend && pnpm test`

### Unit tests

| File | Module under test | Covers |
|---|---|---|
| `__tests__/utils/mongooseDebug.test.ts` | `utils/mongooseDebug.ts` | PII key redaction, max-depth limit, value truncation, array overflow handling |
| `__tests__/middleware/perfHistogram.test.ts` | `middleware/perfHistogram.ts` | record + snapshot maths, error counter, reset |
| `__tests__/middleware/serverTiming.test.ts` | `middleware/serverTiming.ts` | header format, total dur, recordTiming append, timeSection helper |
| `__tests__/middleware/authMiddleware.test.ts` | `middleware/authMiddleware.ts` | `extractTenantClaims` with array / space / comma scopes |
| `__tests__/middleware/rateLimit.test.ts` | `middleware/rateLimit.ts` | in-memory fallback, 429 after exhaust, headers emitted |
| `__tests__/graphql/openapi.test.ts` | `scripts/generateOpenApi.ts` | OpenAPI 3.1 schema validation, component schemas, security schemes |

### Integration tests

| File | Covers |
|---|---|
| `__tests__/apollo.integration.test.ts` | Apollo Server v5 mounted at /api/graphql, returns expected shape, masks errors in prod |

### Not unit-testable here

- `changeStreamInvalidator.ts` — requires a running replica set; behaviour is
  covered by the `isReplicaSet()` no-op test and a manual ops runbook.

## Electron

Run: `cd electron-noter && pnpm test`

| File | Module under test | Covers |
|---|---|---|
| `tests/main-helpers.test.js` | `main.js` (extracted helpers) | `isWindows11` version detection, `applySpellCheckerCdn` URL validation, `generateThumbnail` path traversal guard, `runIsolatedScript` allow-list |

### Not unit-testable here

- Full BrowserWindow lifecycle — exercised by the existing
  `tests/*.spec.js` Playwright suite under `playwright.config.js`. The
  Playwright suite predates this pass.

## Mobile

Run: `cd noter-app/apps/mobile && pnpm test`

| File | Module under test | Covers |
|---|---|---|
| `__tests__/services/storage/kv.test.ts` | `services/storage/kv.ts` | AsyncStorage adapter pass-through, MMKV adapter absent → AsyncStorage used, migration sentinel idempotency |
| `__tests__/hooks/useReduceMotion.test.ts` | `hooks/useReduceMotion.ts` | Initial false, updates on `reduceMotionChanged` event |
| `__tests__/components/NoteItem.haptic.test.tsx` | `components/NoteItem.tsx` | `Haptics.selectionAsync` called on press |

### Not unit-testable here

- FadeIn animation rendering — Reanimated requires a native runtime; covered
  in Detox e2e under `e2e/` (uses existing Detox setup).
- KV migration end-to-end — verifies in-memory with mocked AsyncStorage;
  full MMKV migration requires the dep to be installed.

## CI

Run locally:
```bash
./.github/scripts/check-checkout-credentials.sh
```

The CI workflow `.github/workflows/actionlint.yml` runs both `actionlint`
itself and our custom rule on every PR that touches workflows or the rule
script.

The rule is self-tested: the [ci.md](./ci.md#1-actionlint-with-custom-persist-credentials-rule)
section shows how to trigger a violation locally and verify the error is
reported.

## End-to-end coverage

| Platform | Tool | Status |
|---|---|---|
| Mobile | Detox (existing in `e2e/`) | Pre-existing; new haptic test covers UX change |
| Electron | Playwright (existing in `tests/`) | Pre-existing |
| Web | Cypress (existing in `apps/web/cypress.config.ts`) | Pre-existing |

This pass intentionally did NOT add new e2e tests for the scaffolding-only
items (MMKV adapter, electron-updater Sigstore stub) because there's no
fixture to drive — the code paths are gated behind environment / setting
flags that aren't met in the e2e harness.

## Running everything

```bash
# From repo root
cd noter-app/apps/backend && pnpm test && cd -
cd noter-app/apps/mobile && pnpm test && cd -
cd electron-noter && pnpm test && cd -
./.github/scripts/check-checkout-credentials.sh
```

Each phase exits non-zero on failure; aggregate exit code is fine for a
gate workflow.
