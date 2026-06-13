# Säkerhets- & krypteringsplaybook (centraliserad)

_Senast uppdaterat: 2026-06-13 · Gäller mobil, web, Electron, backend, databas_

Den här filen är **en enda ingång** för att förstå och förbättra all kryptering
och säkerhet i Noter. Syftet är att framtida ändringar (även av nya AI-modeller)
ska vara enkla, säkra och utan blind spots: läs det här, följ receptet, kör testerna.

> Designprincip: **en källa till sanning för krypto** (`@repo/shared`), versionerade
> envelopes så att gammal data alltid kan läsas, och **aldrig blanka ut data** vid
> dekrypteringsfel. Alla appar (mobil/web/Electron) och backend importerar samma
> primitiver — ingen app har en egen kryptoimplementation.

---

## 1. Var ligger all kryptering? (single source of truth)

Allt bor i paketet `noter-app/packages/shared/src/`:

| Fil | Ansvar |
|-----|--------|
| `encrypt.ts` | Publikt API: `encrypt`, `decrypt`, `safeDecrypt`, `isLikelyEncrypted`, `isAnyCiphertext`, `setActiveDataKey`/`hasActiveDataKey`. Versions­dispatch mellan v1 (legacy) och v3. |
| `cryptoV3.ts` | v3-primitiver: AES-256-GCM (`encryptV3`/`decryptV3`), Argon2id/PBKDF2 KDF (`deriveRootKeyWithKdf`), nyckel-wrap (`wrapDataKey`/`unwrapDataKey`), recovery-koder, base64-codec. Konstanter: `V3_PREFIX='v3:'`, `V3_WRAP_PREFIX='v3w:'`, `ARGON2_PARAMS` (t=2, m=19456 KiB, p=1), `PBKDF2_ITERATIONS=200000`. |
| `keyBootstrap.ts` | Livscykel: `enrollOrUnlock`, `restoreFromDevice`, `recoverWithCode`, `lockCrypto`. `KEY_VERSION`. Plattforms­oberoende via `BootstrapDeps`-interface (varje app injicerar sin secure-store). |

Allt exporteras via `packages/shared/src/index.ts`. **Importera alltid härifrån**
(`import { safeDecrypt } from '@repo/shared'`), aldrig en lokal kopia.

### Envelope-format (hur vi vet vilken krypto en sträng använder)

| Prefix | Betydelse | Läses av |
|--------|-----------|----------|
| `U2FsdGVkX1…` | v1 legacy (CryptoJS AES-CBC) | `decrypt`/`safeDecrypt` (fallback) |
| `v3:…` | v3 innehåll (AES-256-GCM, krypterat under `dataKey`) | `decryptV3` via dispatch |
| `v3w:…` | v3 wrapped `dataKey` (krypterad under password-deriverad `rootKey`) | `unwrapDataKey` |
| (inget prefix) | klartext / redan dekrypterat | passeras igenom oförändrat |

`safeDecrypt(value, fallback)` är **never-blank-läsprimitiven**: klartext passerar
igenom, ciphertext dekrypteras, och vid fel returneras `fallback`/råvärdet — aldrig
`''`. Det är därför "tomma poster"-buggen inte kan återuppstå om man använder den.

---

## 2. Versionshantering & säkerhetsklassificering

Varje release bär en **säkerhetsklass** så att changeloggen blir en säkerhetsliggare:

- `SecurityClass` i `packages/shared/src/whatsNew.ts`:
  `security-critical | security-hardening | feature | maintenance`.
- Varje `WhatsNewEntry` får ett `security`-fält. Visas i appens "What's New".
- Backendens `/api/health/deep` exponerar `version` + `securityLevel` så att
  Uptime Kuma, hub.daylited och admin-vyn kan visa exakt vilken byggd + kryptopostur
  som kör live. `securityLevel` styrs av env `SECURITY_LEVEL` (default
  `v3-aes-gcm-argon2id`).
- App-versioner: `apps/mobile/app.json` (version + iOS `buildNumber` + Android
  `versionCode`), `electron-noter/package.json`, `apps/backend/package.json`.
  Håll dessa i takt med den senaste `WHATS_NEW_ENTRIES`-versionen.

**Regel:** bump:ar du krypto-postur → sätt `security: 'security-hardening'` (eller
`-critical`), uppdatera `SECURITY_LEVEL` och `WHATS_NEW_ENTRIES`, höj app-versionerna.

---

## 3. Recept: så här uppgraderar du krypteringen säkert (t.ex. v3 → v4)

Mål: lägg till ett starkare lager **utan** att göra någon befintlig data oläsbar.

1. **Lägg primitiven i `cryptoV3.ts` (eller ny `cryptoV4.ts`)** bredvid v3 — inte
   istället för. Definiera ett nytt prefix, t.ex. `V4_PREFIX='v4:'`.
2. **Lägg till i läs-dispatchen i `encrypt.ts`** (`decrypt`/`safeDecrypt`): känn igen
   `v4:` → `decryptV4`. v1/v3 fortsätter fungera (läs-bakåtkompatibilitet är ett krav).
3. **Skriv med nya lagret** först när du är säker: byt `encryptV3` → `encryptV4` i
   skriv-vägen. Eftersom läsning hanterar alla versioner är detta riskfritt.
4. **Backend write-guard:** lägg till det nya prefixet i `isEncryptedPayload`
   (`apps/backend/src/utils/encryption.ts`) — annars 400-avvisas alla nya writes.
   (Det här missades en gång för v3 — se T-incident i `cwe-mapping.md`.)
5. **Tester:** lägg round-trip + cross-version-läsning i
   `packages/shared/src/__tests__/cryptoV3.test.ts` och `encrypt.test.ts`.
6. **Klassificera:** uppdatera `SECURITY_LEVEL`, `WHATS_NEW_ENTRIES.security`,
   app-versioner.
7. **Migrering (valfri, lat):** klienter läser gammalt + skriver nytt vid nästa
   spara → datan migrerar av sig själv utan stor migration. Ingen big-bang.

Kör sedan `node noter-app/scripts/validate-critical.mjs` — krypto/shared gate:as först.

---

## 4. Per-lager-karta (vad är centraliserat vs lokalt)

| Lager | Använder `@repo/shared` för | Lokalt (plattformsspecifikt) |
|-------|------------------------------|------------------------------|
| **Mobil** | encrypt/decrypt/safeDecrypt, v3, keyBootstrap | Secure-store-adapter (expo-secure-store), SQLite-läsning via safeDecrypt |
| **Web** | samma | IndexedDB-adapter, sessionStorage för dataKey |
| **Electron** | samma | `safeStorage` secure store, sandbox/contextIsolation |
| **Backend** | `isEncryptedPayload` känner igen v1+v3-envelopes (write-enforcement) | Lagrar bara ciphertext; kan aldrig läsa `dataKey` (E2E) |
| **Databas** | — | MongoDB lagrar enbart envelopes; at-rest-disk skyddas + valfri KMS-wrap |

Transport: HTTPS/WSS överallt (HSTS via nginx, socket-auth i `io.use`). Data-at-rest
på enheter: secure-store för nycklar; full-fil-SQLCipher är dokumenterat som
nästa steg (se §5).

---

## 5. Kända luckor & framåtbacklog (inga blind spots)

- **SQLCipher full-fil-kryptering** på mobil/Electron-SQLite — i dag skyddas nycklar
  i secure-store och fält via v3, men hela DB-filen är inte krypterad. Stage-4.
- **ADR-0001** (`Doc/adr/`) status: v3-designen är implementerad; läs ADR:n för
  resterande E2E-arbete (per-note-lock-spänningen är dokumenterad i
  `encryption-review-2026-06.md`).
- **Per-thread E2E för AI** finns; lokal-only-trådar stannar krypterade på enheten.
- **Rotation av `dataKey`**: wrap-modellen stödjer det (re-wrap under ny rootKey);
  UI-flöde för "byt lösenord → re-wrappa" är nästa förbättring.

---

## 6. Snabb checklista innan du commitar en säkerhetsändring

- [ ] All krypto importeras från `@repo/shared` (ingen lokal kopia).
- [ ] Läsning är bakåtkompatibel (gammal data går fortfarande att läsa).
- [ ] `safeDecrypt` används i alla läs-vägar (aldrig blank-out).
- [ ] Backend `isEncryptedPayload` känner igen ev. nytt envelope-prefix.
- [ ] `SECURITY_LEVEL`, `WHATS_NEW_ENTRIES.security` och app-versioner uppdaterade.
- [ ] Tester i `shared` + ev. route-tester gröna; `validate-critical.mjs` passerar.
- [ ] Inga secrets loggas (`sanitizeLogInfo` täcker; jfr CWE-532 i `cwe-mapping.md`).

---

_Relaterat: [`cwe-mapping.md`](cwe-mapping.md) (STRIDE→CWE-liggare),
[`threat-model.md`](threat-model.md), [`encryption-review-2026-06.md`](encryption-review-2026-06.md),
[`../api-reference.md`](../api-reference.md)._
