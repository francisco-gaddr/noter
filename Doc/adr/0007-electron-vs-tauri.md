# ADR-0007: Electron → Tauri (or alternatives) — assessment

Status: **Accepted (decision: WAIT / spike)** · 2026-06-14

## Context

The desktop app is Electron wrapping our Next.js 15 / React 19 static export (shared
with the web app), using Electron `safeStorage` for at-rest encryption, IndexedDB, and
WSS. We evaluated migrating to Tauri v2 (and alternatives) for performance/size.

## Decision

**Do not migrate the production desktop app yet. Run a time-boxed 1–2 week spike first.**
Tauri v2 is production-ready and the wins (≈10–30× smaller installer, ~½ the RAM) are
real, but for *this* app the costs land on our three highest-risk surfaces: at-rest
crypto, auto-update continuity for existing installs, and cross-platform webview
rendering of our single shared React UI. None are blockers; all are where we least want
surprises.

## Findings (evidence-based)

- **Tauri v2 maturity:** stable since 2024-10, security-audited, 2.10.x shipping in
  2026, ~121k★ (fastest-growing JS-desktop framework). Next.js 15 static export is a
  first-class, documented target — **our UI carries over with the least friction.**
- **What must be rewritten in Rust:** the Electron main process / IPC (e.g. Goose: a
  2,394-line `main.ts` → ~1,600 LOC Rust, 42 IPC handlers), tray/notifications/deep-
  links/fs/auto-update (all exist as plugins).
- **At-rest encryption is the sharpest edge:** Tauri has no `safeStorage` equivalent.
  The OS **keyring** plugin stores *small secrets*, not arbitrary blobs — the right
  pattern is "store one data-key in keyring, encrypt our `@repo/shared` v3 AES-GCM
  payloads ourselves." Tractable given our crypto, but a deliberate redesign of our
  most security-sensitive code. **Stronghold is officially deprecated — do not use it.**
- **Auto-update is the #1 real-world gotcha:** Tauri's minisign updater is separate from
  Electron's; real migrations (Fluxzy) had to ship a bridge release and *still* stranded
  some users on the old version. Needs an explicit migration plan + Windows two-pass
  signing.
- **Webview inconsistency:** Electron bundles one Chromium (zero variance). Tauri uses
  WebView2 (Win) / WKWebView (mac) / WebKitGTK (Linux) — WebKitGTK is the weak link.
  Our single shared React UI would take materially more cross-platform QA.
- **Alternatives:** Wails (Go) — same webview tradeoff, no first-class mobile, only if
  team is Go-native; Neutralino — too minimal for a crypto/tray/auto-update app; .NET
  MAUI Blazor — would abandon our React/Expo investment. Staying on Electron is a
  defensible choice for a security product where rendering predictability is a feature.

## Effort estimate (Noter, one senior dev incl. Rust ramp-up)

- Spike / PoC (do now): **1–2 person-weeks** — Next.js export in Tauri, render the real
  UI in WKWebView + WebKitGTK, prototype keyring-backed key, smoke-test IndexedDB + WSS.
- Full migration if greenlit: **~6–10 person-weeks** — IPC rewrite (2–3w), at-rest crypto
  redesign (1–2w, high-care), auto-update bridge + signing (1–2w), plugins (1w),
  three-webview QA (1–2w).

## Top risks

1. At-rest encryption redesign (`safeStorage` → keyring) — highest blast radius.
2. Auto-update discontinuity for existing users.
3. WebKitGTK/WKWebView rendering variance on the shared UI → recurring QA cost.
4. Rust learning curve on IPC/state glue.
5. Slow Rust clean builds in CI (minutes).

## Consequences

We stay on Electron for now. Revisit after a spike that renders Noter's actual UI on
WKWebView + WebKitGTK and prototypes the keyring-backed key. Greenlight only if the UI
renders clean on all targets and the crypto redesign feels safe.

Sources: see the research notes (Tauri 2.0 blog, v2 Next.js guide, webview-versions
reference, keyring discussion #7846, Fluxzy + Goose migration write-ups, gethopp /
Elanis benchmarks, PkgPulse 2026 framework comparison).
