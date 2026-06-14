# Noter — Kritisk kodgranskning och förbättringsplan

Status: `agent/e2e-encryption-clean` · 2026-05-14 · reviewer: djup genomgång + implementation av `noter-app/`, `electron-noter/`, `packages/ai`, `packages/shared` och hela `Doc/`.

## ⭐ Planerat nästa stort initiativ — Desktop: Electron → Tauri v2 (2026-06-14)

Dokumentationen är **förberedd och exekveringsklar** så migreringen inte startar från noll:

- **Beslut + motivering:** [`adr/0007-electron-vs-tauri.md`](adr/0007-electron-vs-tauri.md) — migrera, men gör en **1–2 veckors spike först** (rendera vår riktiga UI i WKWebView/WebView2/WebKitGTK + prototypa keyring-dataKey). Vinster: ~10–30× mindre installer, ~½ RAM; vår Next.js-static-UI följer med.
- **Körguide (steg-för-steg, säkerhetsförst):** [`migrations/electron-to-tauri-runbook.md`](migrations/electron-to-tauri-runbook.md) — komplett **IPC-karta (45+ kanaler)** från verkliga `electron-noter/`, **secure-store-omdesignen som bevarar E2E** (keyring master-key + AES-GCM-blob; v3-dataKey aldrig i klartext; migrera via E2E-lösenord), **auto-update-brygga** för befintliga användare (minisign, Windows två-stegssignering), **3-webview QA-matris**, **§9 Säkerhetsgrind** som körs varje fas, fasplan med exit-gates, effort (~6–10 personveckor), rollback.
- **Mål (icke förhandlingsbart):** all funktionalitet OCH säkerhet kvarstår — E2E-kryptering, locked-notes-invarianten och "inga klartextläckor utom opt-in-kalenderlänken" verifieras i §9 efter varje fas. `electron-noter/` förblir releasebar tills Tauri-bygget klarar §7 (QA) + §9 (säkerhet).
- **Var börjar jag?** Läs ADR-0007 (5 min) → följ runbookens §1 (spike) → §10 (fasplan). Allt finns redan kartlagt; inget gissande.

## Statusuppdatering (2026-06-13 — offline-sync-kö)

| # | Område | Status | Detalj |
|---|--------|--------|--------|
| S1 | Dubbel offline-kö | ✅ | Raderade oinkopplad `services/offlineQueue.ts` + test (död kod). Aktiv SQLite-`sync_queue` är enda sanningen. Se [ADR-0004](adr/0004-offline-sync-queue.md). |
| S2 | Offline data-förlust | ✅ | `addToSyncQueue` bytte `INSERT OR IGNORE` → UPSERT (`ON CONFLICT(dedupeKeyHash) DO UPDATE … attempts=0`). Andra offline-redigeringen av samma not/task tappas inte längre (latest-wins). |
| S3 | Regressionsskydd | ✅ | `tests/database-at-rest.test.ts` låser fast upsert-formen (inte `OR IGNORE`). `jest store database-at-rest useRouteRestore` grönt (29), `tsc` rent. |

Lärdom: när en payload bär *hela* entitetens tillstånd måste dedupe vara
latest-wins, inte first-wins — annars vinner en föråldrad kö-post över en
nyare lokal ändring efter nästa fetch. Verifiera alltid den *föreslagna*
biten också: en flaggad "död" `kv`-helper visade sig leva via
`hooks/useRouteRestore.ts` och rördes därför inte.

## Statusuppdatering (2026-05-14 batch 10)

| # | Område | Status | Detalj |
|---|--------|--------|--------|
| B1 | Apollo GraphOS | ✅ | `graphql/graphos.ts` plugins via `APOLLO_KEY`+`APOLLO_GRAPH_REF` |
| B2 | Slow-log per query | ✅ | `graphql/slowLog.ts` Apollo-plugin med top-5-resolvers trace |
| B3 | GraphQL subscriptions | ✅ | `graphql/subscriptions.ts` pubsub + Socket.IO-adapter |
| B4 | `db:migrate` | ✅ | `scripts/dbMigrate.ts` (drizzle + pgcrypto+pgvector ext) |
| B5 | SW CSP batcher | ✅ | `apps/web/public/csp-report-batcher.js` + `Reporting-Endpoints` header |
| B6 | JA3S logging | ✅ | `security/ja3sLogger.ts` outbound TLS fingerprint diff |
| E1 | WebUSB/WebHID disabled | ✅ | `setDevicePermissionHandler` + check/request handlers |
| E2 | session.preconnect | ✅ | `partitionedSession.preconnect({ url, numSockets: 2 })` |
| E3 | No default menu | ✅ | `Menu.setApplicationMenu(null)` i prod |
| E4 | Crash extra params | ✅ | release_version, release_channel, platform, arch |
| E5 | Cookies flush | ✅ | `session:flush-cookies` IPC, `noterAccount.flushCookies()` |
| M1 | Signed slugs | ✅ | `services/router/signedSlugs.ts` HMAC mot dataKey |
| M2 | Shared-element | ✅ | `components/SharedElement.tsx` Reanimated `sharedTransitionTag` |
| M3 | Encrypted clipboard | ✅ | `services/clipboard/secureClipboard.ts` 60s auto-clear |
| M4 | Continuous OCR | ✅ | `services/camera/continuousOcr.ts` debounce + dedup + encrypt |
| M5 | MMKV key rotation | ✅ | `rotateMmkvEncryptionKey()` mellan instanser |
| X1 | Nightly mutation | ✅ | `nightly-mutation.yml` 02:00 UTC + auto-issue |
| X2 | ADR-mapp | ✅ | `Doc/adr/` README + TEMPLATE + 3 ADR (E2E, MCP-intent, trusted-docs) |
| X3 | devbox.json | ✅ | Nix-baserad dev-shell config med scripts |
| X4 | SSE status-page | ✅ | `routes/statusStream.ts` `/api/status/stream` 5s tick |
| X5 | Crowdin sync | ✅ | `crowdin.yml` + `crowdin-sync.yml` workflow |

Verifierat: shared/ai/backend/web/mobile `tsc` rent · electron `node -c` OK · `@repo/ai` jest 14 passed (+1 skipped).

---

## Statusuppdatering (2026-05-14 batch 9)

| # | Område | Status | Detalj |
|---|--------|--------|--------|
| B1 | Apollo APQ Redis-store | ✅ | `graphql/persistedQueriesStore.ts`, `persistedQueries.cache` på Apollo-instans |
| B2 | DataLoader error-batching | ✅ | `noteById`/`taskById` wrappar fel som per-id Error, isolerar batch-fel |
| B3 | CSPv3 Reporting API | ✅ | `routes/cspReport.ts` `/csp-reports-v3` `application/reports+json` |
| B4 | Manual spans | ✅ | `startSpan('auth.login')` + `startSpan('mcp.callTool')` idempotent |
| B5 | AbortSignal e2e | ✅ | `utils/abortable.ts` `requestAbortSignal` + race-wrapper |
| B6 | JA3 rate-limit | ✅ | `security/ja3RateLimit.ts` mountad före authLimiter |
| E1 | Encrypted PDF | ✅ | `window:print-to-encrypted-pdf` AES-256-GCM + scrypt |
| E2 | NetLog för support | ✅ | `support:capture-network-{start,stop,status}` IPC |
| E3 | Tray badge | ✅ | `tray:set-badge` med macOS dock + tooltip fallback |
| E4 | Save dialog | ✅ | `export:save-as` med default PDF/HTML/MD-filter |
| E5 | noter:// markdown helper | ✅ | `attachment:write/resolve-url` för `<img src="noter://attachment/...">` |
| M1 | typed-routes codegen | ✅ | `codegen.ts` + `routeHashes.cjs` plugin matar `generated/routeHashes.ts` |
| M2 | Drawer | ✅ | `NoterDrawer.tsx` swipe-gesture + scrim + reduce-motion |
| M3 | PullToRefresh | ✅ | `PullToRefresh.tsx` Skia spinner + Reanimated rotation |
| M4 | Restyle tema | ✅ | `services/theme/restyle.ts` `buildNoterRestyleTheme(mode)` |
| M5 | MCP background poll | ✅ | `services/background/mcpStatusPoll.ts` diff + local notification |
| X1 | Stryker mutation | ✅ | `stryker.config.json` 6 crypto-paths + `npm run test:mutation` |
| X2 | gh-act-bridge | ✅ | `scripts/gh-act-bridge.mjs` zx, secret-prompt + 0600-output |
| X3 | turbo graph SVG | ✅ | `scripts/turbo-graph.mjs` build+check-types graphs |
| X4 | License halvår-diff | ✅ | `license-diff.yml` cron 1 jan + 1 jul, auto-PR |
| X5 | WCAG 2.2 audit | ✅ | `Doc/security/a11y-audit.md` checklista för web/iOS/Android |
| X6 | Playwright traversal | ✅ | `tests/e2e/attachment-traversal.spec.js` 9 malicious id:n |

Verifierat: shared/ai/backend/web/mobile `tsc` rent · electron `node -c` OK · `@repo/ai` jest 14 passed (+1 skipped).

---

## Statusuppdatering (2026-05-14 batch 8)

| # | Område | Status | Detalj |
|---|--------|--------|--------|
| B1 | crypto worker-pool | ✅ | `utils/cryptoWorker.ts` + entry; bulk encrypt/decrypt med 2-worker default |
| B2 | Connection-pool metrics | ✅ | `observability/metrics.ts` Prom-yta, `/metrics` mount, mongoPoolMonitor |
| B3 | GraphQL cursor-pag | ✅ | `graphql/cursor.ts` med base64-cursors på `updatedAt:_id` |
| B4 | drizzle-orm | ✅ | `db/drizzleSchema.ts` + `drizzle.config.ts` (lazy-required) |
| B5 | KMS dataKey-wrap | ✅ | `security/kmsWrap.ts` AWS KMS via `NOTER_KMS_KEY_ID` |
| B6 | Server-side AI streaming | ✅ | `routes/aiStream.ts` SSE för OpenRouter + Gemini fallback, mountad på `/api/ai/stream` |
| B7 | Multi-dep health | ✅ | `routes/healthDeep.ts` `/api/health/deep` healthy/degraded/unhealthy |
| E1 | noter:// attachment | ✅ | `installAttachmentProtocol` id-sanering + MIME-detection |
| E2 | Cert-rotation runbook | ✅ | `Doc/ops/cert-rotation.md` Apple + Azure flow |
| E3 | Per-user cookies | ✅ | `account:apply-session/clear-session` via `noterAccount.*` |
| E4 | Tray + quick-actions | ✅ | `installTray` med 5 alternativ + click-toggle |
| E5 | Multi-window | ✅ | `createDetachedWindowFactory` + `window:open-detached` IPC |
| E6 | http:request deprecation | ✅ | `NOTER_USE_NETFETCH_BRIDGE`-flagga + legacy-disabled-handler |
| M1 | expo-haptics | ✅ | `services/haptics/haptics.ts` 6 semantiska variants + reduce-motion-respekt |
| M2 | Image manipulator | ✅ | `services/image/imageManipulator.ts` resize+encrypt, thumbnail |
| M3 | Onboarding carousel | ✅ | `components/OnboardingCarousel.tsx` Reanimated + GlassSurface |
| M4 | Tema-system | ✅ | `services/theme/themeSystem.ts` 6 accents + expo-system-ui |
| M5 | Export + share | ✅ | `services/exportShare/exportShare.ts` PDF→share-chain |
| M6 | Lock-screen widget | ✅ | `plugins/withLockscreenWidget.js` Info.plist config-plugin |
| M7 | Forced-update OTA | ✅ | `services/updates/forcedUpdate.ts` min-runtime + force-flag |
| X1 | cert-manager k8s | ✅ | `deploy/k8s/base/cert-manager.yaml` ClusterIssuer + Cert med 90d-rotation |
| X2 | OPA bundle | ✅ | `deploy/opa/{config,policy}` + `opa-bundle.yml` workflow till R2 |
| X3 | fast-check fuzz | ✅ | `__tests__/parser.fuzz.test.ts` 4 property-tester (skip om paket saknas) |
| X4 | oclif admin CLI | ✅ | `apps/admin-cli/` med `user-revoke` + `db-reconcile` commands |
| X5 | Types-sync workflow | ✅ | `.github/workflows/types-sync.yml` diff-detect mot 4 spårade deps |
| X6 | CWE-mappning | ✅ | `Doc/security/cwe-mapping.md` STRIDE↔CWE-tabell |
| X7 | Uplink backup | ✅ | `packages/shared/src/dataKeyBackup.ts` history + `rotateWithBackup` |
| X8 | Quality-gate workflow | ✅ | `quality-gate.yml` aggregerar typecheck+license+cypress-critical+lighthouse |

Verifierat: shared/ai/backend/web/mobile `tsc` rent · electron `node -c` OK · `@repo/ai` jest 14 passed (+1 skipped fast-check).

---

## Statusuppdatering (2026-05-14 batch 7)

| # | Område | Status | Detalj |
|---|--------|--------|--------|
| B1 | Apollo Server v4 pilot | ✅ | `graphql/apolloAdapter.ts` opt-in via `NOTER_GRAPHQL_RUNTIME=apollo` |
| B2 | pgvector audit-similarity | ✅ | `observability/auditSimilarity.ts` 384-d vector, cosine-distance ordering |
| B3 | gRPC MCP-IPC adapter | ✅ | `services/mcp/grpcAdapter.ts` + `proto/mcp.proto`; opt-in `MCP_GRPC_ENDPOINT` |
| B4 | Per route+method rate-limit | ✅ | `perRouteRateLimit.ts` med 10 standard-routes inkopplade i `/api`-pipe |
| B5 | LISTEN/NOTIFY outbox | ✅ | `services/webhookOutboxListener.ts` + safety-poll 30 s |
| B6 | pgcrypto AEAD wrapper | ✅ | `security/pgcryptoAead.ts` med `pgp_sym_encrypt/decrypt` |
| B7 | OpenAPI gen | ✅ | `scripts/generateOpenApi.ts` från zod-schemas + `npm run docs:openapi` |
| B8 | CT monitor | ✅ | `security/ctMonitor.ts` pollar crt.sh mot `NOTER_CT_ALLOWLIST` |
| E1 | session.setProxy | ✅ | `proxy:set/clear/status` IPC via `noterDiag.setProxy(...)` |
| E2 | savePage | ✅ | `window:save-page` IPC → `webContents.savePage HTMLComplete` |
| E3 | takeHeapSnapshot | ✅ | `diag:take-heap-snapshot` skriver till userData/logs |
| E4 | net.fetch | ✅ | `net:fetch` via Chromium-stacken med allowlist + sanering |
| E5 | Per-frame exec | ✅ | `frame:exec` mot `WebFrameMain.fromId` |
| E6 | safeStorage version-tagg | ✅ | `safestorage:encrypt/decrypt` prefixar med `NOTER_SAFESTORAGE_KEY_VERSION` |
| E7 | setAppLogsPath | ✅ | Centraliserad till `userData/logs` vid start |
| M1 | Vision-Camera OCR | ✅ | `services/camera/visionCameraOcr.ts` med ML Kit + vision-camera-ocr-fallback |
| M2 | Screen-capture guard | ✅ | `services/security/screenCaptureGuard.ts` enable/disable + screenshot-listener |
| M3 | Dev-plugins | ✅ | `services/devtools/installDevPlugins.ts` (react-query/storage) |
| M4 | Keyboard controller | ✅ | `components/KeyboardSafeArea.tsx` + `KeyboardProviderRoot` |
| M5 | PDF preview | ✅ | `components/PdfPreview.tsx` fast-pdf → rn-pdf → WebView fallback |
| M6 | Quick Actions | ✅ | `services/quickActions/quickActions.ts` med 4 default-actions |
| M7 | Voice capture | ✅ | `services/voice/voiceCapture.ts` med lokal Whisper-fallback |
| X1 | semantic-release | ✅ | `.releaserc.json` + `semantic-release.yml` workflow |
| X2 | Vitest scaffold | ✅ | `vitest.config.ts` i shared+ai, `test:vitest`-script |
| X3 | Web RUM | ✅ | `apps/web/lib/rum.ts` web-vitals + sendBeacon |
| X4 | Distroless backend | ✅ | `Dockerfile.distroless` + docker-publish.yml med provenance |
| X5 | GitOps (ArgoCD + Flux) | ✅ | `deploy/k8s/{base,overlays/production}` + Argo Application + Flux Kustomization |
| X6 | act-config | ✅ | `.actrc` + `.secrets.act.example` |
| X7 | mcps:// discovery | ✅ | `packages/shared/src/mcpsDiscovery.ts` med ed25519-signaturverifiering |
| X8 | Cypress grep | ✅ | `cypress.config.ts` + `cypress/support/e2e.ts` med tag-filter |

Verifierat: shared/ai/backend/web/mobile `tsc` rent · electron `node -c` OK · `@repo/ai` jest 14/14 gröna.

---

## Statusuppdatering (2026-05-14 batch 6)

| # | Område | Status | Detalj |
|---|--------|--------|--------|
| B1 | Token-revocation list | ✅ | `services/tokenRevocation.ts` med `noter:rev:<jti>` Redis-keys, fail-open |
| B2 | $indexStats stickprov | ✅ | `scripts/indexStats.ts` + `db:index-stats` (exit 3 vid stale-index) |
| B3 | Per-tenant Redis-namespaces | ✅ | `services/userCache.ts` med epoch-baserad soft-flush per user |
| B4 | CSP report endpoint | ✅ | `routes/cspReport.ts` dedup + per-min rate-limit |
| B5 | Fastify pilot | ✅ | `fastify/pilot.ts` opt-in via `NOTER_FASTIFY_PILOT_PORT` |
| B6 | Stable-stringify för audit | ✅ | `fast-json-stable-stringify` på `appendMcpAudit`-payload |
| B7 | Postgres outbox för webhooks | ✅ | `services/webhookOutbox.ts` `FOR UPDATE SKIP LOCKED` + backoff |
| B8 | MCP deny-by-default | ✅ | `evaluatePolicy({ action: 'write', resource: { kind: 'mcp' } })` före intent-check |
| E1 | Wake-lock IPC | ✅ | `wake-lock:request/release` via `powerSaveBlocker` |
| E2 | Crash rate-limiter | ✅ | `installCrashRateLimiter` fingerprint-dedup, 5/min |
| E3 | UA-strip | ✅ | `cleanUserAgent` strippar Electron/Chrome/Noter-tokens |
| E4 | Isolated-world JS-exec | ✅ | `renderer:exec-isolated` IPC mot `executeJavaScriptInIsolatedWorld` |
| E5 | Print + PDF IPC | ✅ | `window:print` + `window:print-to-pdf` |
| E6 | Secure keyboard entry | ✅ | `secure-kbd:enable/disable` (macOS) |
| E7 | Windows Toast | ✅ | `toast:show` med `toastXml`-payload på Win, Notification fallback |
| M1 | Edge-to-edge | ✅ | `EdgeToEdgeScreen.tsx` lazy SystemBars |
| M2 | expo-image | ✅ | `NoterImage.tsx` blurhash + memory-disk cache fallback till RN Image |
| M3 | Skia sparkline | ✅ | `Sparkline.tsx` lazy `@shopify/react-native-skia` |
| M4 | Sentry-RN | ✅ | `services/observability/sentry.ts` `EXPO_PUBLIC_SENTRY_DSN` |
| M5 | Liquid Glass | ✅ | `GlassSurface.tsx` expo-glass-effect → expo-blur → translucent fallback |
| M6 | Background sync chain | ✅ | `syncChain.ts` push→pull via background-task + battery-gating |
| M7 | EAS Update channels | ✅ | `eas.json` development/preview/beta/production med rollout-percent |
| M8 | A11y eslint | ✅ | `.eslintrc.a11y.cjs` med `react-native-a11y/recommended` + skärpta regler |
| X1 | Next.js dev checker | ✅ | `scripts/dev-with-checker.mjs` + `dev:checked` npm-script |
| X2 | CODEOWNERS | ✅ | `.github/CODEOWNERS` per workspace + säkerhetspaths |
| X3 | Internal docs site | ✅ | `docs-site/` Astro Starlight scaffold sv/en locales |
| X4 | MCP integration test | ✅ | `__tests__/mcp.integration.test.ts` (intent + deny-by-default + stable-stringify) |
| X5 | DB-reconcile rollout | ✅ | `scripts/db-reconcile-rollout.mjs` zx (staging → confirm → prod) |
| X6 | DR runbook | ✅ | `Doc/ops/disaster-recovery.md` med 6 scenarier |
| X7 | Cost-telemetry | ✅ | `packages/shared/src/costTelemetry.ts` batchad fetch |
| X8 | w3up public share | ✅ | `packages/shared/src/publicShare.ts` IPFS-publicering av krypterad snapshot |

Verifierat: shared/ai/backend/web/mobile `tsc` rent · electron `node -c` OK · `@repo/ai` jest 14/14 gröna.

---

## Statusuppdatering (2026-05-14 batch 5)

| # | Område | Status | Detalj |
|---|--------|--------|--------|
| B1 | MCP OS-sandbox | ✅ | `services/mcp/sandbox.ts`: bubblewrap (Linux), sandbox-exec/Seatbelt (macOS); fallback transparent |
| B2 | OPA/Cedar authz | ✅ | `security/policy.ts` med `evaluatePolicy` + `requirePolicy`; inline-fallback |
| B3 | Trace-context propagation | ✅ | `observability/contextPropagation.ts`; MCP-subprocesser får `TRACEPARENT` env |
| B4 | Audit-event stream | ✅ | `observability/auditStream.ts` fan-out till ClickHouse/BigQuery/HTTP |
| B5 | Postgres counters | ✅ | `services/counters.ts` ACID-räknare + in-memory fallback |
| B6 | Mongoose virtual id | ✅ | `utils/schemaOptions.ts` med `toJSON: { virtuals, versionKey:false, transform }` |
| B7 | GraphQL response cache | ✅ | `graphql/responseCache.ts` per-user epoch + Redis-back |
| B8 | mTLS internal endpoints | ✅ | `security/mtls.ts` cert-verifiering + CA-load |
| B9 | Replay → password reset signal | ✅ | `User.securityFlagAt/Reason`; `/auth/refresh` returnerar `code: 'replay_detected'` |
| E1 | noter:// custom protocol | ✅ | `deepIntegrations.registerCustomProtocol` HMAC-signed + open-url + argv |
| E2 | Asar integrity check | ✅ | `verifyAppAsarIntegrity` mot `NOTER_ASAR_SHA256` |
| E3 | SafeStorage rotation | ✅ | `createSafeStorageRotator` multi-key tag-prefix |
| E4 | NSUserActivity/Handoff | ✅ | `registerMacUserActivity` |
| E5 | Idle auto-lock | ✅ | `setupIdleAutoLock` mot `powerMonitor.getSystemIdleTime` |
| E6 | Smoke-assert | ✅ | `assertSecurityInvariants` fail-fast på contextIsolation/sandbox/!nodeIntegration |
| E7 | Sentry bridge | ✅ | `createSentryBridge` envelope-POST utan @sentry/electron-dep |
| M1 | Reanimated layout-animations | ✅ | `NoteListItem.tsx` `FadeInUp`/`FadeOutDown`/`LinearTransition.springify` |
| M2 | Document picker | ✅ | `services/import/documentImport.ts` (PDF heuristik + plaintext) krypterar v3 direkt |
| M3 | Widgets bridge | ✅ | `services/widgets/widgetsBridge.ts` (WidgetKit reload + Glance NativeModule) |
| M4 | Watch sync | ✅ | `services/watch/watchSync.ts` JS-bridge mot native target |
| M5 | Background sync v2 | ✅ | `networkAwareSync` MMKV-checkpoint vid state-byte |
| M6 | SecureStore access group | ✅ | `EXPO_PUBLIC_KEYCHAIN_ACCESS_GROUP` styr delning |
| M7 | FlashList | ✅ | `components/NoteFlashList.tsx` v2-API |
| M8 | Detox e2e | ✅ | `.detoxrc.js` + `e2e/jest.config.ts` + `e2e/smoke.test.ts` |
| X1 | OpenSSF Scorecard | ✅ | `.github/workflows/scorecard.yml` veckokörning + SARIF |
| X2 | SLSA provenance | ✅ | `slsa-provenance.yml` via `actions/attest-build-provenance@v2` |
| X3 | mise/asdf | ✅ | `.mise.toml` + `.tool-versions` |
| X4 | Turbo remote cache | ✅ | `turbo.json` `remoteCache.enabled + signature` |
| X5 | Renovate | ✅ | `renovate.json` med grupper + auto-merge på patch types/eslint |
| X6 | R2/B2 model proxy | ✅ | `services/modelProxy.ts` HMAC-signed URLs, 5-min TTL |
| X7 | zx release script | ✅ | `scripts/release.mjs` skip-flags per steg |
| X8 | actionlint + shellcheck | ✅ | `.github/workflows/actionlint.yml` |
| X9 | @noble/curves sharing | ✅ | `packages/shared/src/sharing.ts` X25519 + HKDF + AES-GCM wrap |
| X10 | Postmortems-mall | ✅ | `Doc/incidents/TEMPLATE.md` + `README.md` med sev-stege |

Verifierat: shared/ai/backend/web/mobile `tsc` rent · electron `node -c` OK · `@repo/ai` jest 14/14 gröna.

---

## Statusuppdatering (2026-05-14 batch 4)

| # | Område | Status | Detalj |
|---|--------|--------|--------|
| B1 | bcrypt worker_threads-pool | ✅ | `utils/bcryptWorker.ts` + entry; `bcryptHash`/`bcryptCompare` med inline fallback |
| B2 | Hidden+partial TTL-index | ✅ | `Note.ts` + `Task.ts` `{ hidden: true }` (override via env) |
| B3 | RefreshToken rotation-detection | ✅ | `useCount`/`lastUseAt`/`rotationReason`; replay revokerar familjen omedelbart |
| B4 | cleanIndexes-skript | ✅ | `src/scripts/reconcileIndexes.ts` + `npm run db:reconcile-indexes` |
| B5 | Read-only replicas | ✅ | `.read('secondaryPreferred')` på notes-list, tasks-list, AI-sync-pull |
| B6 | Separat rate-limiter Redis | ✅ | `RATE_LIMITER_REDIS_URL` med fallback till `REDIS_URL` |
| B7 | Signed outbound webhooks | ✅ | `services/webhooks.ts` HMAC-SHA256, timestamp-replay-skydd, exponential backoff |
| E1 | Cert-pinning | ✅ | `setCertificateVerifyProc` mot `NOTER_PINNED_BACKEND_HOST` + fingerprint allowlist |
| E2 | Spell-check | ✅ | `setSpellCheckerEnabled` + `['sv-SE','en-US']` på partitioned session |
| E3 | Single-instance lock | ✅ | `requestSingleInstanceLock` + focus existerande fönster |
| E4 | MessagePortMain | ✅ | `src/mlcMessagePort.js` MessageChannelMain + abort-handshake |
| E5 | AppImage + Flatpak | ✅ | `linux.target` + `flatpak.finishArgs` |
| E6 | Delta updates | 🟡 | electron-updater differential delivery; modeller via `asarUnpack: renderer-standalone/**` |
| M1 | Skeleton screens | ✅ | `Skeleton.tsx` + `SkeletonList` med Reanimated + reduced-motion |
| M2 | Battery-aware sync | ✅ | `batteryAwareSync.ts` med `expo-battery`-listeners + force-flag |
| M3 | quick-crypto wrapper | ✅ | `services/crypto/quickCrypto.ts` med WebCrypto + noble-fallback |
| M4 | Drag-to-reorder hook | ✅ | `hooks/useDragToReorder.ts` Gesture v3 + Reanimated worklets |
| M5 | Rich notification actions | ✅ | `richActions.ts` (mark-complete / snooze / open) |
| M6 | Typed routes hashed | 🟡 | `expo-router` typed-routes på + codegen genererar trusted-doc-hash för båda klienter |
| X1 | Yjs scaffold | ✅ | `packages/shared/src/collab.ts` encrypted-snapshot helpers, Yjs lazy |
| X2 | zod-schemas delade | ✅ | `schemas.ts` notes/tasks/tool-args |
| X3 | Dependabot groups | ✅ | YAML-anchor `default-groups`; OpenTelemetry/noble/Storybook/GraphQL/RN/Motion/Linters/Types/Test-tooling |
| X4 | Threat-model | ✅ | `Doc/security/threat-model.md` STRIDE + review-checklist |
| X5 | CHANGELOG.md | ✅ | `CHANGELOG.md` + `.versionrc.json` |
| X6 | License gate | ✅ | `license-gate.yml` `license-checker --onlyAllow` per workspace |
| X7 | Lighthouse CI | ✅ | `.lighthouserc.json` + workflow med perf 0.85 / a11y 0.95 / BP 0.9 |

Verifierat: shared/ai/backend/web/mobile `tsc` rent · electron `node -c` OK · `@repo/ai` jest 14/14 gröna.

---

## Statusuppdatering (2026-05-14 batch 3)

| # | Område | Status | Detalj |
|---|--------|--------|--------|
| B1 | DataLoader list-resolvers | ✅ | `notesByParentId` + `tasksByNoteId` med prime-side-effect mot byId-loaders |
| B2 | graphql-query-complexity formell | ✅ | `complexity.ts` med `fieldExtensionsEstimator`; `notes`/`tasks` har `extensions.complexity` (childComplexity-multiplikator) |
| B3 | Argon2id worker thread | ✅ | `utils/argon2Worker.ts` pool + `argon2WorkerEntry.ts`; `serverKdf.ts` använder workern; max 4 workers, 15s timeout |
| B4 | OpenTelemetry | ✅ | `observability/tracing.ts` initierar `@opentelemetry/sdk-node` när `NOTER_OTEL_ENABLED=1`; manuell `startSpan`-helper |
| B5 | AI-sync-kvot | ✅ | Redan i `aiSync.ts:127–137` (getMaxSyncRecordsPerUser) |
| B6 | Soft-delete-routes | ✅ | Notes cascade och task DELETE använder `set('deletedAt', new Date())`; läsvägar filtrerar `{ $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] }` |
| B7 | CSRF-skydd | ✅ | `middleware/csrf.ts` Origin/Referer-check; refresh-cookie `sameSite='strict'`; access-cookie kvar `'lax'`; Bearer-token-exempt |
| E8 | macOS notarize-config | ✅ | `mac.notarize.teamId = ${env.APPLE_TEAM_ID}` |
| E9 | Win Azure Trusted Signing | ✅ | `azureSignOptions` block med endpoint/profile/account från env |
| E10 | CSP nonce-pipeline | ✅ | `middleware.ts` genererar nonce per request; `lib/csp.ts` server-helper; `layout.tsx` injectar `<meta name="csp-nonce">` |
| E11 | Session partition | ✅ | `webPreferences.partition = 'persist:noter'`; CSP-binding på både default- och partitionerad session |
| E12 | Crash reporter | ✅ | `crashReporter.start({ submitURL: NOTER_CRASHREPORT_URL })` med lokal fallback |
| M13 | MMKV aktiverat | ✅ | `react-native-mmkv` installerad; `mmkv.ts` har `resetNoterCache` + `migrateAsyncStorageToMmkv` |
| M14 | Hermes precompile | ✅ | `app.json` `jsEngine: 'hermes'` + `expo-build-properties` android `enableHermes: true` + ProGuard release-builds |
| M15 | expo-background-task | ✅ | `services/background/backgroundTasks.ts` med `BackgroundTaskResult`-mapping, lazy-required |
| M16 | SecureStore biometric default | ✅ | `REQUIRE_BIOMETRIC` = true i `NODE_ENV=production` om inte explicit `=0` |
| M17 | Network-aware sync | ✅ | `services/sync/networkAwareSync.ts` med NetInfo-listener, exponential backoff, kvotbegränsad kö |
| X18 | OTel-instrumentering | ✅ | Backend init på plats; klient via `noter:ai-loop-stop`-events (koppla till otel-web när dashboard finns) |
| X19 | SBOM-generering | ✅ | `.github/workflows/sbom.yml` med CycloneDX per workspace + syft för repo, attach till release-tag |
| X20 | Storybook | ✅ | `.storybook/{main,preview}.ts` + stories för `AISidebarToolRow` / `AISidebarChatRow` |
| X21 | Playwright VR | ✅ | `electron-noter/tests/e2e/visual-regression.spec.js` med per-OS-snapshots och `NOTER_VR_UPDATE=1`-flagga |
| X22 | @noble/ciphers | ✅ | `nobleCrypto.ts` med `nobleEncryptV3` / `nobleDecryptV3` binär-kompatibel med `encryptV3` (lazy require) |
| X23 | graphql-codegen | ✅ | `codegen.ts` + plugin `trustedDocuments.cjs` som matar backend-allowlist; `npm run codegen` |

Verifierat: shared/ai/backend/web/mobile `tsc` rent · electron `node -c` OK · `@repo/ai` jest 14/14 gröna.

---

## Statusuppdatering (2026-05-14 batch 2)

Andra implementeringsrundan på samma branch:

| Punkt | Status | Detalj |
|-------|--------|--------|
| P0.1 AES-GCM v3 migration | ✅ | `packages/shared/src/cryptoMigration.ts` med `migrateCiphertextToV3` + batchad `migrateRecordsToV3` |
| P0.2 Argon2id-KDF | ✅ | `packages/shared/src/kdf.ts` med graceful fallback PBKDF2 om `argon2`/`hash-wasm` saknas; `keyBootstrap.ts` använder Argon2id default när tillgängligt; KEY_WRAP_VERSION = 2 |
| P0.3 Trusted documents | ✅ | `apps/backend/src/graphql/trustedDocuments.ts` middleware, hash-baserad allowlist, prod-only |
| P1.4 AISidebar dekomp | 🟡 | 4857 → 4606 rader (ToolRow + ChatRow extraherade). Mer kvar för ConversationList/MessageStream/ModelPicker |
| P1.5 Provider-native tools | ✅ | `apiProviders.ts` omskriven med OpenAI tools-API för OpenRouter+Gemini, returnerar `ApiProviderResponse` med `toolCalls` + `finishReason` |
| P1.6 MMKV mobile | ✅ | `apps/mobile/services/cache/mmkv.ts` scaffold med AsyncStorage-fallback |
| P1.7 Sliding rate-limit | ✅ | `slidingRateLimiter.ts` (rate-limiter-flexible) på `/api/auth/*` |
| P1.8 DataLoader | ✅ | `graphql/dataloaders.ts` per-request batchning för note/task |
| P1.9 Log-rotation | ✅ | `winston-daily-rotate-file` aktiverat med `LOG_MAX_SIZE` + `LOG_MAX_FILES` env-styrning |
| P1.10 GraphQL complexity | ✅ | Existerande `graphqlOperationLimitRule` har depth+complexity+fields |
| P2.11 autoUpdater + signing | ✅ | `electron-noter/src/autoUpdate.js`, `electron-updater@6`; signing-config i `package.json` (`publisherName`, `sha256`) + publish-block |
| P2.12 View Transitions | ✅ | `@view-transition { navigation: auto }` + custom `::view-transition-*` keyframes med reduced-motion |
| P2.13 motion/react LazyMotion | ✅ | `LazyMotionProvider` med `domAnimation` features + `reducedMotion="user"` |
| P2.14 Telemetri stop-reasons | ✅ | `useAIGenerationLoop`: dispatchar `noter:ai-loop-stop` med reason (no_tool_calls/max_iterations/duplicate_signature/mutation_boundary/user_aborted/provider_error) |
| P2.15 MCP intent classifier | ✅ | Word-boundary regex + negation-window-check |
| P2.16 Mongoose TTL | ✅ | `Note`/`Task` schema har `deletedAt` + partial TTL-index |
| P2.17 Nonce-CSP Electron | ✅ | `computeProdRendererCsp(nonce)`; CSP utan `unsafe-inline` style i prod |

Verifierat: shared/ai/backend/web/mobile `tsc` rent; electron `node -c` OK; `@repo/ai` jest 14/14 gröna.

---

## Statusuppdatering (2026-05-14)

| ID | Punkt | Status |
|----|-------|--------|
| §1.1 | `DEFAULT_KEY` borttagen, explicit init krävs | ✅ klar |
| §1.2 | AES-GCM v3-format finns parallellt med v1 (CryptoJS) | 🟡 pilot |
| §1.3 | Wrapped data-key bootstrap (web + mobil) | ✅ klar |
| §3 | GraphQL E2E: server kör inte längre encrypt/decrypt | ✅ klar |
| §4.1 | `+password` strippas via `omitSensitiveNoteFields` | ✅ klar |
| §4.2 | `authMiddleware` på `/api/ai/models/*` | ✅ klar (denna PR) |
| §5.3 | `createScopedEnv` för MCP-subprocesser | ✅ klar |
| §6.1–6.2 | Tool-call-parser konsoliderad i `@repo/ai/parser.ts` | ✅ klar (denna PR) |
| §7.1 | `toolSystemPrompt` flyttad till `@repo/ai/prompts.ts` | ✅ klar (denna PR) |
| §8 | Electron: CSP via `webRequest.onHeadersReceived`, IPC-allowlist, http-bridge allowlist, log-rotation | ✅ klar |
| §8.4 | safeStorage `basic_text`-fallback blockerad (Linux-säkerhet) | ✅ klar (denna PR) |
| §9.1 | `/app/api/ai/route.ts` auth + `resolveAllowedModelPath` | ✅ klar |
| §10.2 | Disk-utrymmes-check innan GGUF-download | ✅ klar (denna PR) |
| §10.4 | SecureStore `requireAuthentication` opt-in | ✅ klar (denna PR) |
| §11 | Firefox-extension: manifest+background+sidebar finns (+ CSP) | ✅ klar (CSP denna PR) |
| §12.1 | Log-rotation backend (winston-daily-rotate) | 🟡 backend `logs/`-skrivning klar, rotation kvarstår |
| §17 sprint 2 | Argon2id-migration från PBKDF2 | ⏳ kvar |
| §17 sprint 3 | DataLoader + GraphQL complexity-limit | 🟡 depth-limit finns, complexity kvarstår |

Den här filen är en **kritisk** granskning: den pekar ut defekter, inkonsistenser och konkreta förbättringar. Varje punkt anger *vad* som är problematiskt, *var* i koden det ligger (fil + radnummer där relevant), *varför* det är ett problem, och *hur* det bör lösas. Prioritet är satt i varje rubrik.

Relaterat dokument: `improvements.md` i repo-roten är en tidigare lista som överlappar punkter kring kryptering. Där så är möjligt pekar vi vidare dit istället för att duplicera — men alla kvarstående och nya observationer finns här.

---

## 0. Sammanfattning av allvarligaste fynden

| # | Klass | Rubrik | Prio |
|---|-------|--------|------|
| 1 | Kryptering | Hårdkodad `DEFAULT_KEY = 'noter-default-key'` används som legacy-fallback vid dekryptering och som aktiv nyckel om `setEncryptionKey` aldrig körs | P0 |
| 2 | Kryptering | CryptoJS AES-CBC utan MAC + `EVP_BytesToKey`/MD5 som KDF — ingen autentisering, svag nyckelhärledning | P0 |
| 3 | Arkitektur | GraphQL-schemat (`apps/backend/src/graphql/schema.ts`) dekrypterar *på servern* med delad nyckel — undergräver hela E2E-modellen | P0 |
| 4 | Key-management | Lokal 256-bit random-nyckel per enhet i localStorage/SecureStore *utan cross-device wrap* — multi-device-synk är tekniskt trasig för E2E | P0 |
| 5 | AI/Web | `POST /app/api/ai/route.ts` är **oautentiserad** och tar `modelPath` direkt från klienten → Node-Llama laddar godtyckliga lokala filer | P0 |
| 6 | API-yta | `/api/ai/models/*` är monterad *utan* `authMiddleware` i `apps/backend/src/index.ts:263` | P1 |
| 7 | Datautlämning | `findOwnedById(Note, …).select('+password').lean()` returnerar bcrypt-hash i `GET /api/notes/:id` | P1 |
| 8 | AI-harness | Tool-call-parser i `packages/ai/src/index.ts` använder `text.match(/\{[\s\S]*\}/)` — tar första `{…}` i hela svaret → felparserar | P1 |
| 9 | AI-harness | Tool-call-harnesset i webben (`AISidebar.tsx:1739–1790`) + mobilen är duplicerat, inte delat, och skiljer sig från `packages/ai` | P1 |
| 10 | Prompt-engineering | `toolSystemPrompt` (AISidebar.tsx:1634+) är en ~100 raders monolit i svenska blandat med engelska, inline-konstruerad vid varje request | P1 |
| 11 | MCP | Explicit-intent-check i `mcpRuntime.callTool` kan kringgås: `isExplicitServiceIntent` söker delsträng i användartext (`"gmail"`, `"kalender"`) men användaren kan ha nämnt det i helt annan kontext | P1 |
| 12 | Funktionalitet | `apps/firefox-extension/` innehåller bara `PROGRESS.md` — den implementation som dokumenteras existerar inte | P2 |
| 13 | Dokumentation | `Doc/`-mappen saknar index, har dubletter, felstavad "förbättraingar.md" i roten, datum i exempel (2026-03-*) är inkonsistenta | P2 |
| 14 | Observability | `console.error`/`console.log` i stället för `logger` i `packages/ai/*.ts` och web-kod; loggrotation saknas för `backend/combined.log` (checkas in i git) | P2 |

---

## 1. Kryptografi och nyckelhantering

### 1.1 P0 — Ta bort `DEFAULT_KEY`-fallback

**Var.** `noter-app/packages/shared/src/encrypt.ts:3` `const DEFAULT_KEY = 'noter-default-key'`.

**Problem.**
- `activeKey` initieras till `DEFAULT_KEY`. Om någon kodväg kör `encrypt()` *före* `setEncryptionKey()` (t.ex. SSR, bakgrundsarbete, test, tidig bootstrap), krypteras data med en **publik** nyckel som ligger i binären.
- `decryptWithSource` försöker dessutom alltid en **legacy-dekryptering med `DEFAULT_KEY`** om primär nyckel misslyckas (rad 52–58). Resultatet: allt som någon gång krypterats med default-nyckeln (avsiktligt eller av en bugg) kan dekrypteras av vem som helst som har källkoden.
- Servern (backend GraphQL-schema, se §3) använder samma `@repo/shared` utan att alls sätta en nyckel → default aktiv.

**Rekommendation.**
1. Låt `activeKey` vara `null` tills `setEncryptionKey` explicit körts. Kasta i `encrypt`/`decrypt` om nyckel saknas.
2. Ta bort legacy-DEFAULT_KEY-grenen helt. Ersätt legacy-migration med en engångs-bakåtkompatibilitetsflagga som *tas bort* efter ett release-fönster.
3. Lägg en "init gate" i alla klient-entryn: web i `StoreHydrator.tsx:14`, mobil i `services/startup.ts`, electron-renderer i renderer-entry. Blockera UI tills `initWebEncryptionKey`/`initLocalEncryptionKey` rört sig klart.

### 1.2 P0 — AES-GCM i stället för CryptoJS AES-CBC

Se även `improvements.md` i roten (§1.1). Kompletterande observationer:

- `isEncryptedPayload()` (`apps/backend/src/utils/encryption.ts`) accepterar prefixen `U2FsdGVkX1`, `noter:v1:`, `noter:v2:`. Men det finns ingen fil med "v1"/"v2" någonstans i koden — bara prefixet förväntas. Detta är ett svart hål där en klient kan skicka "noter:v2:\<valfri-payload-≥16-tecken\>" och få det godtaget som "krypterat".
- `decryptWithSource` använder en heuristisk `scoreDecryptedText` för att välja mellan aktiv och legacy nyckel. Denna heuristik är exploaterbar: ett AES-CBC-ciphertext dekrypteras *alltid* till *något* (PKCS#7-padding ger ~1/256 sannolikhet för slumpmässigt pass). Den verkligt säkra signalen saknas: AEAD (GCM) misslyckas om autentisering inte stämmer.

**Åtgärd.** Migrera till AES-256-GCM med formatet `noter:v3:<base64-iv-12B>:<base64-ciphertext+tag>`. Implementera i `packages/shared` med WebCrypto i web/node/electron och `react-native-quick-crypto` eller `expo-crypto` i RN. Bakgrundsmigration: läs gammalt, dekryptera, skriv nytt med ny KDF.

### 1.3 P0 — Cross-device E2E-nyckel saknas helt

**Var.** `apps/web/services/encryptionKey.ts:31` + `apps/mobile/services/encryptionKey.ts:20`.

**Problem.** Klienten genererar slumpmässig 256-bit hex-nyckel **lokalt**. Nyckeln synkas aldrig. Alltså:

1. Ny enhet = ny nyckel = allt gammalt innehåll från backend är oläsbart.
2. Delad not mellan enheter eller `/api/auth/refresh` från annan session går inte att dekryptera.
3. `GraphQL`-vägen försöker dekryptera serverside men har inte ens klientens nyckel (se §3).

**Rekommendation.** Flytta till en lösenordsbaserad KDF med server-sida nyckel-wrap:

- Vid registrering: klient deriverar `rootKey = Argon2id(password, salt)`. Genererar ny `dataKey` (random 32B). Krypterar `dataKey` med `rootKey` → `wrappedKey`. Skickar `wrappedKey` + `salt` till servern.
- Vid login: klient hämtar `wrappedKey`, deriverar `rootKey`, unwrap → `dataKey`. Allt innehåll krypteras med `dataKey`.
- Vid password-byte: re-wrap `dataKey` med ny `rootKey`. Ingen re-kryptering av innehåll behövs.
- Backend ser *aldrig* `rootKey` eller `dataKey`.

Detta löser multi-device, recovery (via recovery-code som wrap), och gör E2E verklig.

### 1.4 P1 — Per-fält-saltning saknas

Eftersom varje krypterad sträng använder samma nyckel + öppet salt från CryptoJS, är två lika klartexter lika chiffertexter → **leak via frekvensanalys**. Kan användas av en angripare med DB-åtkomst för att slå ihop användare som har identiska titlar ("Inbox"), identiska tags osv.

**Åtgärd.** GCM med slumpmässig IV per fält löser detta. Se §1.2.

---

## 2. Autentisering, sessioner, cookies

### 2.1 P1 — Demo-token är globalt aktiverad via env, utan skopning

**Var.** `apps/backend/src/middleware/authMiddleware.ts:103`, `apps/backend/src/index.ts:158–166`, `apps/backend/src/utils/security.ts:82`.

Om `ALLOW_DEMO_TOKEN=true` i env → *vem som helst* som skickar `Authorization: Bearer demo-token` blir `demo-user-id` och har läs/skriv på demo-användarens data. Det finns inget miljövillkor (utveckling-only), inget IP-skydd, inget whitelist.

**Åtgärd.** Tvinga `ALLOW_DEMO_TOKEN` till att bara fungera när `NODE_ENV !== 'production'`. Lägg en startup-assertion. Logga tydligt. Bäst: ta bort helt och använd en lokal dev-seed i stället.

### 2.2 P1 — JWT-fingerprint-bindning är okänslig mot X-Forwarded-For-spoofing

**Var.** `apps/backend/src/utils/authSessions.ts:13`: `getRequestIp` läser första IP:n i `X-Forwarded-For`. `app.set('trust proxy', 1)` är korrekt för ett proxy-lager men oskyddat om deployen sitter bakom fler (t.ex. Cloudflare → nginx → app).

**Åtgärd.** Konfigurera `trust proxy` enligt faktisk topologi (antal proxies eller IP-lista). Dokumentera i `Electron & Mobile Build Readiness Runbook.md`.

### 2.3 P1 — `refresh`-flöde revokerar familj men lämnar kortlivad access-token giltig

Access-token (15 min default) verifieras enbart signaturmässigt. Om en refresh-familj revokeras pga misstanke (UA/IP-mismatch), fortsätter access-token att fungera tills utgång. Det finns ingen revoke-lista för JWT.

**Åtgärd.** Lägg in en per-user `tokenVersion` i User-dokumentet. Tokenen bär `tokenVersion`-claim. Bumpas vid logout/compromise → `authMiddleware` jämför mot DB eller Redis. Cacha `tokenVersion` i Redis för 1–5s för att undvika DB-hit per request.

### 2.4 P2 — Cookies `sameSite: 'lax'` är OK men `Secure` är bunden till `NODE_ENV === 'production'`

I utveckling över HTTPS (t.ex. `https://localhost`) blir cookien icke-secure. Det är harmlöst i dev men inkonsekvent när Electron kör produktionsbuild lokalt med `NODE_ENV=production` — `secure:true` + HTTP = cookien skickas inte.

**Åtgärd.** Bestäm `secure` baserat på request-schema eller `X-Forwarded-Proto`, inte `NODE_ENV`.

---

## 3. GraphQL — P0: undergräver E2E-modellen

**Var.** `apps/backend/src/graphql/schema.ts` (hela filen).

**Problem.**
- `toNote()` / `toTask()` kör `decryptText(note.title)` **på servern**.
- `createNote`/`updateNote`-mutations tar in plaintext och kör `encryptText(...)` **på servern**.
- Tom `decryptText` i rad 10 gör `const decrypted = decrypt(value); return decrypted || value;` — om decrypt returnerar `''` (failed), läcker *chiffertexten* tillbaka till klienten.
- Servern har ingen annan nyckel än `DEFAULT_KEY` (§1.1). Så antingen:
  - Servern kan faktiskt dekryptera allt (= E2E är teater), eller
  - `decrypt()` returnerar `''`, `|| value` returnerar ciphertext som "title" → klienten får oförståeligt innehåll och loggar det antagligen vidare.

Antingen är E2E-retoriken i `Doc/Overview.md` fel, eller så är GraphQL-vägen en bugg.

**Rekommendation.**
1. Bestäm arkitektur. Om E2E: ta bort all kryptering/dekryptering från servern. GraphQL bör returnera chiffertextfälten råa precis som REST-vägen gör (`apps/backend/src/routes/notes.ts:175`). Låt klienten decrypt:a.
2. Om *inte* E2E: ta bort `encrypt`-indirektionen från klienten också, lagra plaintext, kryptera på transport (TLS) och at-rest i DB (MongoDB CSFLE). Ingen mellanväg.
3. Introspection blockeras bara i produktion (`apps/backend/src/index.ts:268`) och baseras på substring-match `'__schema'`/`'__type'` — robusta verktyg kan obfuskera. Använd `graphql-disable-introspection` eller `NoSchemaIntrospectionCustomRule`.
4. Ingen mutationsquota/complexity limit i schemat: en query kan rekursera djupt via `notes(parentId)` och trigga O(N) DB-hits. Lägg `graphql-depth-limit`, `graphql-query-complexity`, och DataLoader för `notes`-resolver.

---

## 4. Backend REST-routes

### 4.1 P1 — `GET /api/notes/:id` läcker bcrypt-hashen

**Var.** `apps/backend/src/routes/notes.ts:209`.

```ts
const note = await findOwnedById(Note, userId, noteId).select('+password').lean().exec();
…
res.json(note);
```

`password` på `Note` är `select: false` i schemat precis för att undvika detta, men `+password` inkluderar det. Klienten behöver aldrig se hashen. Returnera `omit(note, 'password')`.

### 4.2 P1 — `/api/ai/models/*` saknar `authMiddleware`

**Var.** `apps/backend/src/index.ts:263`.

Oauthat. Innebär:
- Vem som helst kan söka Huggingface via backend (SSRF-proxy).
- `POST /api/ai/models/convert` startar GGUF→MLC-konvertering (diskutrymme, CPU, nätverk).
- `GET /api/ai/models/compiled?autoCreate=1` kan trigga godtyckliga konverteringsjobb från externa IP.

Fler subtila problem:
- `conversionService.createConversionJob` (rad 182) kör jobbet i bakgrunden utan concurrency-tak och utan per-IP-budget. Trivial DoS.
- `runExternalConversion` (rad 148) trustar `outputUrl` från konverteringstjänsten och "vidarebefordrar" utan att validera schema/värd.

**Åtgärd.** Lägg `authMiddleware` + per-user quota (max 2 samtidiga jobb, max 10 jobb per dygn). Validera `outputUrl` mot en allowlist. Tänk om hela endpointen ska vara public alls — troligen inte.

### 4.3 P1 — `sendFile(zipPath)` utan content-disposition/content-length headers

**Var.** `apps/backend/src/routes/aiModels.ts:133`. `res.sendFile(zipPath)` fungerar men:
- Ingen `Cache-Control`, ingen `ETag` styrning → upprepade MB-nedladdningar.
- Path traversal: `getZipPath(modelId, platform, quant)` måste verifieras — om `modelId` tillåts innehålla `../`, kan en angripare servera filer utanför modellmappen. Lägg `path.resolve` + `startsWith(baseDir)` invariant.

### 4.4 P2 — `verify-lock`-endpoint jämför med bcrypt men serverar klartext-fält

**Var.** `apps/backend/src/routes/notes.ts:282`.

```ts
res.json({ success: true, content: targetNote.content, title: targetNote.title, … });
```

`content`/`title` är krypterade strängar — att servern returnerar dem efter en server-side lösenordskontroll är inte farligt i sig men är inkonsekvent med övriga GET-vägar (som ju också redan returnerar dem). Problemet ligger i lock-modellen: servern ska inte auktorisera åtkomst till E2E-krypterat innehåll via ett server-sida bcrypt-pass. Det är en *UX*-spärr, inte en *säkerhets*-spärr. Gör det tydligt i koden genom att byta namn till `confirmUnlockUI` eller liknande och ta bort `content`/`title` från svaret helt. Klienten har redan data.

### 4.5 P2 — Batchade `bulkWrite` för reorder-paths validerar inte att _alla_ id:n tillhör användaren

**Var.** `apps/backend/src/routes/notes.ts:333` + `tasks.ts:188`.

Filtret `{ _id: ObjectId, userId }` på varje `updateOne` är korrekt — men felreturen är tystad. Om 50 av 1000 id:n tillhör annan användare: `bulkWrite` returnerar bara `{ matchedCount: 950 }`. Svarskoden är 200 utan varning. Logga och returnera en varning med antal matched/attempted.

### 4.6 P1 — AI-sync-push har ingen storleksbegränsning eller per-user-kvot

**Var.** `apps/backend/src/routes/aiSync.ts:106`. `express.json({ limit: '1mb' })` globalt — men en användare kan göra 1000 `/push` per rate-limit-fönster (rate = 100/15min globalt, men ingen *storlek* per konto) och upsert:a `AIMessageSync` i mängder.

**Åtgärd.** `AIMessageSync.countDocuments({ userId })` > N → 429. Lägg TTL-index på meddelanden äldre än X månader. Dokumentera retention i `AI Platform Security & Stability Review.md`.

---

## 5. MCP-runtime (`apps/backend/src/services/mcp/runtime.ts`)

### 5.1 P1 — `isExplicitServiceIntent` är en substring-match

**Var.** `apps/backend/src/services/mcp/runtime.ts:466`.

Keyword-listan är `['gmail', 'drive', 'kalender', …]`. En prompt som "jag gillar inte gmail" räknas som explicit intent att använda Google Workspace. En angripare som kan påverka tidigare meddelanden i en konversation (prompt-injection från en extern källa som AI:n läste) kan trigga MCP-calls.

**Åtgärd.**
- Kör en intent-klassificerare (local small model eller enkelt regex på hela *senaste* user-message, inte hela kontexten).
- Kräv att explicit intent uttrycks i **sista** user-turn, inte i assistent/tool-svar.
- Logga alltid `intentText` vid `call_tool_blocked`/`call_tool` i auditspåret (idag sparas den inte, bara `message: 'explicit tjänsteintention saknas'`).

### 5.2 P1 — `stableHash(config)` läcker hemligheter i sessionsnyckel-identifier

Även om `stableHash` är SHA-256 → endast i minne, är `configHash` synlig i `dashboardData.sessions` som returneras av `GET /api/mcp/health`. Den är inte klartext men möjliggör för en angripare att veta *när* en användares token ändras (hashen ändras → ny session).

**Åtgärd.** Maska `configHash` i publika responser (`X'xxxxxxxx…'` eller bara räkna antal konfigurationer). Lägg det bakom `includeAudit`.

### 5.3 P1 — MCP-subprocesser startas med `env: { ...process.env, ...config.env }`

**Var.** `apps/backend/src/services/mcp/runtime.ts:438`.

Hela backendprocessens env läcker till MCP-processer (`npx -y @…`). Det innebär `JWT_SECRET`, `MONGO_URI`, `MCP_AUDIT_MASTER_KEY`, Redis-URL med lösenord etc. Ett kompromissat MCP-paket (supply chain) får fullständig krypto-åtkomst.

**Åtgärd.** Starta processer med *minimal* env: bara PATH, HOME, lokal LOCALE, plus config-spec:ade nycklar. Använd en `createScopedEnv(config.env)`-hjälpare.

### 5.4 P2 — `cleanupIdleSessions` med 20s-intervall och `SESSION_IDLE_TTL_MS=3min`

Timer kör även i tester om inte `reset()` anropas. `setInterval(...).unref()` är ok men testharnesset kan plocka upp hängande timers. Dokumentera i `Security Regression Suite.md` att `mcpRuntimeInternals.reset()` ska anropas i `afterEach`.

### 5.5 P2 — Allowlist är wildcard-baserad men utan ankare för `slack.*` vs `slack`

`wildcardMatch` konverterar `*` → `.*` utan att fragmentera. Ok för positiva matchningar, men `slack` (ingen prick, ingen stjärna) tillåts inte av `'slack.*'`. Bra. Men `read*` matchar `readhelp` lika gärna som `read_file`. Lägg till obligatorisk separator i mönster (`_*`, `.*`).

### 5.6 P1 — Ingen graceful hantering av MCP-processer som skriver stora volymer på stdout

`onData` concatenerar `session.buffer += chunk.toString('utf8')`. En dåligt beteende MCP-process kan spy:a 100 MB utan newline → minnesläckan skalar tills OOM.

**Åtgärd.** `if (session.buffer.length > 512 * 1024) closeSession(session)` och markera failure.

---

## 6. AI-paket (`packages/ai`)

### 6.1 P1 — Tool-call-parsern är rudimentär

**Var.** `packages/ai/src/index.ts:105–118`.

```ts
const match = text.match(/\{[\s\S]*\}/);
if (match) {
  const data = JSON.parse(match[0]);
  if (data.tool && data.arguments) return data;
}
```

Problem:
- Greedy regex tar *hela* span från första `{` till sista `}`. Om modellen skriver "Jag skapar en note `{title}`. Kör: `{ \"tool\": ... }`", blir `match[0]` den största inramningen, troligen inte parsbar JSON.
- Ignorerar markdown-kodblock, flera calls i samma svar, och escaped JSON.
- `data.tool && data.arguments` tillåter inte tools utan argument.
- Felar tyst via `catch {}` → svårt att debugga.

**Rekommendation.** Extrahera i denna ordning: (1) strukturerade tool-calls om provider stödjer det (OpenRouter, Gemini); (2) `\`\`\`json … \`\`\`` kodblock; (3) `{"tool":…}` JSON-per-rad. Ha en enkel deterministisk tokenizer som följer den implementering som redan finns i `apps/web/components/AISidebar.tsx:1739` — men flytta den till `packages/ai/src/parser.ts` så den delas.

### 6.2 P1 — Harnesset i `packages/ai/src/index.ts` är inte använt av någon klient

Både webb- (`AISidebar.tsx:1739–1790` + `services/ai/toolChain.ts`) och mobilklienten (`services/ai/toolChain.ts`) har duplicerade parsers. Paketets `AIAgent`-klass används bara av `apps/web/app/api/ai/route.ts` indirekt.

**Åtgärd.** Konsolidera all tool-call-logik i paketet:

```
packages/ai/src/
  agent.ts        # runIterationLoop (delar: stopReason, anti-loop, caps)
  parser.ts       # extractToolCalls (json-block + inline + jsonl)
  prompts.ts      # toolSystemPrompt, combineSystemPrompts
  providers/
    openrouter.ts
    gemini.ts
    llama.ts
    nodeLlamaCpp.ts
    mlcNative.ts  # bridge för RN
```

Låt web/mobile importera `runIteration` i stället för varsin kopia.

### 6.3 P1 — `MCPClient` (`packages/ai/src/mcp.ts`) använder fel JSON-RPC-metoder

**Var.** `packages/ai/src/mcp.ts:15`, `29`.

Metoderna heter `listTools`/`callTool`. MCP-specifikationen använder `tools/list` och `tools/call` — vilket backenden faktiskt kör i `runtime.ts:619` och `:678`. Denna klientklass är alltså inkompatibel med riktiga MCP-servrar. Antagligen död kod; ta bort eller fixa.

### 6.4 P1 — `HuggingFaceService` har inga backoffs, timeouts eller auth

**Var.** `packages/ai/src/hf.ts`.

- Ingen `AbortController`-timeout. Kan hänga en RN-tråd om mobilnätet försvinner.
- `console.log` och `console.error` i stället för en injicerad logger.
- Ingen paginering. `&limit=20` är hårdkodat.
- `getModelFiles` hanterar två olika svarformer — men dokumentet där detta beskrivs ("HF API can vary") tyder på att koden inte förstår API-kontraktet. Fastställ och välj ett format (`/tree/main?recursive=true`).
- Body-size-attack möjligt: svaret parsas direkt till JSON utan cap.

### 6.5 P2 — `parseGGUF` cachear inget och slår externt API varje anrop

För CI och mobilappens återkommande bootstrap: cacha metadata i SQLite/IndexedDB per `modelId@sha`.

### 6.6 P2 — `security.ts` tar bara hand om "blocking locked ancestor"

Bra för lock-UI, men semantiken saknar root-projekt-ownership. Eftersom detta paket är delat mellan mobil/web, lägg också in:

- `canUserRead(note, userId, unlockedIds)`
- `canUserWrite(note, userId, unlockedIds)`

…så att roller kan utökas i framtiden utan att varje klient omimplementerar det.

---

## 7. AI-prompter, instruktioner och harness

### 7.1 P1 — `toolSystemPrompt` är en monolit inline i `AISidebar.tsx`

**Var.** `apps/web/components/AISidebar.tsx:1634–1738`. Ca 100 rader tool-instruktioner i en array som joinas med `\n`.

Problem:
- **Ligger i UI-fil.** Ingen annan klient återanvänder den → mobilen har *annan* prompt (kolla `apps/mobile/services/ai/prompt.ts`) → modellerna beter sig olika beroende på plattform.
- **Blandar svenska och engelska**: "discover -> select -> create/update -> verify -> explain", "anti-loop", "Matcha titlar case-insensitivt". Mindre svenska-starka modeller kan misstolka.
- **Injektar Base URL och datum/tid direkt i prompten**. Detta är *kontextdata*, inte *policy*. Böra skickas som separat `system`-meddelande eller tools (`get_current_time`).
- **Hög ryktesdensitet**: ~50 regler, varav flera överlappar ("Kör inte samma tool call mer än en gång", "Anti-loop: upprepa inte samma discover/select/create/update steg"). Modellen tappar fokus.
- **Token-förbrukning**: cirka 1200 tokens bara i systemprompten. Med 8k-kontextmodell äter den 15 % innan user-meddelandet.

**Rekommendation.**

1. Flytta till `packages/ai/src/prompts/` som typsäkra byggblock:
   - `basePolicy()` — säkerhetsregler (read-only vs full, MCP explicit-intent).
   - `toolContract()` — JSON-format, exempel.
   - `toolCatalog()` — dynamiskt enligt aktiverade verktyg/MCP.
   - `phraseHints()` — exempelfraser.
   - `sessionContext({ baseUrl, nowIso, locale, enabledMcpServices })` — struktur-kontext.
2. En enda språk-policy. Generera svensk eller engelsk variant baserat på `i18n.locale`. Inte båda blandat.
3. Klipp innehåll som inte bidrar. Borja med minsta version och mät tool-call-framgångsrad (se §7.5).
4. För mindre modeller: komprimera prompten med few-shot-exempel i stället för regellista. Modeller under 8B följer exempel bättre än regler.

### 7.2 P1 — `buildHistory` trimmar på teckenantal, inte tokens

**Var.** `AISidebar.tsx:1213`. `const maxChars = 12000;`. 12 000 tecken är grovt ~3 000 tokens i svenska, men kan vara mycket mer i asiatiska språk, kod eller formler. Trunkering kan ske mitt i ett tool-result JSON.

**Åtgärd.** Använd `@huggingface/gguf` eller en tokenizer-library som `gpt-tokenizer` (OpenAI-kompatibel approximation) — eller den native-tokenizer som node-llama-cpp ger — för att räkna tokens. Trimma i message-granularity, inte char-granularity.

### 7.3 P1 — Harnessen har ingen explicit stop-reason

**Var.** `apps/web/components/ai-sidebar/useAIGenerationLoop.ts:54–124`.

Stop-villkor är implicita: `maxIterations=5`, `shouldStopToolIteration`, eller `calls.some((call) => /^(create|update|delete)_/.test(call.tool))` efter mutation. Men:
- Ingen telemetri om *varför* loopen stoppades.
- Mutations-stoppet är för aggressivt: "efter *första* create_task stoppas loopen", även om modellen logiskt borde fortsätta med en `verify` via `get_task`.
- `catch` gör `await new Promise(…300ms); await tryFetch();` — bara *ett* försök. Inget exponentiellt backoff, ingen circuit-breaker för providern.

**Åtgärd.**

```ts
type StopReason =
  | 'no_tool_calls'
  | 'max_iterations'
  | 'duplicate_signature'
  | 'mutation_boundary'
  | 'user_aborted'
  | 'provider_error'
  | 'content_policy';
```

Rapportera i audit-event. Flagga upp i UI som "AI stoppade för att: X".

### 7.4 P1 — `processToolCalls` kör sekventiellt, inte parallellt

För idempotenta läsoperationer (`list_notes` + `list_tasklists` + `list_projects`) finns ingen anledning att blockera. Modellen kan returnera en JSON-array av calls; harnesset bör köra dessa `Promise.all` (med max parallelism).

### 7.5 P1 — Ingen mätning av verktygsframgång

Det finns ingen klient-side- eller backend-side-telemetri för:
- Andel assistent-turns som genererar tool-calls.
- Andel tool-calls som faller för parser.
- Andel tool-calls som backenden avvisar (tool_not_found, schema_mismatch).
- Andel loopar som avslutas med `mutation_boundary` vs `no_tool_calls`.

Utan den datan är det omöjligt att förbättra prompten.

**Åtgärd.**
- Lägg telemetri i `perfMetrics.ts` (Electron har redan grundinfra) och i mobilens motsvarighet.
- Backend-sida: `services/mcp/auditStore.ts` — utöka även för lokala tools (`list_notes` etc.) som idag inte loggas.

### 7.6 P2 — Prompt-profiler har kosmetiska olikheter

**Var.** `packages/shared/src/aiAssistant.ts:4–25`.

Profilerna `balanced/research/execution/concise` skiljer sig med ~1 mening i svenska prosa. Mät först om de ger mätbart olika beteende — annars slår ihop till två (t.ex. `concise` vs `thorough`) och dokumentera skillnaden.

### 7.7 P2 — Tool-output-formatering är inkonsistent

I `toolChain.ts` och `processToolCalls` formateras tool-resultatet som `JSON.stringify(result)` och stoppas in som `role: 'tool'`. Men `toOpenRouterMessages` (apiProviders.ts:6) byter ut `role: 'tool'` mot `role: 'assistant'`:

```ts
role: message.role === 'tool' ? 'assistant' : message.role,
```

Det innebär:
- OpenRouter-modellen ser inte att det är ett tool-svar. Den kan börja "svara" som assistent-text, vilket förvirrar.
- Gemini-mapningen (`toGeminiContents`) skickar `role: 'assistant'` → `'model'`, så tool-meddelanden blir också "model". Samma problem.

**Åtgärd.** Använd provider-native tool-format:
- OpenRouter/OpenAI: `role: 'tool'` + `tool_call_id`. Funktionen finns (`toolCallId` i `ChatMessage`) men skickas inte.
- Gemini: `role: 'user'` med `functionResponse`-parts.
- Lokal Llama: inbäddad tool-markup.

---

## 8. Elektron- och webbklienten

### 8.1 P1 — `http:request` IPC-bridge är en generisk proxy

**Var.** `electron-noter/main.js:756`.

Renderern kan via `mlc.httpRequest({ url, method, headers, body })` skicka godtyckliga http(s)-requests från main-processen → **bypassar CORS**, **bypassar cookie-same-origin**, och fungerar som SSRF-proxy från användarens maskin. Den inga-auth versionen är i princip ett inbyggt `curl`.

**Åtgärd.**
- Allowlist-URL:er (backendens API-bas + HF + OpenRouter + Gemini).
- Avisa `file:`/`data:`-schema (görs redan för `isSafeExternalUrl`, men kontrollen sker före header-sanitering — bra).
- Sätt `credentials: 'omit'` och avkräva att renderern inte skickar `Cookie`/`Authorization` via IPC:n förutom för backendens domän.
- Ta bort helt om funktionen bara används för HF och konvertering — ersätt med dedikerade IPC:er `ai:searchHuggingface`, `ai:fetchCompiledModel`.

### 8.2 P1 — Ingen CSP på renderern

`BrowserWindow.webPreferences` har `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true` — bra. Men:
- Ingen `Content-Security-Policy` response-header från main-processen eller `session.defaultSession.webRequest.onHeadersReceived`.
- Renderern laddar bl.a. `http://localhost:3001/` i dev → vilket kan ha egna CSP-regler.
- Electron 33+ har strikt CSP-default men det syns inte konfigureras.

**Åtgärd.** Lägg en `onHeadersReceived` som tvingar:

```
default-src 'self';
connect-src 'self' http://127.0.0.1:* https://api.openrouter.ai https://huggingface.co https://generativelanguage.googleapis.com;
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;
```

Dokumentera i `App AI.md`.

### 8.3 P2 — Fallback-HTML i `loadErrorFallback` saknar CSP

Inline `<style>` och visad text i svenska med hela HTML:en URI-encoded. OK i dev, men om du senare lägger in klick-länkar eller JS (t.ex. "försök igen"-knapp) blir det en XSS-yta. Begränsa till statisk HTML + CSP.

### 8.4 P1 — Settings-filen roterar ingen nyckel

**Var.** `electron-noter/main.js:113`. `getLocalSettingsKey` läser/skapar `settings.key`. Nyckelrotation saknas helt.

**Åtgärd.** Lägg ett `version`-fält på nyckeln. Vid nyckelrotation: dekryptera med gammal, kryptera med ny, skriv `keyVersion: N` i `settings.json`.

### 8.5 P2 — `settingsFlushTimer` är 120 ms

OK för responsivitet, men om appen kraschar mellan enqueue och flush förlorar användaren inställningar. Lägg till en `beforeunload`-handler i renderern som kör en explicit flush via IPC.

### 8.6 P2 — Ingen auto-update-konfiguration

`electron-builder` finns i `package.json` men renderaren visar inte releases, och `Open Source Release Guide.md` beskriver inte signering/notarisering för macOS. Lägg till `autoUpdater`-integration med signerad release-channel.

---

## 9. Web-klienten (Next.js)

### 9.1 P0 — `POST /app/api/ai/route.ts` är oautentiserad + tar `modelPath` från body

**Var.** `apps/web/app/api/ai/route.ts:16–20`.

Route verifierar inte sessionen. `modelPath` skickas direkt till `node-llama-cpp:LlamaModel({ modelPath })`. Följder:
1. Godtycklig serveränd kan öppna `/etc/passwd` (eller vilken fil som helst som Next.js-processen har läsrätt på) som LLM-vikt. Det failar troligen, men kan leaka filexistens via felmeddelandet (`Model file not found at …`).
2. Ingen `fs.realpath`-kontroll — path traversal via symlinks möjligt.
3. Model loading singleton är inte per-user — två användare på samma server delar instans.

**Åtgärd.**
- Lägg `getServerSession`-kontroll eller ta bort endpointen helt och kör modellen i Electron istället. Den här API-routen är ett orosmoment i en multi-tenant/prod-deployment.
- Validera `modelPath` mot en modell-katalog uppåt (`/var/lib/noter/models/**` + `realpath`-check).

### 9.2 P1 — `AISidebar.tsx` är 4857 rader

En enda komponent med >70 hooks. Omöjlig att underhålla, oåtkomlig för ny utvecklare, och sannolik källa till React re-render-baserad prestandaförlust.

**Åtgärd.** Del upp i dedikerade komponenter:
- `AIConversationList`
- `AIMessageStream`
- `AIToolTrace` (använder redan `buildToolReadTrace`)
- `AIPromptPanel` (finns redan som `AISidebarPromptPanel.tsx`)
- `AIModelPicker`
- `AIMcpStatusBadge`

Extrahera tool-call-flödet till `packages/ai` (se §6.2). Skapa en store per sidebar-state (zustand med reduxdevtools).

### 9.3 P1 — `encrypt()` loggas ibland (`persistStoredValue`-anrop)

**Var.** Flera ställen där `persistStoredValue(key, encrypt(value), maxLen)` passerar chiffertext via `console.error` i catch-blocken. Se `AISidebar.tsx` — sökningar efter `console.error(e);` hittar ~12 ställen inom filen. Chiffertext är inte hemlig, men `e` kan innehålla stora objekt/HTTP-svar.

**Åtgärd.** Central logger i browsern med nivåstyrning + scrubbing. `import { logger } from '@repo/shared/logger'`; har inte skapats än.

### 9.4 P2 — `initDB`-schema ökar inte versionen när `aiConversationSync`-fält ändras

`db.ts:34` `DB_VERSION = 3`. Senare bytes i fältnamnen (t.ex. `toolCallsEnc`) utlöser inte migration. Lägg `DB_VERSION = 4` + migration-block när modeller ändras.

### 9.5 P2 — `graphql`-anrop går förbi `apps/web/services/api.ts`

AISidebar bygger egen fetch i `graphQLRequest` i stället för att dela API-klienten. Om `api.ts` lägger till något (tokenrefresh, retry, request-id) missar AI-flödet det.

---

## 10. Mobilklienten

### 10.1 P1 — `modelService.ts` pollar `getConversionStatus` med 1.5–5s delay, max 120 försök

**Var.** `apps/mobile/services/ai/modelService.ts:334`.

Det är ~8 minuters maxtid. Under den här pollen hanterar inte klienten:
- Nätverksbyte (wifi → 4G) — polling fortsätter men access-token kan ha gått ut.
- Backgrounding → iOS-tråden drödas bort.

**Åtgärd.** Använd `socket.io`-eventet `ai:conversion-progress` (finns inte än) eller exponential-backoff med max-total 20 min. Dokumentera.

### 10.2 P1 — `tryLocalConversion` skriver GGUF till `DocumentDirectoryPath` utan diskutrymmeskontroll

Fylla upp diskutrymmet kan krascha appen och göra andra användardata oåtkomlig. Kontrollera `RNFS.getFSInfo()` mot filstorlek före nedladdning; avbryt tidigt.

### 10.3 P2 — Lokalkonvertering på iPhone saknas

`getLocalConversionCapabilities().converterAvailable` är alltid `false` på iOS enligt native-modulen. Det är OK men mobilens flöde försöker ändå starta `tryLocalConversion` (rad 277) om användaren aktiverade `preferLocalConversion`. Lägg tydligt UI-spärr.

### 10.4 P2 — `expo-secure-store` används, men nyckelhantering är fortfarande en "single-blob"

Det finns utrymme att lagra per-app-enclave-nyckel via `EXPO_SECURE_STORE_ACCESSIBLE_WHEN_UNLOCKED`. Nuvarande `SecureStore.getItemAsync` saknar `requireAuthentication`-flag. Biometrisk gate skulle skydda nyckel vid förlorad enhet.

### 10.5 P2 — Socket-anslutningens autostart

`apps/mobile/services/socket.ts` (antagligen) skapar en socket vid app-mount. Se till att den städas vid logout — och inte fortsätter skicka `note:join` med gammalt `userId`.

---

## 11. Firefox-extension

**Var.** `noter-app/apps/firefox-extension/` innehåller bara `PROGRESS.md`.

Dokumentet listar "klara funktioner" (sidebar, context-menu, hotkeys, clipboard save). Det finns ingen kod. Antingen är dokumentet osant eller så ligger koden på fel plats.

**Åtgärd.** Bestäm status. Om den ska byggas: skapa `manifest.json`, `sidebar.html`, `background.js`, `content.js` som dokumentet beskriver. Om inte: flytta PROGRESS.md till `/Doc/` med ett tydligt "`DRAFT: inte implementerat`"-banner.

---

## 12. Observability, logg och DevOps

### 12.1 P1 — `combined.log`/`error.log` in-checked

`git status` visar modifierade `noter-app/apps/backend/combined.log` och `error.log`. `.gitignore` stoppar dem inte.

**Åtgärd.** Lägg till i `apps/backend/.gitignore`: `combined.log`, `error.log`, `*.log`. Eller flytta loggar till `/var/log/noter` och i tester till `tmp/`.

### 12.2 P1 — Winston saknar rotation

Ingen `winston-daily-rotate-file`. Produktion kan fylla disk.

### 12.3 P2 — Inga metrics-endpoints

Hälsaendpoints finns men ingen `/metrics` Prometheus-yta. Ops saknar synlighet.

**Åtgärd.** `prom-client` + `mcp_audit_total`, `ai_tool_call_total{result=ok|error|not_found}`, `auth_refresh_rotations_total`.

### 12.4 P2 — `errorMiddleware` läcker stack i non-production

`errorMiddleware.ts:18` skickar `err.stack` när `NODE_ENV !== 'production'`. OK i dev. Men många distribuerar med `NODE_ENV=development` — lägg till andra signal (t.ex. `EXPOSE_STACK_TRACES=true`). Verifiera att produktionsdeploy har `NODE_ENV=production` explicit.

### 12.5 P2 — `logger.info('MONGO_URI not set, running without database connection')`

Hellre `logger.warn`. Det ska stå ut i logs.

---

## 13. Testtäckning

- Backend har `__tests__`, `jest.setup.ts` — bra.
- Electron har `playwright.config.js` + `tests/` — bra.
- `apps/web/cypress/`, `apps/mobile/tests/` — bra.
- `packages/ai/src/__tests__/` — finns men tunn. Eftersom §6.1–6.3 är buggyta, bör paketet ha:
  - Parser-tester med fixtures för varje känd LLM-output-form.
  - `AIAgent.process()`-kontraktstest med en fake provider.
  - `MCPClient`-integrationstester mot en stub MCP-server.

Mät faktisk coverage med `jest --coverage` + `turbo run test --filter=...` i CI och publicera som badge.

---

## 14. Build, dependency och supply-chain

- `scripts/` i roten + `noter-app/scripts/` — dokumentera i `Open Source Release Guide.md` vilken som är sanningskällan.
- Lägg `npm audit --audit-level=high` och `osv-scanner` som obligatorisk gate i GitHub Actions.
- `dependabot` är enligt git-log aktiverad ("Add supply-chain audit script and dependabot coverage"), bra.
- Lås `@huggingface/gguf`, `node-llama-cpp`, `archiver` med `npm shrinkwrap` eller `package-lock.json` som commit. (Lock-filerna syns ligga i repo, bra.)
- `react-icons-compat.d.ts` i `apps/web/` tyder på typ-hack. Lös grundorsaken (versionsbrist) och ta bort shimmen.

---

## 15. Funktionella luckor

1. **Recovery-flöde**. Om användaren glömmer lösenordet: ingen väg tillbaka utan att förlora E2E-data. Lägg "recovery code" som wrap:ar `dataKey` (§1.3).
2. **Export/import**. `turndown`, `jsPDF` finns, men ingen "export all encrypted" för backup. Viktigt eftersom multi-device är trasig.
3. **Delning**. "Share note" saknas helt. Kräver asymmetrisk kryptering (X25519 nyckelväxling) per delad användare.
4. **Slack/Notion**-integrations i MCP-paneler kräver hemlighetshantering. UI-konfigurationen ligger ändå lokalt — visa tydligt *var* hemligheten är krypterad (SecureStore / safeStorage / localStorage-GCM).
5. **AI-provider-fallback**. Om `node-llama-cpp` misslyckas (fel GGUF) faller klienten tillbaka till OpenRouter. Detta bör *aldrig* ske om `syncWithBackend=false` och `localOnly` är satt — kontrollera i `useAIGenerationLoop` innan network-fetch.
6. **Tool-verktyg för `mcp_list_tools`/`mcp_call_tool`**. Fint att de finns, men det finns ingen `mcp_describe_tool`-hjälpare som modellen kan använda för att få parameter-schemat. Idag måste modellen gissa.

---

## 16. Dokumentation (`Doc/`)

- Ingen indexfil. Vi lägger till en — se samma commit: `Doc/README.md`.
- `Doc/Overview.md` beskriver "CryptoJS 4+ för AES-256; PBKDF2 för nyckelgenerering" — inkorrekt, PBKDF2 används inte. Uppdatera.
- `Doc/Implementation.md` har `[x]` på "E2E-kryptering" men §1 här visar tvärtom.
- `Doc/Tool Calls.md` är en äldre PRD. Saknar `list_projects`, `list_tasklists`, `mcp_list_tools`, `mcp_call_tool` som faktiska kodbasen använder (jfr `AISidebar.tsx:1715–1735`). Uppdatera.
- `Doc/AI Platform Security & Stability Review.md` är rimlig status men listar "Key rotation for audit encryption" utan att nämna att *applikations*-nyckeln (§1.1) *inte* roterar. Lägg till den kvarstående risken.
- `Doc/MCP impl.md` är 1337 rader, `Doc/LM Studio.md` är 1536. Bryt upp i mindre filer (`mcp/` och `lm-studio/` undermappar) annars är de oläsbara.
- Roten har `förbättraingar.md` (felstavning), `förbättringar.md`, `improvements.md`, och nu detta `Doc/improvements.md`. Reducera till två: rotens `improvements.md` (tekniska skulder) + `Doc/improvements.md` (detta dokument, levande kritik).
- Städa `Scale.md`, `säkerhetsrapport.md` i roten — flytta till `Doc/`.

---

## 17. Konkret handlingslista (90 dagar)

### Sprint 1 (P0, 2 veckor)
1. Ta bort `DEFAULT_KEY`-fallback. Hårdfela `encrypt`/`decrypt` utan nyckel.
2. Auth-gate `POST /app/api/ai/route.ts`. Validera `modelPath`.
3. Auth-gate `/api/ai/models/*`.
4. Rensa `password`-fält från `GET /api/notes/:id`-svar.
5. Bestäm GraphQL-arkitektur: ta bort server-side encrypt/decrypt eller ta bort E2E-retoriken. Ena bort ena vägen.
6. Tom/ersätt `/apps/firefox-extension/` innehåll.

### Sprint 2 (P0–P1, 3 veckor)
7. Ersätt CryptoJS AES-CBC med AES-256-GCM + Argon2id-KDF + password-derived wrapped data key (§1.2–1.3).
8. Cross-device `wrappedKey` på backend.
9. `isEncryptedPayload` — kräv v3-formatet.
10. Flytta tool-parser/harness till `packages/ai`, deduplicera web/mobile.
11. Bygg telemetri för tool-calls (stopp-reason, parser-failures).

### Sprint 3 (P1, 3 veckor)
12. CSP för Electron + lås `http:request`-bridge till allowlist.
13. MCP-subprocessernas env-scoping (§5.3).
14. Prom-metrics + logrotation + `.gitignore` loggar.
15. GraphQL depth/complexity + DataLoader.
16. `AISidebar.tsx`-dekomponering i tematiska komponenter.

### Sprint 4 (P1–P2, 4 veckor)
17. Ersätt char-baserad historia-trimming med token-räkning.
18. Strukturerat provider-native tool-format (OpenRouter + Gemini).
19. Per-user AI-sync-kvot + TTL på `AIMessageSync`.
20. Ny `Doc/README.md`-index (redan del av detta PR) + städa rot-doc-filer.

---

## 18. Bilaga — specifika filrader att titta på först

```
noter-app/packages/shared/src/encrypt.ts:3         DEFAULT_KEY
noter-app/packages/shared/src/encrypt.ts:52-58     Legacy DEFAULT_KEY fallback
noter-app/apps/backend/src/graphql/schema.ts:7-23  Server-side encrypt/decrypt
noter-app/apps/backend/src/routes/notes.ts:209     +password leak
noter-app/apps/backend/src/index.ts:263            /api/ai/models/* no auth
noter-app/apps/web/app/api/ai/route.ts:16-20       modelPath trust + no auth
noter-app/apps/web/components/AISidebar.tsx:1634   toolSystemPrompt monolith
noter-app/apps/web/components/AISidebar.tsx:1739   extractToolCalls duplikat
noter-app/packages/ai/src/index.ts:105             fragile tool-call parser
noter-app/packages/ai/src/mcp.ts:15                fel JSON-RPC-metoder
electron-noter/main.js:756                         http:request proxy
noter-app/apps/backend/src/services/mcp/runtime.ts:438  env-läcka till subprocess
noter-app/apps/backend/src/services/mcp/runtime.ts:466  substring-intent-check
noter-app/apps/backend/src/utils/logger.ts:17-18   Loggar in-checkade
noter-app/apps/firefox-extension/PROGRESS.md       Kod saknas
```

---

## 19. Öppna frågor till teamet

1. **E2E eller inte E2E?** Bestäm arkitektur innan §1.2–1.3 implementeras.
2. **Multi-device stöd?** Om ja: §1.3 är blockerande. Om nej: dokumentera det som "single-device app" på `Doc/Overview.md`.
3. **Mobil-offline-förstnlig modellkörning**: räcker OpenRouter/Gemini i praktiken? Om ja: förenkla genom att ta bort node-llama-cpp-vägen på web.
4. **Firefox-extension**: vill teamet bygga eller ska mappen tas bort?
5. **AI-telemetri**: tillåts klient-side-telemetri? I så fall, var lagras den (backend, Grafana Cloud, lokalt)?

---

*Slut på kritisk granskning. Dokumentet är avsett att revideras inför varje sprintplanering. Flagga punkter som har avvisats eller kommit ur arkitekturella skäl i git-historiken på denna fil.*

---

## Iteration B11 — implementationsstatus

| Område | Punkt | Status | Filer |
|---|---|---|---|
| Backend | Persisted-query revocation API | ✅ | `apps/backend/src/routes/adminGraphql.ts`, `apps/backend/src/graphql/trustedDocuments.ts` |
| Backend | Apollo Federation pilot | ✅ | `apps/backend/src/graphql/federationPilot.ts`, `apolloAdapter.ts` |
| Backend | Per-org tenancy | ✅ | `apps/backend/src/models/Org.ts`, `middleware/tenant.ts`, `scripts/backfillOrgs.ts` |
| Backend | Dynamic GraphOS variant routing | ✅ | `apps/backend/src/graphql/graphos.ts` (`resolveGraphosVariant`, `applyGraphosVariantOverride`) |
| Backend | OpenTelemetry Logs-API | ✅ | `apps/backend/src/observability/otelLogs.ts`, `utils/logger.ts` |
| Electron | `<noter-attachment>` Web Component | ✅ | `electron-noter/src/noterAttachmentElement.js` (custom `noter-asset://` protocol) |
| Electron | Native menubar mirroring tray | ✅ | `electron-noter/src/menubarMirror.js` |
| Electron | `shell.openPath` skip-confirm | ✅ | `electron-noter/src/openPathSafe.js`, preload `noterSupport.openPathSafe/showInFolder` |
| Electron | `autoUpdater.allowDowngrade` flow | ✅ | `electron-noter/src/autoUpdate.js` (`checkForDowngrade`), IPC `updater:check-downgrade` |
| Mobile | `useTypedSearchParams` (Zod) | ✅ | `apps/mobile/services/router/useTypedSearchParams.ts` |
| Mobile | Reanimated 4 keyframes helper | ✅ | `apps/mobile/services/animation/keyframes.ts` |
| Mobile | App Tracking Transparency prompt | ✅ | `apps/mobile/services/privacy/appTrackingTransparency.ts` |
| Mobile | Edge-to-edge insets context | ✅ | `apps/mobile/services/layout/edgeToEdgeContext.tsx` |
| Mobile | MMKV pre-warm under splash | ✅ | `apps/mobile/services/cache/mmkvPrewarm.ts`, wired i `app/_layout.tsx` |
| Cross | GraphQL fragment masking | ✅ | `apps/mobile/codegen.ts` (`generated/gql/` via `client`-preset) |
| Cross | Cloud Detox test runner (5 OS-versioner) | ✅ | `.github/workflows/cloud-detox.yml` |
| Cross | multi-semantic-release för monorepo | ✅ | `.multi-semantic-release.json`, `.github/workflows/semantic-release.yml` |
| Cross | Mermaid plugin för docs-site | ✅ | `docs-site/astro.config.mjs`, `docs-site/src/components/MermaidDiagram.astro` |
| Cross | OTel collector k8s overlay | ✅ | `deploy/k8s/base/otel-collector.yaml` + `kustomization.yaml` |

**Nya env-flaggor:** `NOTER_ADMIN_TOKEN`, `NOTER_GRAPHQL_FEDERATION`, `NOTER_GRAPHQL_SUBGRAPH`, `APOLLO_GRAPH_VARIANT`, `NOTER_DEPLOY_ENV`, `NOTER_OTEL_LOGS`, `NOTER_OTEL_LOG_LEVEL`, `X-Noter-Org` HTTP-header.

**Nya scripts:** `tsx apps/backend/src/scripts/backfillOrgs.ts` (idempotent personal-org backfill).

---

## Iteration B12 — implementationsstatus

| Område | Punkt | Status | Filer |
|---|---|---|---|
| Backend | Subscriptions over WebSocket-link i federation | ✅ | `apps/backend/src/graphql/subscriptions.ts` (`attachFederationWebSocketSubscriptions`), wired i `index.ts` |
| Backend | Sub-graph hot-swap via `@noterDefined` direktiv | ✅ | `apps/backend/src/graphql/federationPilot.ts` (directive + subscription resolvers) |
| Backend | Org-baserad rate-limit | ✅ | `apps/backend/src/services/orgRateLimiter.ts`, mounted i `index.ts` på `/api/notes` + `/api/tasks` |
| Backend | CRDT-collab-bridge i tenant-scope | ✅ | `apps/backend/src/services/collabBridge.ts` (Socket.IO namespace `/collab`) |
| Backend | Mongoose plugin auto-injectar `orgId` | ✅ | `apps/backend/src/db/tenantScopePlugin.ts` (ALS-baserad), globalt registrerad i `index.ts` |
| Electron | `app.setAccessibilitySupportEnabled` på VoiceOver/Narrator | ✅ | `electron-noter/src/accessibilityAndTheme.js` (`installAccessibilityDetection`) |
| Electron | `nativeTheme.themeSource` sync | ✅ | `electron-noter/src/accessibilityAndTheme.js` (`installThemeSourceSync`) + IPC `theme:set-source`/`theme:get` |
| Electron | Touch Bar layout MBP13+/16 | ✅ | `electron-noter/src/accessibilityAndTheme.js` (`installTouchBar`) |
| Electron | Smart Card-baserad signing fail-loop | ✅ | `electron-noter/src/smartCardSigning.js` (signtool + AzureSignTool, bounded retry) |
| Mobile | Typed search params via codegen | ✅ | `apps/mobile/codegen/plugins/typedSearchParams.cjs`, `useTypedRouteParams` hook |
| Mobile | Skia Canvas keyframes fallback | ✅ | `apps/mobile/services/animation/skiaKeyframes.tsx`, `useResolvedKeyframes` |
| Mobile | `useReducedMotion` + ATT-respect | ✅ | `apps/mobile/services/animation/useReducedMotion.ts`, ATT bail-out på reduce-motion |
| Mobile | Per-org MMKV partitionering | ✅ | `apps/mobile/services/cache/mmkv.ts` (`getOrgPartitionedCache`, `dropOrgPartition`, `setActiveOrgPartition`) |
| Cross | client-preset resolver-typer | ✅ | `apps/backend/codegen.ts`, `apps/backend/src/graphql/context.ts`, typed `apolloAdapter` context |
| Cross | multi-release `--dry-run` PR-comment | ✅ | `.github/workflows/release-dry-run.yml` (sticky comment via `github-script`) |
| Cross | Mermaid → SVG cache | ✅ | `docs-site/scripts/buildMermaidCache.mjs` (`dist/_mermaid/<hash>.svg` + manifest) |
| Cross | OTel collector staging/production overlays | ✅ | `deploy/k8s/overlays/{staging,production}/otel-collector-patch.yaml` |

**Nya env-flaggor:** `RATE_LIMITER_REDIS_URL` (dedikerad rl-redis), `DD_API_KEY`, `DD_SITE`, `TEMPO_ENDPOINT`, `LOKI_ENDPOINT`.

**Nya WS-endpoints:** `/api/graphql/subscriptions/ws` (graphql-ws), `/collab` Socket.IO namespace.

**Nya IPC-kanaler (Electron):** `theme:set-source`, `theme:get`, `theme:changed` (event), `accessibility:state` (event).

---

## Iteration B13 — implementationsstatus

| Område | Punkt | Status | Filer |
|---|---|---|---|
| Backend | Apollo Gateway IntrospectAndCompose poller | ✅ | `apps/backend/src/graphql/federationGateway.ts`, `scripts/composeFederation.ts`, wired i `apolloAdapter.ts` |
| Backend | Mongoose bulkWrite validator (orgId per op) | ✅ | `apps/backend/src/db/tenantScopePlugin.ts` (`schema.statics.bulkWrite` wrapper) |
| Backend | Redis Cluster-medvetenhet i orgRateLimiter | ✅ | `apps/backend/src/services/orgRateLimiter.ts` (`createCluster`, hash-tag prefix, insurance fallback) |
| Backend | WebSocket-link keepAlive=12000 | ✅ | `apps/backend/src/graphql/subscriptions.ts` (`graphql-ws` `keepAlive: 12_000`) |
| Electron | BrowserView/WebContentsView embedded auth | ✅ | `electron-noter/src/browserViewAuth.js`, preload `noterAccount.openAuthView/closeAuthView` |
| Electron | `setBackgroundThrottling(false)` på systray | ✅ | `electron-noter/src/chromiumHardening.js` (`installNoThrottleForTray`) |
| Electron | `CodeIntegrity` Chromium flag (Windows) | ✅ | `electron-noter/src/chromiumHardening.js` (`applyChromiumHardening`), wired pre-`whenReady` |
| Electron | Signed launcher-stub + asar integrity verifier | ✅ | `electron-noter/src/asarIntegrityVerifier.js` (ECDSA-P256 över `INTEGRITY`), körs först i `whenReady` |
| Mobile | Reanimated 4 useEvent/useHandler worklets | ✅ | `apps/mobile/services/animation/workletBridge.ts` (`useWorkletGestureHandler`, `useWorkletScrollHandler`) |
| Mobile | `MMKV.recrypt(newKey)` vid lösenordsbyte | ✅ | `apps/mobile/services/cache/mmkv.ts` (`rotateMmkvEncryptionKey` använder recrypt om tillgängligt) |
| Mobile | `SystemBars.setHidden` för fullscreen reading | ✅ | `apps/mobile/services/layout/edgeToEdgeContext.tsx` (`useFullscreenReadingMode` hook) |
| Mobile | AccessibilityService-baserad Android voice-shortcut | ✅ | `apps/mobile/services/voice/androidShortcut.ts` (NoterVoiceShortcut native module bridge) |
| Cross | `@graphql-tools/load-files` för .gql partials | ✅ | `apps/backend/src/graphql/schemaPartials.ts` (`loadSchemaPartials`) |
| Cross | GitHub merge-queue med Lighthouse + Detox gates | ✅ | `.github/workflows/merge-queue-gate.yml` |
| Cross | OSV-scanner workflow | ✅ | `.github/workflows/osv-scanner.yml` (SARIF + PR-comment) |
| Cross | argocd-image-updater + Cosign-verifiering | ✅ | `deploy/argocd/image-updater.yaml`, `docker-publish.yml` (keyless cosign sign) |

**Nya env-flaggor:** `NOTER_GRAPHQL_GATEWAY`, `NOTER_SUBGRAPH_NOTES_URL`, `NOTER_SUBGRAPH_TASKS_URL`, `NOTER_SUBGRAPH_AI_URL`, `NOTER_GATEWAY_POLL_MS`, `NOTER_GATEWAY_AUTH_HEADER`, `NOTER_RELEASE_PUBKEY_PEM`, `RATE_LIMITER_REDIS_CLUSTER_NODES`, `REDIS_CLUSTER_NODES`.

**Nya IPC-kanaler (Electron):** `auth:open-view`, `auth:close-view`, `auth:clear-partition`, `auth:callback` (event).

**Nya scripts:** `tsx apps/backend/src/scripts/composeFederation.ts` (CI-side schema composition check), `node electron-noter/src/asarIntegrityVerifier.js` (build-time INTEGRITY-manifest writer).

---

## Iteration B14 — implementationsstatus

| Område | Punkt | Status | Filer |
|---|---|---|---|
| Backend | Persisted-query stripping på federation-gateway | ✅ | `apps/backend/src/graphql/federationGateway.ts` (`NoterRemoteDataSource.willSendRequest` rensar `extensions.persistedQuery`) |
| Backend | JWT-claims propagation via RemoteGraphQLDataSource | ✅ | `apps/backend/src/graphql/federationGateway.ts` (`x-noter-org/user/role/trace-id` headers per sub-graph hop) |
| Backend | `Model.watch()`-baserad DataLoader-invalidation | ✅ | `apps/backend/src/services/dataLoaderInvalidator.ts`, integrerad i `dataloaders.ts` via `epochAwareKey` |
| Backend | Auto-derived OpenAPI 3.1 från `@noterRest`-directive | ✅ | `apps/backend/src/graphql/openApiFromGraphql.ts`, mountad på `/api/openapi.json` |
| Electron | Pinned Spell Check dictionary CDN | ✅ | `electron-noter/src/desktopPolish.js` (`installSpellCheckerCdn`) |
| Electron | Opt-in `setLoginItemSettings` | ✅ | `installAutostartIpc` + preload `mlc.getAutostart/setAutostart` |
| Electron | `createThumbnailFromPath` instant-search thumbnails | ✅ | `installThumbnailIpc` (re-uses `openPathSafe` allowlist), preload `noterSupport.thumbnail` |
| Electron | `setBackgroundMaterial('acrylic')` Win11 | ✅ | `applyAcrylicBackdrop` (build-22000+ guard) |
| Mobile | UI-thread AsyncStorage → MMKV migration | ✅ | `apps/mobile/services/cache/uiThreadMigration.ts` (`runOnUI` worklet batch write), wired i `_layout.tsx` |
| Mobile | `react-native-mmkv-flipper-plugin` dev integration | ✅ | `apps/mobile/services/devtools/mmkvFlipper.ts`, `__DEV__`-gated init |
| Mobile | `expo-document-picker` med multipleSelection | ✅ | `apps/mobile/services/files/documentPicker.ts` (`pickDocuments` wrapper) |
| Mobile | SwiftUI iOS-widget bridge via expo-modules-core | ✅ | `apps/mobile/services/widgets/iosSwiftUiWidget.ts` (`refreshIosWidgets`, `pushNotesWidgetSnapshot`) |
| Cross | Sigstore Rekor audit i CI | ✅ | `.github/workflows/rekor-audit.yml` (daily + on docker-publish) |
| Cross | actionlint `persist-credentials` rule | ✅ | `.github/scripts/check-persist-credentials.py`, kopplad i `actionlint.yml` |
| Cross | Pulumi IaC för Argo CD self-bootstrap | ✅ | `deploy/iac/argocd-bootstrap.pulumi.ts`, `Pulumi.yaml` |
| Cross | Renovate automerge för låg-CVE patches | ✅ | `renovate.json` (matchCvss `≤ 4.0` ⇒ automerge, `≥ 7.0` ⇒ require review) |

**Nya env-flaggor:** `NOTER_DICTIONARY_CDN_URL`.

**Nya IPC-kanaler (Electron):** `autostart:get`, `autostart:set`, `thumbnail:create`.

**Nya endpoints:** `GET /api/openapi.json` (auto-derived OpenAPI 3.1).

**Nya scripts:** `pulumi up` i `deploy/iac/` (Argo CD-bootstrap), `python3 .github/scripts/check-persist-credentials.py` (CI guard).

---

## Iteration B15 — implementationsstatus

| Område | Punkt | Status | Filer |
|---|---|---|---|
| Backend | Subscription multiplexing över graphql-ws | ✅ | `apps/backend/src/graphql/subscriptionMultiplexer.ts`, integrerad via `onSubscribe/onComplete/onDisconnect` i `subscriptions.ts` |
| Backend | Per-subgraph circuit breaker | ✅ | `apps/backend/src/services/circuitBreaker.ts` + `NoterRemoteDataSource.process()` i `federationGateway.ts` |
| Backend | Admin auditStream event-emitter (SSE) | ✅ | `apps/backend/src/routes/adminGraphql.ts` (`adminAuditStream`, `GET /api/admin/graphql/audit-stream`) |
| Backend | SDL diff-report PR-comment | ✅ | `.github/workflows/sdl-diff.yml`, `apps/backend/src/scripts/printSchema.ts` |
| Electron | AX-toggle renderer disable | ✅ | `electron-noter/src/electronExtras.js` (`applyAccessibilityToggle`), wired pre-`whenReady` |
| Electron | Signal-cancellable `showOpenDialog` | ✅ | `installCancellableDialogs` (IPC `dialog:open` + `dialog:abort`), preload `mlc.openDialog/abortDialog` |
| Electron | Retina `tray@2x.png` template image | ✅ | `installRetinaTrayIcon` (template-image på macOS) |
| Electron | Single-instance signing handover | ✅ | `installSigningHandover` (gates `second-instance` under signtool) |
| Mobile | useNetInfo offline banner | ✅ | `apps/mobile/services/network/useOfflineBanner.ts` |
| Mobile | FlashList partial hydration | ✅ | `apps/mobile/components/NoteFlashList.tsx` (`getItemType` heuristik) |
| Mobile | iOS Live Activities bridge | ✅ | `apps/mobile/services/widgets/iosLiveActivities.ts` (`bindAiStreamToLiveActivity`) |
| Mobile | Vision-camera QR-scanner | ✅ | `apps/mobile/components/QrScanner.tsx` (`useCodeScanner`, permission-aware) |
| Cross | dependency-review-action `comment-summary-in-pr: always` | ✅ | `.github/workflows/dependency-review.yml` (high-severity gate) |
| Cross | CodeQL custom queries för noterCache | ✅ | `codeql/noter-queries/SecretsInNoterCache.ql`, `qlpack.yml`, `default.qls`, wired i `codeql.yml` |
| Cross | Renovate `transitiveRemediation: true` | ✅ | `renovate.json` |
| Cross | Argo CD ApplicationSet multi-cluster (eu-north-1 / eu-west-1) | ✅ | `deploy/argocd/application-set.yaml`, `deploy/k8s/overlays/eu-north-1/`, `deploy/k8s/overlays/eu-west-1/` |

**Nya endpoints (Backend):** `GET /api/admin/graphql/audit-stream` (SSE).

**Nya env-flaggor:** `NOTER_REGION` (per-region pod-deploy).

**Nya IPC-kanaler (Electron):** `dialog:open`, `dialog:abort`, `signing:second-instance` (event).

---

## Iteration B16 — implementationsstatus

| Område | Punkt | Status | Filer |
|---|---|---|---|
| Backend | keyv gateway response-cache med per-org TTL | ✅ | `apps/backend/src/graphql/gatewayResponseCache.ts`, plugin mountad i `apolloAdapter.ts` |
| Backend | `mongoose.set('autoIndex', false)` + reconcileIndexes CronJob | ✅ | `apps/backend/src/index.ts`, `deploy/k8s/base/reconcile-indexes-cronjob.yaml` |
| Backend | `@apollo/server-plugin-response-cache` med tenant-keyed sessionId | ✅ | `apolloAdapter.ts` (sessionId = `org:<orgId>`) |
| Backend | `node:diagnostics_channel` events från MCP runtime | ✅ | `apps/backend/src/services/mcp/diagnostics.ts`, publish-anrop i `runtime.ts` |
| Electron | macOS vibrancy följer `nativeTheme` | ✅ | `electron-noter/src/desktopRefinements.js` (`installVibrancySync`) |
| Electron | About-panel med signature fingerprint | ✅ | `installAboutPanel` (läser från `INTEGRITY`-manifest) |
| Electron | Hardened `crashReporter` (ignoreSystemCrashHandler + rateLimit) | ✅ | `installHardenedCrashReporter` (kräver `NOTER_CRASH_SUBMIT_URL`) |
| Electron | `screen.getDisplayMatching`-baserad window placement | ✅ | `computeWindowBounds` / `trackWindowBounds` (persistar i `window-state.json`) |
| Mobile | Typed `Href` för expo-router | ✅ | `apps/mobile/services/router/typedHref.ts` (`noterHref`, `matchKnownRoute`) |
| Mobile | `@gorhom/bottom-sheet` v5 wrapper | ✅ | `apps/mobile/components/NoterBottomSheet.tsx` (lib + `<Modal>`-fallback) |
| Mobile | Lazy Material Icons | ✅ | `apps/mobile/components/LazyMaterialIcon.tsx` (`prewarmMaterialIcons`) |
| Mobile | `react-native-keyboard-controller` worklet | ✅ | `apps/mobile/services/keyboard/useNoterKeyboard.ts` |
| Cross | `gh attestation verify`-workflow | ✅ | `.github/workflows/attestation-verify.yml` |
| Cross | `kubeconform` lint för kustomize-overlays | ✅ | `.github/workflows/kubeconform.yml` |
| Cross | OPA/Conftest policies för Argo CD CRDs | ✅ | `deploy/opa/argocd-policies.rego`, `.github/workflows/conftest-argocd.yml` |
| Cross | Harbor registry mirror | ✅ | `deploy/k8s/base/registry-mirror.yaml` (Helm-baserad) |

**Nya env-flaggor:** `GATEWAY_RESPONSE_CACHE_URL`, `NOTER_CRASH_SUBMIT_URL`.

**Nya diagnostic_channel-kanaler:** `noter.mcp.spawn`, `noter.mcp.exit`, `noter.mcp.stdout`, `noter.mcp.stderr`, `noter.mcp.toolcall`.

**Nya CI-workflows:** `attestation-verify.yml`, `kubeconform.yml`, `conftest-argocd.yml`.

---

## Iteration B17 — implementationsstatus

| Område | Punkt | Status | Filer |
|---|---|---|---|
| Backend | `@cacheControl`-directive med per-field TTL | ✅ | `apps/backend/src/graphql/cacheControlDirective.ts`, `addCacheControlHints` applicerad i `apolloAdapter.ts` |
| Backend | `@apollo/server-plugin-inline-trace` staging-only | ✅ | `apolloAdapter.ts` env-checkar `NOTER_DEPLOY_ENV === 'staging'` |
| Backend | Per-org `mongoose.useDb()` | ✅ | `apps/backend/src/db/tenantConnections.ts` (`getTenantConnection`, `tenantDbBindMiddleware`), wired på note/task-routes |
| Backend | BullMQ AI render-queue | ✅ | `apps/backend/src/services/aiQueue.ts`, `POST /api/ai/render` + `GET /api/ai/job/:id` |
| Electron | Persisterad `nativeTheme.themeSource` | ✅ | `electron-noter/src/desktopExtras2.js` (`installPersistedThemeSource`, IPC `theme:save-source`) |
| Electron | Windows `setUserTasks` jump-list | ✅ | `installWindowsUserTasks` |
| Electron | `safeStorage.isEncryptionAvailable()`-guard | ✅ | `installSafeStorageGuard`, preload `noterDiag.safeStorageAvailable/EncryptGuarded` |
| Electron | `desktopCapturer.getSources` screen-share IPC | ✅ | `installScreenShareIpc`, preload `mlc.listScreenShareSources` |
| Mobile | `expo-task-manager` background sync | ✅ | `apps/mobile/services/sync/backgroundSync.ts` |
| Mobile | `expo-secure-store` per-org keychainService | ✅ | `apps/mobile/services/security/orgKeychain.ts` (`setOrgSecret`, `wipeOrgKeychain`) |
| Mobile | `react-native-screens enableFreeze(true)` | ✅ | `apps/mobile/services/runtime/runtimeFlags.ts`, applied top of `_layout.tsx` |
| Mobile | Hermes microtask queue | ✅ | `applyRuntimeFlags` (samma fil) |
| Cross | Sigstore `gitsign` commit-signing | ✅ | `Doc/security/gitsign-setup.md`, `.github/workflows/gitsign-verify.yml` |
| Cross | KubeArmor runtime policies | ✅ | `deploy/k8s/base/kubearmor-policy.yaml` |
| Cross | ORAS-baserad SBOM archive (referrers) | ✅ | `.github/workflows/oras-sbom-archive.yml` |
| Cross | argo-rollouts canary med Lighthouse-analysis | ✅ | `deploy/k8s/base/rollout.yaml` (5%→25%→50%→100% + analysis-template) |

**Nya env-flaggor:** `NOTER_TENANT_DBS`, `NOTER_AI_QUEUE`, `AI_QUEUE_REDIS_URL`, `NOTER_AI_WORKER_CONCURRENCY`.

**Nya endpoints (Backend):** `POST /api/ai/render`, `GET /api/ai/job/:id`.

**Nya IPC-kanaler (Electron):** `theme:save-source` (send), `theme:persisted` (event), `safestorage:available`, `safestorage:encrypt-guarded`, `screen-share:list-sources`.
