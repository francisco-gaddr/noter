# Noter — säker antecknings- & uppgiftsplattform

Noter är en **end-to-end-krypterad** plattform för anteckningar, uppgifter och AI-chatt
med klienter för **web, mobil (iOS/Android) och desktop (Electron)**, en **Node/Express-backend**
och en **Raspberry Pi / Docker**-driftmiljö. Säkerhet och kryptering är kärnan: ingen
information lagras eller skickas i klartext — varken i databasen, på serverns disk eller i
enheternas lokala lagring.

> **Är du en AI-agent eller ny utvecklare? Börja i [`Doc/index.md`](Doc/index.md).**
> Det är den kuraterade kartan över *var* allt finns och *i vilken ordning* du ska läsa —
> så du slipper gissa. Den här filen är översikten; `Doc/index.md` är navigeringen.

> **⭐ Planerad migrering desktop Electron → Tauri:** beslut i
> [`Doc/adr/0007-electron-vs-tauri.md`](Doc/adr/0007-electron-vs-tauri.md), och en
> färdig, säkerhetsförst körguide i
> [`Doc/migrations/electron-to-tauri-runbook.md`](Doc/migrations/electron-to-tauri-runbook.md)
> (komplett IPC-karta, secure-store-omdesign med bevarad E2E-kryptering, auto-update-brygga,
> webview-QA). Migreringen startar *inte* från noll.

---

## 🌟 Funktioner

- **End-to-end-kryptering (v3):** AES-256-GCM + Argon2id, per-användarnyckel som wrappas
  under ett lösenordsderiverat root-key. Servern lagrar bara ogenomträngliga envelopes.
- **Aldrig blanka ut data:** `safeDecrypt` läser klartext, legacy (v1) och v3 utan att
  någonsin tappa innehåll vid fel.
- **AI-chatt:** lokala modeller på enheten, API-leverantörer (OpenRouter/Groq/Gemini) och
  **egna Hermes-agenter (Mac/Pi)** — alla med streaming, verktygskörning och förbrukningsmätning.
- **Offline-först & realtid:** notes/tasks målas lokalt direkt, dekrypteras i bakgrunden i
  bitar, och synkas via WSS när nätet är tillbaka.
- **Hierarki, rich-text, media, export, uppgifter, widgets, MCP-integrationer.**

## 🏗 Monorepo-struktur

```
noter-app/                 (npm workspaces + Turborepo)
├── apps/
│   ├── backend/           Express + Mongoose + Socket.io + JWT  (REST: se Doc/api-reference.md)
│   ├── web/               Next.js (App Router) + IndexedDB
│   ├── mobile/            Expo / React Native + SQLite + SecureStore
│   ├── nginx/             reverse proxy + säkerhetsheaders
│   ├── docs/              Docusaurus-sajt (publik)
│   └── firefox-extension/
├── packages/
│   ├── shared/            ⭐ ALL kryptering bor här (encrypt/cryptoV3/keyBootstrap) + typer
│   ├── ai/                delade AI-typer/hjälpare
│   └── ui/                delade UI-komponenter
electron-noter/            Electron desktop-app (safeStorage, sandbox, contextIsolation)
infra/pi/                  Pi-härdningsskript
Doc/                       ⭐ all dokumentation — börja i Doc/index.md
```

## 🚀 Kom igång

```bash
cd noter-app
npm install
npm run dev            # kör web + backend (+ delade paket) via Turbo
```

Mobil: `cd noter-app/apps/mobile && npx expo start`. Electron: `cd electron-noter && npm start`.

## ✅ Validering (kör innan commit/push)

```bash
cd noter-app
node scripts/validate-critical.mjs   # knip (död kod) + shared/backend/web/mobile/electron-tester + typecheck
```

Detta är den blockerande grinden: knip (ingen död kod), shared 43, backend 71, web 47,
mobil 84, electron 224. Allt grönt = redo.

## 🔐 Säkerhet

All kryptering är **centraliserad i `noter-app/packages/shared`** och versionerad med
envelopes (`v3:` innehåll, `v3w:` wrapped key, `U2FsdGVkX1` legacy). Vill du förbättra
säkerheten? Läs **[`Doc/security/security-upgrade-playbook.md`](Doc/security/security-upgrade-playbook.md)**
— den har receptet, single-source-kartan och en pre-commit-checklista. Hotmodell +
CWE-liggare finns i [`Doc/security/`](Doc/security/).

## 📄 Dokumentation

- **[`Doc/index.md`](Doc/index.md)** — master-index: var du börjar, hur dokumenten hänger ihop.
- [`Doc/api-reference.md`](Doc/api-reference.md) — backend-API:t (genererat från rutterna).
- [`Doc/security/`](Doc/security/) — kryptering, hotmodell, CWE, uppgraderingsplaybook.
- [`Doc/adr/`](Doc/adr/) — arkitekturbeslut (ADR).
- [`Doc/ops/`](Doc/ops/) — drift, CI-kvalitet, server-härdning, disaster recovery.

## 📱 Version

- **Mobil:** 1.1.0 (iOS build 6 / Android versionCode 7)
- **Electron:** 1.1.0 · **Backend:** 1.1.0 · **Web:** 0.1.0

Säkerhetsklassificering per release finns i `WHATS_NEW_ENTRIES`
(`noter-app/packages/shared/src/whatsNew.ts`) och exponeras live via
`GET /api/health/deep` (`version` + `securityLevel`).
