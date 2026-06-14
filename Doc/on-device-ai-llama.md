# On-device AI (llama.rn)

Status: **active** (replaces the MLC plan in [`MLC AI.md`](MLC%20AI.md), which is superseded).
Introduced: app v1.4.0 (2026-06-14).

Noter runs local LLMs **directly on the phone** with [`llama.rn`](https://github.com/mybigday/llama.rn)
(the React Native binding of `llama.cpp`). A downloaded GGUF file is executed as-is — there is
**no conversion step, no build server, no third party**. This is the recommended best-practice
path for on-device inference and is dramatically simpler than the old MLC flow.

## Why this replaced MLC

The MLC path required converting each GGUF into an MLC package (`mlc-chat-config.json` +
`params_shard_*.bin`) on a server/CI, hosting the compiled zip, downloading + unzipping it, and
calling a hand-written native bridge. In practice the native engine was never linked, so on-device
chat was a stub. `llama.rn` removes the entire conversion/hosting/zip layer: download `.gguf` → run.

## Architecture

```text
AI chat UI (app/(tabs)/ai.tsx)
  ↓  MobileLlamaProvider (services/ai/provider.ts)        — passes OpenAI-style messages
  ↓  ModelManager (services/ai/ModelManager.ts)           — one resident model, lifecycle
  ↓  llama wrapper (services/ai/llama.ts)                  — initLlama / completion / release
  ↓  llama.rn  →  llama.cpp  →  Metal (iOS) / GPU+CPU (Android)
GGUF file on device (DocumentDirectory/llama_models/<model>-<QUANT>.gguf)
```

Key modules:

- **`services/ai/llama.ts`** — thin wrapper over `llama.rn`. Single resident `LlamaContext`,
  `file://` URI normalisation, GPU offload (`n_gpu_layers`, CPU fallback), `use_mlock`, a 4096
  default context window, real token streaming via the completion callback, and `shouldStop()`
  cooperative cancellation. `isLlamaLinked()` lets callers degrade gracefully when the native
  engine isn't in the build (e.g. Expo Go).
- **`services/ai/ModelManager.ts`** — owns the resident model. `load(path)`, `complete(messages,
  opts)`, `unload()`. Frees the engine when the app backgrounds unless background AI work is
  enabled. `isAvailable()` reports whether the native engine is compiled in.
- **`services/ai/provider.ts`** (`MobileLlamaProvider`) — forwards the `messages` array straight
  to the model so its **own chat template** is applied (no hand-rolled `System:/User:` prompt
  string). Streams tokens through `onToken`.
- **`services/ai/modelService.ts`** — `downloadModel()` downloads the GGUF straight to
  `llama_models/` (stages: `queued → downloading → completed`/`failed`) and records the file path
  as the model's `path`. `getBestQuantization()` prefers `Q4_K_M` for the size/quality balance.
- **`services/ai/ModelDownloader.ts`** — `downloadGgufModel()` (RNFS, cancellable via tracked
  jobId), `getModelPath()`, `stopModelDownload()`.

## Download → run flow

1. Search Hugging Face (web proxy) → pick a model → `downloadModel()` picks the best GGUF quant
   and downloads it directly to the device.
2. Select the model in AI settings → `ModelManager.load(path)` → `initLlama({ model: file://… })`.
3. Chat → `provider.streamResponse(messages, …, onToken)` → `context.completion({ messages })`
   streams tokens; the model's built-in chat template handles roles.

## Build & device verification

`llama.rn` is a native module, so it only exists in a **dev/EAS build**, not Expo Go or jest:

- `app.json` registers the Expo config plugin: `"plugins": [ …, "llama.rn", … ]`.
- New Architecture is already on (`newArchEnabled: true`).
- Run on a real device with an EAS dev build (or `eas build`). In AI settings, **“Kontrollera
  lokal motor”** reports whether the engine is linked (`localEngineReady` / `localEngineMissing`).
- Under jest the module is mocked (`jest.setup.js` + per-suite mocks); `services/ai/llama.ts` is
  unit-tested in `tests/ai-llama.test.ts`.

> On-device runtime correctness (actual token generation, speed, memory) can only be confirmed on a
> physical device via your EAS dev build — it cannot be exercised in CI. Settings shows engine
> availability; the chat itself is the final check.

## Privacy & security

- Local chat never leaves the device. Downloaded models and AI settings are stored locally; all
  note/task/AI content remains encrypted end-to-end in every client (see crypto docs).
- The locked-notes invariant still holds: the AI never reads or decrypts locked notes/projects
  (`@repo/shared/locks`), independent of which engine answers.
- When the native engine isn't in the build, the app says so plainly and points you to a Hermes
  source (your own Ollama/LM Studio) instead of fabricating a reply.

## Stability rules (carried over)

1. One resident model at a time; reused across turns; swapped only on model change.
2. Context window 4096 by default.
3. Engine freed on background unless background AI work is enabled.
4. Inference runs on llama.cpp's native threads (UI never blocks).

## Tests

`tests/ai-llama.test.ts`, `tests/ai-chat.test.ts`, `tests/ai-e2e.test.ts`,
`tests/ai-tool-use-e2e.test.ts`, `tests/ai-models.test.ts`,
`tests/ai-model-manager-background.test.ts`.
