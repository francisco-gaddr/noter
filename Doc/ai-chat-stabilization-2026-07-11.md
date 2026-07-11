# AI-chat crash diagnosis + stabilization (2026-07-11)

Report for the "mobilappen kraschar när man chattar med AI (både lokal och API)" goal. Diagnosis was
done with three parallel crash-hunt agents (shared send path, local-model pipeline, API/streaming
pipeline). This documents the root causes, the fixes, the shared-for-Tauri design, and the tests.

## Why it crashed — three independent causes behind one symptom

The chat is wrapped in a React error boundary and the send handler is fully try/caught, so the "crash"
was NOT an unguarded JS throw in render. It came from three places, which is why it hit **both** the
local and API paths:

1. **The crash-survival net was defeated (both paths).** Two installers fought over
   `ErrorUtils.setGlobalHandler`: `errorTracking` chained back to RN's **fatal** default (re-raising →
   hard crash), while `globalErrorGuard` (which swallows) was gated `if (__DEV__) return` — so in a
   dev/preview client any escaping async error crashed, and even in release the GlitchTip telemetry was
   lost. Net effect: a recoverable error presented as a hard crash, on both paths.

2. **API path: a re-render storm.** The chat called `setMessages(...)` — a full `FlatList` re-render —
   on **every** streamed token. At 20-60 tok/s that is hundreds of re-renders per second on the JS
   thread → Android ANR / watchdog kill.

3. **Local path: native context lifecycle races.** `ModelManager.load/unload` were not serialized
   against in-flight completions, so switching model (or the background agent loading a different one)
   called `releaseAllLlama` while a completion streamed → the native context was freed underneath it →
   **SIGSEGV**. Separately, activation checked only file *existence*, so a truncated/corrupt/HTML-as-
   `.gguf` file reached native `initLlama` → **SIGABRT**.

## The fixes

### Crash-survival net (unified) — `apps/mobile/services/errorTracking.ts`
One owner. Installs in **every** build and even **without** a GlitchTip DSN (survival must not depend
on telemetry). Reports to GlitchTip when configured. In DEV it chains to the red-box so real bugs stay
visible; in RELEASE it survives (never re-raises to the fatal default) with a throttled user notice.
The decision is a pure exported `decideErrorNetAction` with a contract test locking "RELEASE never
chains to fatal". `globalErrorGuard` is now a thin alias to this single owner.

### Streaming throttle (shared) — `packages/ai/src/streamSink.ts`
`StreamSink` buffers tokens and flushes the UI at a bounded cadence (leading + trailing + a guaranteed
final flush on `end()`), with independent coarser persistence throttling. Both the API and local
streaming paths in `ai.tsx` now push tokens through it instead of `setMessages`-per-token. Pure and
fully clock/timer-injectable → deterministic tests prove flush count is bounded by *time*, not token
count. **This is the shared primitive the Tauri/desktop app will reuse for its own streaming.**

### Local engine (serialized + integrity) — `apps/mobile/services/ai/ModelManager.ts` + `modelService.ts`
`load`, `unload`, and `complete` now run through ONE mutex, so a model switch/unload can never free the
`llama.rn` context mid-completion (a switch simply waits for the current generation to finish).
`verifyModelFile` (size + GGUF magic) runs before native `initLlama` in `load`, and replaces the
existence-only skip in `downloadModel` — a corrupt/partial file fails with a clear re-download message
instead of aborting the process.

### API streaming hardening — `apps/mobile/services/ai/apiProviders.ts`
- `stream_options:{include_usage}` is sent ONLY to providers that support it (openai/openrouter/groq/
  grok); self-hosted Hermes/LM Studio/Ollama no longer 400 and drop to the non-streaming fallback.
- A final `decoder.decode()` flush so a reply ending mid-emoji/CJK isn't truncated.
- A streaming-safe `TextDecoder` polyfill (`utils/textDecoderPolyfill.ts`) installed only if the engine
  lacks one, so SSE decoding never silently dies.
- `recordUsage` chain now has a `.catch`.

### System prompt (shared, layered) — `packages/shared/src/chatPrompt.ts`
`buildChatSystemPrompt` composes fixed-precedence labeled sections (per current best practice: specific
role, labeled sections, core constraints first, positive framing, concise): **BASE** (a strong specific
identity + the always-present locked-content privacy rule) → **USER** prompt → **PROJECT** prompt →
**TOOLS** guidance → **CONTEXT** notices. A real base role now always anchors the chat instead of
starting from the (possibly empty) user prompt. Mobile uses it; the Tauri/desktop app imports the same
builder.

## Shared-for-Tauri design

The reusable, platform-free pieces now live in the shared packages so the desktop app adopts them
without duplication:
- `@repo/ai` → `StreamSink` (streaming throttle).
- `@repo/shared` → `buildChatSystemPrompt` (system-prompt composition).
Platform-specific pieces stay per-app: the transport (`expo/fetch` vs browser fetch / Tauri), the local
runner (`llama.rn` on mobile; LM Studio HTTP on desktop), persistence, and the global-error net.

## Tests added

- `packages/ai/src/streamSink.test.ts` — 8 tests: leading/trailing/final flush, burst-collapse,
  bounded-by-time, cancel, bad-callback safety, post-end no-op.
- `packages/shared/src/chatPrompt.test.ts` — 6 tests: precedence, omission, no double-labeling, custom
  base/name, non-string safety.
- `apps/mobile/tests/error-net.test.ts` — 4 tests: the RELEASE-never-chains-to-fatal contract.
- `apps/mobile/tests/text-decoder-polyfill.test.ts` — 6 tests incl. a multibyte char split across chunks.
- `apps/mobile/tests/model-manager-serialization.test.ts` — 3 tests: unload/load wait for an in-flight
  completion (strict order); integrity gate blocks native init on a corrupt GGUF.
- `apps/mobile/tests/ai-streaming-integration.test.ts` — 5 tests: the previously-UNtested `expo/fetch`
  streaming path (deltas → onToken, multibyte reassembly, non-2xx throws, stream_options gating).

## Known follow-ups (documented, not silently skipped)
- Runtime QA on a physical Android device with a real API key + a real GGUF (the emulator/SDK isn't
  available in this environment).
- iOS RAM-budget guard for `initLlama` (`Device.totalMemory` can be null on iOS) — a jetsam risk on
  oversized models; Android already guards.

(Fixed in this pass: `ai.tsx:retrieveForChat` now receives `effectiveInput` — the Summarize entry path
previously passed the typed `input` and got no retrieval context.)
