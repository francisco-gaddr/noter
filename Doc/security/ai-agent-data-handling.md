# AI-agentens datahantering & kryptering — vad servern ser och inte ser

**Status: implementerad 2026-06-16.** Den här filen är källan till sanning för hur AI-chatten
och AI-agenten skapar/ändrar data, hur det krypteras, hur det syns i realtid, och exakt vad
servern kan respektive **aldrig** kan läsa. Läs tillsammans med [`ai-locked-notes.md`](./ai-locked-notes.md)
(låsta noter), [`calendar-exposure.md`](./calendar-exposure.md) (egress) och
[`encryption-review-2026-06.md`](./encryption-review-2026-06.md) (kryptobasen).

Relaterade minnesanteckningar/kod: `apps/{mobile,web}` AI-chatt (`ai.tsx` / `AISidebar.tsx`),
`apps/backend/src/graphql/schema.ts`, `packages/shared/src/encrypt.ts` + `cryptoV3.ts`.

---

## 1. Kärninvarianten

> Innehåll i anteckningar/uppgifter som AI-agenten skapar eller ändrar är **end-to-end-
> krypterat med användarens nyckel** — exakt som en anteckning du skriver för hand.
> Servern lagrar chiffertext den **inte kan läsa**, i transit och i vila, på alla enheter.

Detta gäller titel, innehåll och taggar för noter/projekt/listor, samt titel + beskrivning
för uppgifter. Det gäller oavsett **hur** anteckningen skapas (chatt-verktyg, lokal modell,
API-modell) och **var** den lagras (Mongo på servern, lokal SQLite/IndexedDB, WSS-sync).

---

## 2. Dataflödet för ett verktygsanrop (create_note som exempel)

```
AI föreslår tool-call ──► klient: e2eNoteInput() krypterar title/content/tags med DIN nyckel
   (ai.tsx / AISidebar.tsx)        (encrypt() → v3 AES-256-GCM när E2E är inrullad)
        │
        ▼
GraphQL-mutation över HTTPS  ──►  payloaden är redan CHIFFERTEXT
        │
        ▼
backend createNote-resolver (schema.ts)
   encryptText() är IDEMPOTENT: isAnyCiphertext(värde) === true ⇒ släpps igenom ORÖRT
   (servern avkrypterar aldrig, omkrypterar aldrig under serverns nyckel)
        │
        ├─► lagras i Mongo som användar-chiffertext  (servern kan inte läsa)
        ├─► emitToUser('note:created', doc) över WSS  (andra enheter: dekrypterar med din nyckel)
        └─► returnerar doc (chiffertext) till klienten
        │
        ▼
klient: ingestServerNote() → materializeNotesFromEncrypted() → safeDecrypt() med din nyckel
   ⇒ anteckningen syns DIREKT i listan (ingen omladdning), läsbar bara för dig
```

**Nyckeldetaljer**
- `e2eNoteInput` / `e2eTaskInput` (klient): krypterar `title`, `content`, `tags`
  (+ task `description`) med `encrypt()` från `@repo/shared`. `encrypt()` använder v3-nyckeln
  (din nyckel) när E2E är aktiv, annars det äldre schemat — **samma** som en handskriven not.
- `encryptText` (backend, `schema.ts`): `if (isAnyCiphertext(s)) return s;` annars
  `encrypt(s)`. Den enda raden som garanterar att klient-chiffertext aldrig nedgraderas till
  serverns nyckel, och att äkta klartext (bakåtkompatibilitet) fortfarande krypteras i vila.
- `toNote` / `toTask` kör `decryptText`; på en v3-not utan användarnyckel (servern har den
  aldrig) returneras värdet **oförändrat** — dvs servern skickar tillbaka chiffertext, klienten
  dekrypterar.

**Låst i test:** `apps/backend/__tests__/graphql-tools.test.ts`
- *"a client-encrypted (v3) note value is stored UNCHANGED"* — servern omkrypterar aldrig.
- *"a PLAINTEXT note value is still encrypted at rest"* — bakåtkompatibilitet kvar.

---

## 3. Realtidssynk (skapas → syns direkt, alla enheter)

Två oberoende mekanismer, idempotenta mot varandra (dedup på `_id`):

1. **Lokal tillämpning (enheten som skapar):** efter mutationen kör verktyget
   `ingestServerNote` / `ingestServerTask` (+ `…Deletion`) i storen → noten syns omedelbart
   utan att vänta på socket-ekot eller en omladdning.
2. **WSS-broadcast (andra enheter):** backend `emitToUser(... 'note:created' ...)` skickar
   till hela användar-roomet; mobil + Electron dekrypterar med sin kopia av nyckeln.

Säkerhet: payloaden på WSS är samma användar-chiffertext. Bara enheter med nyckeln läser den.
Inget klartext-innehåll lämnar enheten via den här vägen.

**Tool-kort i chatten:** eftersom skriv-resultat kommer tillbaka E2E-krypterade (servern kan
inte dekryptera dem) bygger trace/summary kortet från AI:ns **egna klartext-argument** + nytt
`_id`, inte chiffertext-bloben. Inget kryptosvammel i korten; AI:n får läsbar bekräftelse.

---

## 4. Vad servern KAN och INTE KAN läsa

| Data | Servern kan läsa? |
|---|---|
| AI-skapad not/uppgift: titel, innehåll, taggar, beskrivning | **Nej** — användar-chiffertext (v3). |
| Metadata: typ, ordning, datum, prioritet, ikon | Ja — krypteras serverside med den äldre nyckeln (ej känsligt innehåll). |
| Låsta anteckningar/projekt | **Nej**, och AI:n får aldrig läsa/dekryptera dem — se [`ai-locked-notes.md`](./ai-locked-notes.md). |
| AI-chattmeddelanden (trådar) | E2E i synk-lagret (lokal-only-trådar lämnar aldrig enheten). |

**Två inneboende förbehåll (ärlighet):**
1. E2E använder **din nyckel om du är E2E-inrullad**; annars det äldre delade schemat (samma
   villkor som handskrivna noter i det läget). Status syns i krypto-inställningarna.
2. Genererar du innehåll via en **moln-AI-leverantör** (OpenRouter/Groq/Gemini m.fl.) har den
   leverantören sett texten **under genereringen** — inneboende i molnmodeller, skilt från
   lagringskrypteringen. Med en **lokal on-device-modell** (llama.rn) lämnar innehållet aldrig
   enheten okrypterat.

---

## 5. Stabilitet (ingen krasch ska kunna läcka eller haverera flödet)

- AI-skärmen är inkapslad i en skärm-scopad `CustomErrorBoundary`; render-fel ger ett
  återställbart kort, inte en svart app.
- Verktygs-/streamfel fångas och visas som ett systemmeddelande i chatten (kraschar aldrig).
- Alla lokala store-skrivningar i verktygsvägen är inkapslade (`try/catch`, non-fatal) så att
  ett misslyckande aldrig kan bryta verktygssvaret eller exponera halvtillstånd.
- Detaljer: minnesanteckning *project-mobile-ai-stability* + `components/ErrorBoundary.tsx`.

---

## 6. Var man ändrar detta framåt

| Vill du… | Rör |
|---|---|
| Ändra vilka fält som E2E-krypteras | `e2eNoteInput`/`e2eTaskInput` i `ai.tsx` + `AISidebar.tsx` (håll synkade) |
| Ändra serverns pass-through-regel | `encryptText` i `apps/backend/src/graphql/schema.ts` (behåll idempotensen + testerna) |
| Lägga till ett nytt skrivande verktyg | lägg E2E-wrappning + `ingestServer*`-tillämpning i bägge klienterna; lägg verktyget i `WRITE_TOOLS` |
| Verifiera garantin | `apps/backend/__tests__/graphql-tools.test.ts` (v3-pass-through + plaintext-bakåtkompat) |

ADR: [`../adr/0001-e2e-encryption.md`](../adr/0001-e2e-encryption.md) (kryptobasen) +
[`../adr/0009-e2e-for-ai-created-content.md`](../adr/0009-e2e-for-ai-created-content.md) (det här beslutet).
