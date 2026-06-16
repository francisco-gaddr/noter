# Nextcloud-ingestion — synka in utvalda mappar som krypterad, indexerbar kontext

_Status: **Fas 1 påbörjad** — delad kärna + `NoteSource`-fält + self-hostad Neo4j-infra levererade & testade; plattformstjänster + UI nästa. Beslut: [`adr/0011-external-source-ingestion.md`](./adr/0011-external-source-ingestion.md)._
_Senast uppdaterat: 2026-06-16._

## Levererat hittills (Fas 1, steg 1)

- **Delad kärna (ren, ES5-säker, enhetstestad — 28 tester):**
  `packages/shared/src/webdavClient.ts` (PROPFIND-body + multistatus-XML-parsning,
  TLS-tvång, scope-filter under valda rötter, filtyp-allowlist), `fileIngest.ts`
  (`NoteSource` + `planIngest` create/update/delete-diff via remote-ETag), `neo4jSync.ts`
  (per-mapp-urval + lås-grind + parametriserad Cypher MERGE/PRUNE).
- **`NoteSource`-fält** på `Note` (delad typ) + krypterat `source`-fält i backend
  `Note`-modellen + REST-passthrough (samma idempotenta `encryptText` som `links`).
- **Self-hostad Neo4j** i `docker-compose.yml` bakom compose-profilen `neo4j`
  (internt nätverk endast, aldrig publicerad; auth via `.env`; opt-in kill-switch
  `NEO4J_ENABLED`).

Kvar i Fas 1: plattformstjänster (on-device WebDAV-klient + ingest + Neo4j-relä) och
inställnings-UI (anslutning + per-mapp-urval) — paritet mobil + Electron/web.

## Målbild (vad användaren bad om)

> "Egenhostad Nextcloud med filer och mappar. Utvalda mappar ska kunna synkas in och
> användas i min kontext … ladda upp PDF:er, MD-filer, bilder i en specifik mapp eller
> skapa undermappar, och allt ska kunna indexeras semantiskt + in i kunskapsgrafen (Neo4j
> etc), användas i de kontextnivåer jag valt — säkert och krypterat, bara på de utvalda
> mapparna."

Konkret: koppla en Nextcloud-instans, **välj specifika mappar** (med undermappar), och få
deras innehåll (PDF/MD/bilder/text) **indexerat semantiskt + i grafen** och **tillgängligt
som AI-kontext** enligt vald kontextnivå — med **bevarad E2E** och **per-mapp-kontroll**.

## Kärninsikt: vi vänder på dataflödet

Den befintliga externa Markdown-syncen ([`external-markdown-sync.md`](./external-markdown-sync.md))
och CalDAV-bryggan ([`caldav-bridge.md`](./caldav-bridge.md)) gör appen till en **DAV-
*server*** — den projicerar *våra egna* noter utåt. **Appen har aldrig varit en DAV-
*klient*.** Nextcloud-ingestion är det **omvända flödet**: appen blir en **WebDAV-klient**
som *drar in* externa filer.

Den goda nyheten: allt **nedströms** finns redan och arbetar på `Note`-objekt —
`buildIndexableEntities` → embeddings, `buildGraph`, två-stegs-RAG
([`ai-retrieval-rag.md`](./ai-retrieval-rag.md)), lås-grinden, realtid. Så **~70 % är
återbruk**; det nya är i princip *en on-device WebDAV-klient + en ingest-pipeline som
landar varje fil som en krypterad `Note`*. När filen väl är en `Note` "bara funkar" sök,
graf, kontextnivåer och lås.

```
Nextcloud (WebDAV)                    PÅ ENHETEN (håller dataKey)                 Noter-backend
┌────────────────┐  PROPFIND/GET   ┌──────────────────────────────────┐  ciphertext   ┌──────────┐
│ /Valda/…       │ ───────────────▶│ 1 WebDAV-klient (app-lösenord)   │              │ Mongo    │
│  ├ rapport.pdf │   (TLS, ETag)   │ 2 textextraktion (pdf/md/bild)   │  encrypt()   │ (krypterad│
│  ├ note.md     │                 │ 3 → Note {source:'nextcloud'}    │ ────────────▶│  Note som │
│  └ /undermapp  │                 │ 4 encrypt med dataKey            │              │  vanligt) │
└────────────────┘                 │ 5 buildIndexableEntities→index   │              └──────────┘
                                    │   buildGraph (i minnet)          │   (servern kan ALDRIG
                                    └──────────────────────────────────┘    läsa innehållet)
```

Nextcloud-credentials **lämnar aldrig enheten**; filinnehåll **krypteras på enheten** innan
det ev. lagras hos Noter-backenden — exakt som AI-skapade noter
([`adr/0009-e2e-for-ai-created-content.md`](./adr/0009-e2e-for-ai-created-content.md)).

---

## Best practices — anslutning till Nextcloud (juni 2026)

| Aspekt | Val | Varför |
|--------|-----|--------|
| **Protokoll** | WebDAV på `https://<host>/remote.php/dav/files/<user>/<path>` | Nextclouds officiella fil-API; standard PROPFIND/GET. |
| **Auth** | **App-lösenord** (Nextcloud → Inställningar → Säkerhet → Enheter & sessioner) — *inte* kontolösenordet | Per-enhet, kan återkallas separat, kringgår 2FA korrekt. Bästa praxis. |
| **Auth (uppgradering)** | OAuth2 **Login Flow v2** (`/index.php/login/v2`) | Inget lösenord lagras alls; appen får en token användaren godkänner i webbläsaren. Fas 2. |
| **Transport** | Tvinga **TLS** (avvisa `http://` utom för uttrycklig LAN-localhost) | Credentials + innehåll i transit. Speglar WSS-regeln i appen. |
| **Inkrementell sync** | Spara per-fil **ETag** + `Last-Modified`; använd `If-None-Match` vid GET; PROPFIND `Depth: 1` per mappnivå | Hämta bara ändrat. Nextcloud stödjer ETags + `oc:checksums`. Undvik full re-fetch. |
| **Stora filer** | Strömmad/chunkad nedladdning, storleks-tak + filtyp-allowlist | Skydda mobil-minne och Pi-bandbredd. |
| **Selektivitet** | PROPFIND bara under de **valda root-mapparna**; aldrig hela `/files/<user>` | "Bara de utvalda specifika mapparna" — hård scope-gräns. |
| **Polling** | Manuell "Synka nu" + intervall (t.ex. 15/60 min) via befintlig bakgrunds-scheduler | Nextcloud saknar push till klient; ETag-poll är billigt. (Notify-app finns men är opt-in serverside.) |

**Filtyper (allowlist) och hur de blir text:**

| Typ | Behandling | Återbruk |
|-----|-----------|----------|
| `.md`, `.txt`, kod, `.json`, `.csv` | UTF-8 rakt av → `note.content` | `aiAttachments.hasReadableText` |
| `.pdf` | Textextraktion → `note.content` (web/Electron: `pdfjs-dist` i `apps/web/services/ai/pdfText.ts`; mobil: native, **kvar**) | `extractAttachmentText`/`attachmentToGraphNote` |
| bild (`png/jpg/…`) | (a) vision-beskrivning via modell och/eller (b) OCR → text; original sparas som bilaga för vision | befintlig vision-väg (`imageDataUrls`/`parseDataUrl`) |
| övrigt binärt | metadata-nod (namn/typ/storlek), ingen text | placeholder-mönstret |

---

## Datamodell — filer blir krypterade `Note`-noder

Vi **återanvänder `Note`** istället för en ny entitet, så graf/sök/kontext/lås gäller utan
specialfall. En synkad Nextcloud-mapp blir en **projektmapp** (`type:'project'`), undermappar
nästlas via `parentId`, och varje fil blir en `note` under rätt förälder.

**Schema-tillägg (litet, krypterat):** ett nytt valfritt fält `source` på `Note` (krypterad
JSON, exakt som `links` redan hanteras i `apps/backend/src/models/Note.ts`):

```ts
// klartext på enheten; krypteras före lagring
source?: {
  origin: 'nextcloud';
  connectionId: string;     // vilken Nextcloud-anslutning
  remotePath: string;       // "/Valda/rapport.pdf"
  remoteEtag: string;       // för inkrementell diff
  remoteModified: string;   // ISO
  mimeType: string;
  syncedAt: string;         // ISO
}
```

Backend lagrar fältet som ogenomskinlig chiffertext (samma `encryptText`-idempotens som
idag — chiffertext passerar oförändrad). Servern vet alltså inte ens *att* en not kom från
Nextcloud. `source` ger oss: dedupe (matcha `connectionId+remotePath`), inkrementell diff
(jämför `remoteEtag`), och proveniens i UI ("Synkad från Nextcloud: …").

**Mappning Nextcloud → Noter:**
```
/Valda/Forskning/            → Note{type:'project', title:'Forskning', source:{…}}
/Valda/Forskning/x.pdf       → Note{type:'note', parentId:<Forskning>, content:<pdf-text>, source:{…}}
/Valda/Forskning/Under/      → Note{type:'project', parentId:<Forskning>, …}
/Valda/Forskning/Under/y.md  → Note{type:'note', parentId:<Under>, …}
```

---

## Indexering, graf och kontext — gratis när filen är en `Note`

- **Semantisk indexering:** en synkad not går genom `buildIndexableEntities`
  (`packages/shared/src/vectorStore.ts`) → `diffIndex` → `embedTexts` → krypterat
  on-device-index, precis som handskrivna noter. `diffIndex` re-embeddar bara vid
  innehållsändring (content-hash) — perfekt match med ETag-driven sync. Källa för
  embeddings rekommenderas vara **on-device / Pi-Ollama** så innehållet aldrig når tredje
  part (samma princip som [`graph-explorer.md`](./graph-explorer.md)).
- **Kunskapsgraf:** `buildGraph(notes, tasks)` tar med noten automatiskt; mapp-nästlingen
  ger `in_project`-kanter, sibling/explicit-länkar fungerar. Ingen ändring i grafmodellen.
- **Två-stegs-RAG i chatten:** `retrieveForChat` opererar redan på alla läsbara noter →
  synkade filer dyker upp i recall + GraphRAG + rerank ([`ai-retrieval-rag.md`](./ai-retrieval-rag.md)).
- **Kontextnivåer:** synkade noter lyder samma `contextLevels`-grindar som allt annat
  (`minimal` = ingen DB, `fast/standard` = fulltext, `deep` = +vektor +graf). **Tillägg
  för "i de sammanhang jag valt":** ett per-anslutning (eller per-mapp) fält
  `minContextLevel` så att en tung mapp t.ex. bara tas med från `standard`/`deep` och inte
  i snabba svar. Lagras med anslutningen.

---

## Neo4j och server-side grafstore — ärlig kartläggning

**Idag finns ingen Neo4j / pgvector / sqlite-vec** (verifierat i kod). Grafen är en ren,
krypterad **in-memory-modell** härledd ur noter/tasks på enheten, och vektorindexet är
on-device. Det är ett medvetet E2E-val: en server-side grafdatabas med *innehåll/relationer
i klartext* skulle bryta E2E.

Alternativ, i prioritetsordning (matchar projektets E2E-hållning):

1. **Behåll on-device-grafen (rekommenderat default).** Skalar gott för personliga
   bibliotek; inget innehåll lämnar enheten. Nextcloud-filer deltar direkt.
2. **On-device skalbar store** om biblioteket blir stort: `sqlite-vec`/`expo-sqlite` för
   vektorer + en lokal grafspegel. Fortsatt E2E, ingen serverberoende.
3. **Self-hosted Neo4j som du äger (opt-in, uttrycklig avvägning).** Kör på din Pi/server.
   Två undervägar:
   - **Endast struktur:** spegla *noder + kant-typer* (inte titlar/innehåll) → Neo4j för
     tunga graffrågor, medan innehåll förblir krypterat i Noter. Begränsad nytta men
     E2E-bevarande.
   - **Innehåll i Neo4j:** kraftfullast (Cypher/GraphRAG server-side) men innebär att
     *du medvetet* lagrar klartext i din egen Neo4j. Måste vara opt-in, dokumenterat i
     egress-inventeringen, och bakom din egen auth. **Bryter E2E för den datan** — bara
     för användare som uttryckligen accepterar det på egen infra.

ADR 0011 föreslår **#1 nu**, **#2 vid behov**, och **#3 endast som uttrycklig opt-in** —
konsekvent med ADR 0006 (grafen) och ADR 0001 (krypto).

---

## Säkerhet — invarianter (får inte brytas)

1. **Nextcloud-credentials lagras krypterat på enheten, aldrig hos Noter-backend.**
   Mobil: `expo-secure-store`. Electron: `safeStorage`. Web: krypterad `localStorage`
   via `encrypt`/`setStoredValue` (samma mönster som AI-nycklar i `settingsScope`).
   App-lösenord föredras (återkallas i Nextcloud utan att röra kontot).
2. **Innehåll krypteras på enheten före lagring** med användarens `dataKey`
   (`encrypt` → v3 AES-GCM). Backend ser bara chiffertext (`encryptText` är idempotent).
   En enhet utan nyckel ser bara chiffertext.
3. **TLS tvingas** mot Nextcloud-värden (avvisa `http://` utom uttrycklig localhost/LAN).
4. **Lås-medvetet end-to-end:** läggs en synkad mapp under en låst projektmapp ärver den
   låset → `buildIndexableEntities`/`buildGraph`/`buildSafeCalendarProjection` filtrerar
   bort den via `isReadableWithLocks` (`packages/shared/src/locks.ts`). Låst synkat innehåll
   **indexeras aldrig, grafas aldrig, når aldrig AI:n** — samma grind som skyddar allt annat
   ([`security/ai-locked-notes.md`](./security/ai-locked-notes.md)).
5. **Bara de utvalda mapparna.** PROPFIND scopas hårt under valda root-paths; inget utanför
   hämtas. Per-anslutning + per-mapp opt-in, omedelbar bortkoppling (radera anslutning →
   credentials wipas, ev. synkade noter kan behållas eller rensas — användarval).
6. **Egress/connection-inventering + kill-switch.** Lägg Nextcloud-anslutningen i
   [`security/calendar-exposure.md`](./security/calendar-exposure.md)-liggaren (det här är
   *ingress*, men en utgående nätverksanslutning med credentials hör hemma där) med en
   operatörsflagga `NEXTCLOUD_INGEST_ENABLED` och status i `GET /api/health/deep`.

**Var klienten kör — på enheten, inte på backend.** För att bevara E2E hämtar och
extraherar **enheten** (mobil/Electron/web) filerna och krypterar före lagring. En
*backend-baserad* konnektor (för schemalagd sync utan att enheten är på) skulle innebära att
Pi-backenden ser Nextcloud-credentials + klartext — det **bryter E2E** och föreslås därför
endast som senare, uttrycklig opt-in (på din egen Pi), aldrig som default.

---

## Återbruk vs nybygge

| Behov | Återbruk (finns) | Nytt |
|-------|------------------|------|
| WebDAV-protokoll | mönster från `markdav/server.ts` (men det är *server*) | **on-device WebDAV-*klient*** (PROPFIND/GET/ETag) |
| Credential-lagring | `settingsScope` secure-keys (AI-nycklar) | `nextcloud_connections` (krypterat) + app-lösenord-flöde |
| Textextraktion | `aiAttachments` (md/txt/pdf-text), web `pdfText.ts` | mobil PDF-extraktion (kvar sedan ADR 0006) + ev. OCR för bild |
| Krypterad lagring | `encrypt`/`encryptText` idempotent, `e2eNoteInput` | `source`-fält på `Note` (krypterad JSON) |
| Sök/index | `buildIndexableEntities`+`diffIndex`+embeddings | — (gratis) |
| Graf | `buildGraph` | — (gratis) |
| RAG/kontext | `retrieveForChat`, `contextLevels` | per-anslutning `minContextLevel` |
| Lås-säkerhet | `locks.ts` (`isReadableWithLocks`) | — (gratis vid `parentId`-nästling) |
| Realtid | socket-events `note:created/updated` | — (gratis) |
| Schemalagd sync | bakgrunds-scheduler (#71/#118) | Nextcloud-sync-jobb (ETag-poll) |

---

## Föreslagen fasplan

**Fas 1 — on-device read-only-import (MVP).**
Anslutnings-UI (host + app-lösenord, TLS-tvång, "testa anslutning"), mappväljare (PROPFIND-
bläddrare, kryssa root-mappar), sync-motor (PROPFIND `Depth:1` rekursivt under valda root,
ETag-diff), ingest → `Note{source}` krypterad, automatisk indexering + graf. Bara `.md/.txt/
kod` + `.pdf`(web/Electron) först. Manuell "Synka nu". Paritet mobil + Electron/web.

**Fas 2 — automatik + fler filtyper.**
Intervall-sync via bakgrunds-scheduler; mobil PDF-extraktion; bild → vision/OCR;
`minContextLevel` per anslutning/mapp; OAuth2 Login Flow v2 som alternativ auth.

**Fas 3 — (valfritt, opt-in) skalbar/serverstore.**
On-device `sqlite-vec` för stora bibliotek; uttrycklig self-hosted Neo4j-konnektor
(struktur-only default) för den som vill ha server-side Cypher/GraphRAG.

**Fas 4 — (valfritt) två-vägs.**
Skriv tillbaka ändringar i Noter-noter till Nextcloud-filen (återbruk av mutation-drain-
mönstret, fast som DAV-*klient* PUT). Default: read-only import (säkrast).

---

## Öppna beslut (se ADR 0011)

1. **Lagringsmodell:** krypterade `Note`-noter i Noter-DB (rekommenderat — ger graf, sök,
   cross-device, realtid) **vs** enbart on-device-index (maximal integritet, ingen
   cross-device). Rekommendation: **krypterade Notes** (E2E bevaras ändå).
2. **Riktning:** read-only import (rekommenderat Fas 1) vs två-vägs (Fas 4).
3. **Neo4j (BESLUTAT för selektiv sync):** self-hostad, **internt nätverk endast** (aldrig
   publicerad bolt-port — säkrast för DB:n), **backend-relä**: enheten beräknar det
   lås-säkra urvalet + Cypher *på enheten* och POST:ar till en JWT-autad
   `/api/neo4j/sync`; backenden kör det mot intern Neo4j. `includeBody=false` som default
   (endast titlar + struktur) → minimal klartext-exponering; brödtext är uttrycklig opt-in.
   Att lägga *innehåll* i en frågbar graf-DB är i sig ett E2E-undantag — det sker bara för
   uttryckligt valda, olåsta mappar. On-device-grafen är fortsatt default för allt annat.
4. **Klientplats (WebDAV):** on-device (valt, E2E — Nextcloud-credentials + filinnehåll
   stannar på enheten; backend ser bara chiffertext för de ingestade noterna).

---

## Relaterade dokument

- [`external-markdown-sync.md`](./external-markdown-sync.md) + [`adr/0008-external-markdown-sync.md`](./adr/0008-external-markdown-sync.md) — det *omvända* (utgående) DAV-flödet vi speglar.
- [`caldav-bridge.md`](./caldav-bridge.md) — per-share DAV-credential-mönstret.
- [`ai-retrieval-rag.md`](./ai-retrieval-rag.md) — sök/RAG som synkade filer faller in i.
- [`graph-explorer.md`](./graph-explorer.md) + [`adr/0006-knowledge-graph-and-search.md`](./adr/0006-knowledge-graph-and-search.md) — graf + sök-roadmap (Neo4j-fas).
- [`security/ai-locked-notes.md`](./security/ai-locked-notes.md) + [`security/calendar-exposure.md`](./security/calendar-exposure.md) — lås-grind + egress/connection-liggare.
- [`adr/0009-e2e-for-ai-created-content.md`](./adr/0009-e2e-for-ai-created-content.md) — client-encrypt-before-send (samma väg ingest använder).
