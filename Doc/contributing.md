# Att lägga till förbättringar säkert (kom-igång för oss + AI-agenter)

_Senast uppdaterat: 2026-06-14. Kort, praktisk checklista. Detaljer finns i [`index.md`](./index.md)._

Målet: göra det **enkelt och säkert** att lägga in förbättringar utan att bryta paritet, kryptering eller bygget. Följ ordningen nedan.

## 1. Var lägger jag koden?

| Det jag bygger | Lägg det här |
|---|---|
| Logik som båda apparna behöver (modeller, beräkningar, krypto, parsing) | `packages/shared/src/` — **rent + enhetstestat**, importeras av web + mobil |
| Web/Electron-UI | `apps/web/` (Electron återanvänder web-bygget) |
| Mobil-UI | `apps/mobile/` |
| Backend (REST/GraphQL/socket) | `apps/backend/src/` |

**Regel:** dela alltid gemensam logik i `@repo/shared` så ändringen slår igenom i båda apparna utan dubbelarbete (särskilt kryptering — se §3). Bygg paritet: en feature i den ena appen ska finnas i den andra.

## 2. Bygg → testa → verifiera (innan commit)

```bash
# 1. shared först (apparna konsumerar dist/)
cd noter-app/packages/shared && npx tsc && npx jest
# 2. typecheck apparna
cd ../../apps/web && npx tsc --noEmit
cd ../mobile && npx tsc --noEmit
# 3. tester
cd ../web && npx jest            # 121 gröna
cd ../../../electron-noter && npx jest   # 224 gröna
cd ../noter-app/apps/mobile && npx jest  # ~350 gröna (#12: 6 render-sviter kvar)
# 4. byggen
cd ../web && npm run build
cd ../../../electron-noter && node src/build-web.js   # Electron statisk export
# 5. kritisk grind
node noter-app/scripts/validate-critical.mjs
```

Backenden auto-deployas till Pi vid push till `dev` (hälsokoll + rollback). Ändrar du bara mobil/Electron behövs ingen deploy.

## 3. Säkerhetschecklista (läs innan du rör data eller transport)

De **omistliga invarianterna** (full lista i [`index.md`](./index.md) §3):

1. **Inget i klartext** — DB, server-disk eller enhet. Skriv via `encrypt`, läs via `safeDecrypt` (aldrig blank-out). Detta gäller även **inställningar** (AI-leverantör/modell/nycklar, token) — se [`admin-orchestration-and-settings.md`](./admin-orchestration-and-settings.md) §5.
2. **Krypto importeras bara från `@repo/shared`** — ingen app har egen implementation.
3. **Varje `/:id`-rutt scopar på `userId`** (IDOR). Grep-check: `findById(` i `routes/`.
4. **All WebSocket via WSS i produktion** — klienterna kör `enforceSecureSocketUrl`; lägg aldrig en `ws://`-väg som kan nås i produktion. CSP `connect-src` tillåter bara `https:`/`wss:`.
5. **AI läser aldrig låsta anteckningar/projektmappar** — filtrera via `@repo/shared/locks` innan innehåll når modell, minne eller index (gäller även semantisk sök).
6. **Logga aldrig hemligheter** (token/nyckel/lösenord/klartext-innehåll).
7. **Lägg till, ersätt inte** i krypto-läsdispatchen — gammal data (v1) måste alltid kunna läsas.

Ny känslig at-rest-yta? Spegla mönstret: `encrypt()` på skrivning, `safeDecrypt()` på läsning, och ett litet enhetstest. Klassificera släppet i `whatsNew.ts` (`security-critical` / `security-hardening`).

## 4. Versionsbump + What's New (en enda källa)

`packages/shared/src/whatsNew.ts` → `WHATS_NEW_ENTRIES[0]` driver versionen som **båda apparna** visar. Vid ett släpp:

1. Lägg en ny post överst i `WHATS_NEW_ENTRIES` (`version`, `build`, `date`, `security`, `highlights`).
2. Spegla `version` i `apps/mobile/app.json` (+ höj `ios.buildNumber` och `android.versionCode`) och i `electron-noter/package.json`.
3. `cd packages/shared && npx tsc` så apparna plockar upp den.

## 5. Android EAS-bygge

Projektet har en committad `android/`-katalog (prebuild-committed). EAS bygger från den.

```bash
cd noter-app/apps/mobile
npx expo-doctor              # ska vara 18/18 (patch-versioner i synk)
npx expo install --check     # rätta ev. SDK-versionsavvikelser
eas build -p android --profile preview   # APK för intern distribution
```

- `eas.json`: `appVersionSource: "remote"`, `production.autoIncrement: true` (EAS sköter build-nummer).
- På-enheten-LLM (MLC) är **inte** inlänkad i standardbygget → bygget bryts inte av det (JS:en hanterar avsaknad modul). Se [`improvements-remaining-2026-06-14.md`](./improvements-remaining-2026-06-14.md) §1 för llama.rn-vägen.
- Fälla att se upp för (merge-rot): kontrollera att inga deps tappats ur `package.json` efter en merge innan bygget.
