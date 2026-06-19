# Error & crash tracking — self-hosted GlitchTip

_Senast uppdaterat: 2026-06-19 · Målgrupp: oncall, ops_

Vi kör **GlitchTip** (open source, Sentry-API-kompatibel) **self-hosted på Pi:n** för fel- och
krasch-spårning. Den är **opt-in** (compose-profil `monitoring`) och länkas från Pi-Hubben på port
`:8000`. Apparna rapporterar via en **delad reporter** — inget per-plattform-SDK.

## Varför en egen reporter istället för `@sentry/*`

`@sentry/react-native` kräver native-moduler → ett native-bygge, vilket krockar med projektets hårda
**no-EAS-regel**. Lösningen: [`packages/shared/src/errorReporter.ts`](../../noter-app/packages/shared/src/errorReporter.ts)
talar **Sentrys envelope-protokoll** direkt över `fetchWithRetry`. Samma kod fungerar på node, i
webbläsaren och i Hermes/RN — och vi kontrollerar **exakt** vad som lämnar enheten (kritiskt för
E2E/integritet). Noll nya beroenden. Inaktiverad (no-op) tills en DSN sätts.

| Yta | Status | Init |
| --- | --- | --- |
| Backend (node) | ✅ aktiv | `apps/backend/src/utils/errorTracking.ts` (init i `index.ts`, fångar 5xx + `uncaughtException`/`unhandledRejection`) |
| Web (Next.js) | ✅ aktiv | `apps/web/services/errorTracking.ts` (klient-init i `providers.tsx`; `window.onerror` + `unhandledrejection`) |
| Mobil (Expo RN) | ✅ aktiv | `apps/mobile/services/errorTracking.ts` (init i `_layout.tsx`; `ErrorUtils.setGlobalHandler` kedjad + Hermes `enablePromiseRejectionTracker`) |

**DSN per yta** (alla no-op om osatt; klient-DSN:er bakas in vid BUILD och kräver ombygge vid ändring):
- Backend: `GLITCHTIP_DSN` (runtime, i `.env`).
- Web: `NEXT_PUBLIC_GLITCHTIP_DSN` (build-arg; sätt `GLITCHTIP_WEB_DSN` i `.env` → compose skickar in den).
- Mobil: `EXPO_PUBLIC_GLITCHTIP_DSN` (bakas in i bundlen vid Metro-build).
Skapa gärna **separata projekt** i GlitchTip per yta (backend/web/mobil) så felen grupperas rätt.

## Vad som skickas — och ALDRIG skickas

Reportern scrubbar varje event innan sändning ([`scrubValue`](../../noter-app/packages/shared/src/errorReporter.ts)):
nycklar som innehåller `password/token/secret/auth/content/title/body/ciphertext/email/jwt/dsn` m.fl.
ersätts med `[redacted]`, långa strängar trunkeras.

- **Skickas:** feltyp + meddelande + stack-frames, `route` (mönster, ej värden), HTTP-status,
  `requestId` (korrelerar med strukturerad logg), **opak** `userId`, miljö, release.
- **Skickas ALDRIG:** anteckningsinnehåll/titlar, request-body, headers, tokens, API-nycklar, lösenord,
  krypto-material. Backend-wiring:n passerar medvetet bara route/status/requestId/userId — aldrig body.

## Förstagångs-setup på Pi:n

1. Lägg i den gitignorerade `.env` bredvid `docker-compose.yml`:
   ```sh
   GLITCHTIP_POSTGRES_PASSWORD=<slumpa, t.ex. openssl rand -hex 24>
   GLITCHTIP_SECRET_KEY=<slumpa, t.ex. openssl rand -hex 32>
   GLITCHTIP_DOMAIN=http://<pi-host>:8000     # publik URL till UI:t (för länkar i mejl)
   # valfritt: GLITCHTIP_EMAIL_URL=smtp://...  GLITCHTIP_FROM_EMAIL=noreply@dindomän
   ```
2. Starta monitoring-stacken (postgres + valkey + web + worker + migrate):
   ```sh
   docker compose --profile monitoring up -d
   ```
3. Öppna `http://<pi-host>:8000`, skapa det första kontot (öppen registrering är **av** —
   första användaren blir admin), skapa en **organisation** + ett **projekt** (plattform: Node).
4. Kopiera projektets **DSN** och lägg i `.env`:
   ```sh
   GLITCHTIP_DSN=https://<public_key>@<pi-host>:8000/<project_id>
   ```
5. Starta om backend så den läser DSN:en: `docker compose up -d backend`.
   Vid boot loggar den `error-tracking: enabled (GlitchTip)`.

## Verifiera

Trigga ett 5xx (eller `throw` i en route i staging) och bekräfta att eventet dyker upp i GlitchTip-
projektet inom någon sekund. Saknas det: kontrollera att DSN:en stämmer, att `glitchtip-migrate`
gick klart (`docker compose logs glitchtip-migrate`) och att backend loggade `enabled`.

## Hub-länk

Endast UI-porten `:8000` publiceras (postgres/valkey är interna). Lägg till en kakel i Pi-Hubben:
**GlitchTip — fel & krascher → `http://<pi-host>:8000`**.

## Drift

- **Resurser:** stacken drar ~512 MB RAM. `WEB_CONCURRENCY=1` + låg celery-autoscale är satt för Pi:n.
  ~1M events/månad ≈ 30 GB disk — sätt en retention i projekt-inställningarna.
- **Uppgradering:** `docker compose --profile monitoring pull && docker compose --profile monitoring up -d`
  (migrationer körs av `glitchtip-migrate` automatiskt).
- **Stäng av:** lämna bort `--profile monitoring` (default-deployen rör den aldrig). Apparna blir
  automatiskt no-op när `GLITCHTIP_DSN` saknas.

## Kvar (nästa steg)

Release-tagg-flöde fullt ut: web läser redan `NEXT_PUBLIC_BUILD_ID` och mobil `EXPO_PUBLIC_BUILD_ID`
som release — sätt dessa till git-sha i bygget så GlitchTip kan visa "first seen in release X" och
regressions-spårning. Ev. källkarta-uppladdning för web (minifierade stackar) om det behövs.
