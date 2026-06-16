# Nextcloud-synk — så fungerar den (steg för steg, stabilitet & säkerhet)

_Den tydliga driftguiden. Designbeslut/historik finns i [`nextcloud-ingestion.md`](./nextcloud-ingestion.md)
+ [`adr/0011-external-source-ingestion.md`](./adr/0011-external-source-ingestion.md)._
_Gäller mobil + Electron/web. Senast uppdaterat: 2026-06-16._

## I en mening

Appen agerar **WebDAV-klient mot din egenhostade Nextcloud**, hämtar **bara de mappar du valt**,
läser ut texten ur filerna (MD/text/PDF/Word/Excel/bild-OCR), **krypterar innehållet på din enhet**
och sparar det som vanliga (krypterade) anteckningar — som därmed blir sökbara, AI-läsbara och hamnar
i kunskapsgrafen. Nextcloud-lösenordet och filinnehållet lämnar **aldrig** din enhet i klartext.

---

## 1. Anslut (en gång)

Inställningar → **Nextcloud & kunskapsgraf** → *Lägg till anslutning*. Två sätt:

- **OAuth (rekommenderat):** ange din Nextcloud-värd → "Logga in via Nextcloud (OAuth)". Du loggar in
  i webbläsaren och **beviljar ett app-lösenord** automatiskt. Inget lösenord skrivs in i appen.
- **Manuellt:** värd + användarnamn + **app-lösenord** (Nextcloud → Inställningar → Säkerhet →
  Enheter & sessioner → skapa app-lösenord). Använd **aldrig** ditt kontolösenord.

Lösenordet lagras **krypterat på enheten** (mobil: iOS/Android Keychain via SecureStore; web/Electron:
krypterad localStorage) och skickas **aldrig** till Noter-servern. TLS (`https`) tvingas mot värden.

## 2. Välj mappar (det du vill inkludera)

På anslutningen → **"Välj mappar"**. Appen listar dina Nextcloud-mappar via PROPFIND och du **bockar i**
exakt vilka rot-mappar som ska synkas (du kan borra dig ned i undermappar). Du kan också skriva
mappnamn direkt (komma/radbrutet).

- **Bara de ikryssade rot-mapparna och deras undermappar** hämtas. Allt annat i din Nextcloud rörs
  aldrig (hård scope-gräns: `isUnderRoots`).
- Per anslutning kan du även sätta **auto-synk-intervall** (Manuell / 15 min / 1 tim / 6 tim) och
  **minsta kontextnivå** (Alltid / Från standard / Endast deep) — så en tung mapp bara tas med i
  AI-chatten på de nivåer du valt.

## 3. Vad som händer vid en synk (steg för steg)

```
"Synka nu"  (eller auto-synk när intervallet löpt ut, eller vid appstart)
   │
   1. PROPFIND under varje vald rot-mapp (Depth 1, rekursivt ned i undermappar)
   │     → lista över mappar + filer (med ETag, storlek, typ). Bara allowlistade filtyper.
   │
   2. DIFF mot redan synkade noter (planIngest):
   │     • ny fil            → SKAPA
   │     • ändrad fil (ETag) → UPPDATERA
   │     • borttagen fil     → RADERA noten
   │     • oförändrad ETag   → hoppa över (ingen onödig hämtning)
   │
   3. För varje SKAPA/UPPDATERA: hämta filen (GET) och läs ut text:
   │     MD/text → direkt · PDF → pdf.js · Word → mammoth · Excel → SheetJS
   │     bild → OCR (Tesseract) · Pages → inbäddad PDF-preview (best-effort)
   │     (på mobil körs PDF/Word/Excel/OCR i en dold WebView — inget native-beroende)
   │
   4. KRYPTERA på enheten (din dataKey, v3 AES-GCM) och spara som Note
   │     • mapp → projektmapp,  fil → anteckning nästlad under sin mapp
   │     • noten stämplas med proveniens (källa = Nextcloud, sökväg, ETag)
   │
   5. INDEXERA om (semantisk vektor-index) så filerna blir sökbara/AI-läsbara
   │
   6. Spara lastSyncAt på anslutningen (styr nästa auto-synk)
```

Resultatet syns direkt i appen (realtid via websockets) på alla dina enheter.

## 4. Stabilitet — vad som gör den robust

- **Idempotent:** kör du synken igen utan ändringar händer ingenting (ETag-diff). Samma fil skapar
  aldrig dubletter — identitet = `källa + sökväg`.
- **Inkrementell:** bara filer vars **ETag ändrats** hämtas om. Stora bibliotek synkar snabbt.
- **Fel isoleras per fil:** en trasig/oläsbar fil hoppas över — resten av synken fortsätter.
- **Tak mot rymd-skenande:** max 300 mappar / 5000 filer per synk, PDF ≤ 8 MB, text kapas vid 24k
  tecken. Skyddar minne och nät.
- **Timeouts:** varje text-extraktion har en tidsgräns (PDF/Word/Excel 30s, OCR 60s) så en hängande
  fil aldrig låser synken.
- **Self-heal (nytt):** om en PDF/Word/Excel/bild **inte gick att läsa ut** just då (t.ex. extraktor-
  motorn hann inte starta vid appstart, eller ett tillfälligt nätfel) sparas en **tom ETag** så att
  **nästa synk automatiskt försöker igen** — i stället för att fastna på en tom anteckning. På mobil
  väntar synken dessutom kort (upp till 6s) på att extraktor-motorn ska bli redo innan den börjar.
- **Offline-säker:** ingen nätverk → synken misslyckas mjukt med ett felmeddelande; inget tappas, kör
  igen när du är online.
- **Auto-synk:** anslutningar med intervall synkas när du öppnar inställningarna och när intervallet
  löpt ut (`isSyncDue`), utöver manuell "Synka nu".

## 5. Säkerhet — vad som skyddas och hur

| Skydd | Hur |
|-------|-----|
| **Nextcloud-lösenord stannar på enheten** | App-lösenord lagras krypterat lokalt (SecureStore / safeStorage / krypterad localStorage). Skickas **aldrig** till Noter-servern. |
| **App-lösenord, inte kontolösen** | OAuth-flödet (eller du själv) skapar ett **återkallbart app-lösenord** i Nextcloud — dra in det när som helst utan att röra kontot. |
| **TLS tvingas** | All trafik mot Nextcloud körs över `https` (avvisas annars, utom uttrycklig localhost/LAN). |
| **Bara valda mappar** | PROPFIND scopas hårt under de ikryssade rot-mapparna. Inget utanför hämtas. |
| **E2E bevaras** | Filtext **krypteras på enheten** med din nyckel innan den sparas. Noter-backenden lagrar bara chiffertext den inte kan läsa — den vet inte ens *att* en not kom från Nextcloud. |
| **Fil-bytes lämnar aldrig enheten** | PDF/Word/Excel/bild läses ut lokalt (i appen / i en lokal dold WebView). Inget skickas till någon tredje part för tolkning. |
| **Lås-medvetet** | Lägger du en synkad mapp under en **låst** projektmapp filtreras hela det subträdet bort av samma lås-grind som skyddar allt annat — det indexeras aldrig och AI:n läser det aldrig (se [`security/ai-locked-notes.md`](./security/ai-locked-notes.md)). |
| **Omedelbar återkallning** | Radera anslutningen → app-lösenordet wipas från enheten. (Du väljer om de redan synkade anteckningarna ska behållas eller städas.) |

## 6. Var i koden

| Del | Plats |
|-----|-------|
| WebDAV-klient + diff + extraktion + synk | `apps/{mobile,web}/services/nextcloud.ts` |
| OAuth Login Flow v2 | `packages/shared/src/nextcloudAuth.ts` + `startNextcloudOAuth` i tjänsterna |
| Textextraktion (PDF/Word/Excel/bild) | web `apps/web/services/ai/fileText.ts`; mobil WebView `apps/mobile/components/PdfExtractorHost.tsx` + `services/ai/pdfText.ts` |
| Diff/identitet/proveniens | `packages/shared/src/fileIngest.ts` (`planIngest`, `NoteSource`) |
| Filklassificering + ETag-parsning | `packages/shared/src/webdavClient.ts` (`classifyFile`, `isSyncDue`, `parsePropfindXml`) |
| Inställnings-UI (anslutning + mappväljare) | `apps/web/components/NextcloudSettings.tsx`, `apps/mobile/components/NextcloudSettings.tsx` |
| Selektiv Neo4j-spegling | `packages/shared/src/neo4jSync.ts` + backend `routes/neo4j.ts` |

## 7. Begränsningar (ärligt)

- **.pages på mobilen** läses ännu inte ut (iWork-protobuf saknar bra JS-lib) → sparas som
  proveniens-anteckning. På web/Electron extraheras den inbäddade PDF-previewen om den finns.
- **Skannade PDF:er utan textlager** ger lite/ingen text på web (pdf.js läser textlager, inte OCR av
  sidan); på mobil/Nextcloud kan bild-OCR-vägen användas för rena bilder.
- Extraktion kräver nät (CDN-laddade motorer på mobil; web buntar Word/Excel men OCR/övrigt via CDN).
