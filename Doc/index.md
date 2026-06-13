# Noter — dokumentationsindex (börja här)

_Senast uppdaterat: 2026-06-13 · Målgrupp: AI-agenter, utvecklare, reviewers_

Det här är **master-ingången** till all dokumentation. Syftet är att en ny AI-agent
eller utvecklare ska kunna ta vid **utan att gissa** — du ska alltid veta vilken fil du
ska öppna för en given fråga. Läs det här först, sedan den specifika filen.

> **Två andra ingångar att känna till:**
> - [`../README.md`](../README.md) — projektöversikt, stack, kom-igång, valideringskommando.
> - `~/.claude/.../memory/MEMORY.md` — persistent agent-minne (drift-hemligheter, Pi-deploy,
>   krypto-arkitektur, IDOR-regeln). Läses in automatiskt per session.

---

## 1. Vägvisare — "jag vill …" → öppna denna fil

| Jag vill … | Öppna |
|------------|-------|
| Förstå systemet på hög nivå | [`Overview.md`](./Overview.md) |
| Se backend-API:t (rutter, auth, rate limits) | [`api-reference.md`](./api-reference.md) |
| **Förbättra säkerhet/kryptering** | [`security/security-upgrade-playbook.md`](./security/security-upgrade-playbook.md) ⭐ |
| Förstå hotmodellen | [`security/threat-model.md`](./security/threat-model.md) |
| Se STRIDE→CWE-liggaren (audit) | [`security/cwe-mapping.md`](./security/cwe-mapping.md) |
| Förstå nuvarande krypto-läge & spänningar | [`security/encryption-review-2026-06.md`](./security/encryption-review-2026-06.md) |
| Veta varför ett arkitekturbeslut togs | [`adr/`](./adr/) (ADR-register) |
| Driftsätta / härda servern | [`ops/server-hardening.md`](./ops/server-hardening.md), [`ops/disaster-recovery.md`](./ops/disaster-recovery.md) |
| Förstå CI/kvalitet & död-kod-grinden | [`ops/ci-quality.md`](./ops/ci-quality.md) |
| Förstå AI-runtime (web/mobil/Electron) | [`App AI.md`](./App%20AI.md), [`AI impl.md`](./AI%20impl.md) |
| Förstå AI tool-use + GraphQL-kontrakt | [`Tool Calls.md`](./Tool%20Calls.md) |
| Förstå widgets | [`widgets-architecture.md`](./widgets-architecture.md) |
| Se vad som återstår / nästa steg | [`improvements.md`](./improvements.md) + §4 nedan |
| Skriva en incident-postmortem | [`incidents/TEMPLATE.md`](./incidents/TEMPLATE.md) |

## 2. Hur koden är organiserad (var saker bor)

| Område | Plats | Notis |
|--------|-------|-------|
| **All kryptering** | `noter-app/packages/shared/src/` | `encrypt.ts` (dispatch), `cryptoV3.ts` (AES-GCM/Argon2id), `keyBootstrap.ts`. **Importera bara härifrån.** |
| Backend-rutter | `noter-app/apps/backend/src/routes/` | Varje `/:id`-rutt **måste** scopa på `userId` (se IDOR-regeln, §3). |
| Backend write-guard | `…/src/utils/encryption.ts` | `isEncryptedPayload` accepterar v1+v3-envelopes. |
| Mobil-state/sync | `noter-app/apps/mobile/stores/useStore.ts` | Offline-först, chunked dekryptering. |
| Mobil-AI-leverantörer | `…/mobile/services/ai/apiProviders.ts` | Registry; lägg till leverantör här + binding i `ai.tsx`. |
| Web-API-klient | `noter-app/apps/web/services/api.ts` | `decryptNoteFromApi`/`decryptTaskFromApi`. |
| Versionshantering | `packages/shared/src/whatsNew.ts` | `WHATS_NEW_ENTRIES` + `SecurityClass` per release. |
| Hälsa/observability | `…/backend/src/routes/healthDeep.ts` | `GET /api/health/deep` → `version` + `securityLevel`. |

## 3. Invarianter som ALDRIG får brytas (läs innan du ändrar kod)

1. **Inget i klartext** lagras/skickas — DB, serverdisk eller enhet. Skriv via `encrypt`,
   läs via `safeDecrypt` (aldrig blank-out).
2. **Varje `/:id`-rutt scopar på `userId`** (eller tenant). Ogjort → IDOR. Grep-check:
   `findById(` i `routes/`. Regression: `__tests__/routes/ownership-isolation.test.ts`.
3. **Läsning är bakåtkompatibel** — gammal data (v1) måste alltid gå att läsa när nytt
   krypto-lager läggs till. Lägg till, ersätt inte, i läs-dispatchen.
4. **Krypto importeras bara från `@repo/shared`** — ingen app har egen implementation.
5. **Logga aldrig secrets** (`sanitizeLogInfo`; CWE-532). Runtime-loggar är gitignorerade.
6. **Kör `node noter-app/scripts/validate-critical.mjs` grönt** innan commit.

## 4. Nästa steg / förbättringsbacklog (konkret, prioriterad)

Status 2026-06-13. Uppdatera den här listan när poster blir klara.

**AI-chatt (mobil):**
- [ ] Filuppladdning i chatten (PDF/MD/bilder) + tolkning per källa (lokal/API/Hermes).
- [ ] Per-tråd: välj synkad E2E vs lokal-only-tråd (krypterad endast på enheten).
- [ ] Enhetsvalidering av lokal modell: nedladdning → konvertering → inläsning → chatt.

**Admin/observability:**
- [ ] Utbyggd admin-dashboard som *mäter* (AI-förbrukning, sync-kö, health) och *konfigurerar*.
- [ ] Koppla `securityLevel`/`version` från health till dashboard-vyn + Uptime Kuma.

**Säkerhet/krypto:**
- [ ] SQLCipher full-fil-kryptering (mobil/Electron SQLite) — Stage-4.
- [ ] UI-flöde för lösenordsbyte → re-wrap av `dataKey` (rotation).
- [x] Mekanisk IDOR-grind: `scripts/check-route-scoping.mjs` (i `validate-critical`).

**Hard-review:**
- [x] ai/sync push/pull + mcp-rutter granskade — korrekt userId-scopade (ingen IDOR).
      Regression: `__tests__/routes/ai-sync-isolation.test.ts` (två användare).

**Validerat & klart:** IDOR-fix + mekanisk grind, ai/sync+mcp-review, v3-krypto,
Hermes-källa, chunked perf, version 1.1.0 + säkerhetsklassificering, health-version,
API-referens, säkerhetsplaybook, README + index.md.

## 5. Konventioner för dokumentationen

- **Sanning över ambition:** dokument ska spegla *faktisk kod*, inte planerad målbild.
  Markera tydligt om något är "föreslaget/ej implementerat" (jfr ADR-status).
- **En källa till sanning:** krypto-fakta bor i playbooken; API-fakta i `api-reference.md`.
  Länka dit istället för att duplicera.
- **Säkerhetsändringar** loggas i `cwe-mapping.md` (liggare) + `WHATS_NEW_ENTRIES.security`.
- **Incidenter** → `incidents/` (mall finns). **Beslut** → `adr/` (mall finns).
- Äldre filer (`Mobile implementation.md`, `AI mobile.md`, m.fl.) är **referens** om de inte
  uppdaterats i samma ändringspaket — verifiera mot koden innan du litar på dem.

---

_Den här filen är navigeringen. [`README.md`](../README.md) är översikten._
_Håll §4 (nästa steg) och §2 (var saker bor) aktuella när du levererar._
