# ADR-0012: Per-folder kryptografisk gräns för låsta projektmappar

**Status:** Accepted (Fas 1: krypto-primitiv levererad; klient-wiring i kommande faser)
**Date:** 2026-06-19
**Author(s):** Noter-teamet

## Context

Låsta projektmappar skyddas idag av **filtrering**: `isReadableWithLocks` maskar dem i varje vy,
AI/index passerar en tom upplåsnings­mängd (se [`security/cwe-mapping.md`](../security/cwe-mapping.md)
T20 + [`../../noter-app/docs/LOCKED_FOLDER_SECURITY.md`](../../noter-app/docs/LOCKED_FOLDER_SECURITY.md)).
Men *innehållet* i en låst not är fortfarande krypterat med användarens **enda** `dataKey` (ADR-0001).
Det betyder att skyddet i sista hand vilar på att varje yta kommer ihåg att applicera lås-filtret —
en bugg i filtret, eller en ny yta som glömmer det, kan exponera klartext. Lås-gränsen är logisk,
inte kryptografisk.

Vi vill att en låst mapp ska vara **kryptografiskt** oläsbar utan mappens lösenord: även om
filtret skulle missa något ska chiffertexten inte gå att dekryptera utan att användaren själv
låst upp mappen.

## Decision

Inför en **mapp-nyckel** per skyddad mapp. En mapps noter krypteras under en slumpad 256-bitars
mapp-nyckel (FK) som bara existerar i minnet efter att användaren angett mapp-lösenordet. FK
**wrappas** (AES-256-GCM) under en mapp-rotnyckel härledd ur mapp-lösenordet via Argon2id (PBKDF2
fallback) med ett per-mapp-salt. Endast den *wrappade* FK + salt + kdf persisteras (`FolderKeyBundle`);
lösenordet och FK lagras aldrig. En nots fält sealas med `wrapNoteForFolder` till ett **`v3f:`**-
prefixat kuvert (ett vanligt `v3:`-GCM-kuvert under FK med ett särskiljande prefix), så läsvägen kan
skilja "behöver mapp-nyckeln" från "behöver användarens dataKey" (befintliga `v3:`-noter förblir
läsbara).

Detta speglar exakt den befintliga `dataKey`/`rootKey`/recovery-arkitekturen i `cryptoV3` (ADR-0001):
ett slumpat innehålls-nyckel wrappat under en lösenords-härledd nyckel, så **lösenordsbyte = re-wrap
av FK** (`rewrapFolderKey`), aldrig om-kryptering av noter.

## Considered alternatives

- **Kryptera direkt under en lösenords-härledd nyckel** (ingen mellanliggande FK) — enklare, men
  lösenordsbyte skulle kräva om-kryptering av *alla* noter i mappen. Förkastad: matchar inte
  dataKey-mönstret och skalar dåligt.
- **Status quo (endast filtrering)** — billigast, men lås-gränsen förblir logisk; en filter-bugg =
  klartext-exponering. Det är just den risken (T20) vi vill ta bort kryptografiskt.
- **Separat kuvert-version (`v4:`)** i stället för `v3f:`-prefix — onödigt; `v3f:` återbrukar all
  testad `cryptoV3`-GCM-sealing och är trivialt att diskriminera i läsvägen.

## Consequences

**Bättre:** en låst mapp blir oläsbar utan lösenordet även om en yta missar lås-filtret —
defense-in-depth utöver T20. Lösenordsbyte är billigt (re-wrap). Format-diskriminatorn (`v3f:`) gör
migrationen explicit och bakåtkompatibel.

**Sämre/kostnad:** en extra nyckel-livscykel att hantera (härled FK vid upplåsning, håll endast i
minnet, nolla vid omlåsning). Läs/skriv-vägen (materialize) måste dispatcha på `v3f:` vs `v3:`.
Mapp-lösenordet blir en **separat** hemlighet från konto-lösenordet — UX för att sätta/återställa det
behöver designas. Glömt mapp-lösenord utan recovery = oåterkalleligt låst mapp (samma egenskap som
E2E redan har; en mapp-recovery-kod kan övervägas senare).

## Implementation notes

**Fas 1 (levererad i denna ADR):** ren krypto-primitiv `packages/shared/src/folderKey.ts`
(+`folderKey.test.ts`, 18 tester i den blockerande grinden):
`createFolderKey` / `unlockFolderKey` / `rewrapFolderKey` / `wrapNoteForFolder` /
`unwrapNoteForFolder` / `isFolderWrapped` / `parseFolderKeyBundle` + (de)serialisering.
**Inte** wired in i stores/materialize ännu — medvetet, så migrationen kan stagas noga.

**Migration (kommande faser):**
1. **Bundle-lagring.** ✅ **Typ + accessorer levererade:** `Note.folderKeyBundle?: string` (serialiserad
   bundle, klartext — den innehåller ingen hemlighet utan lösenordet) + de rena hjälparna
   `readFolderKeyBundleFromNote` / `noteHasFolderKeyBundle` / `withFolderKeyBundle` i `folderKey.ts`
   (4 tester). En mapp utan bundle = "gammal stil" (endast filtrerad) och fortsätter fungera
   (`readFolderKeyBundleFromNote` → null). ✅ **Backend-passthrough klar:** `Note`-modellen
   (Mongoose) + create/update-Joi-scheman + uppdaterings-handlern i `apps/backend/src/routes/notes.ts`
   tillåter nu `folderKeyBundle` (som **vanlig sträng** — inte `encryptedRequired` — eftersom den inte
   är användarchiffertext utan en bundle utan hemlighet). Servern inspekterar/dekrypterar den aldrig;
   den lagras + returneras opakt och **bara till ägaren** (bevisat av
   `__tests__/routes/ownership-isolation.test.ts`: round-trip create→fetch→update + cross-user-läcktest).
   GraphQL-`NoteType` exponerar den medvetet **inte** (AI-ytan ska aldrig se en låst mapps material).
   **Kvar:** enrolment som faktiskt *skriver* fältet på mappnoten (device-verifierat).
2. **Opt-in enrolment + FK-session.** ✅ **Session-mekanismen levererad**
   (`packages/shared/src/folderKeySession.ts`, 10 tester): `setFolderKey`/`getFolderKey`/
   `hasFolderKey`/`clearFolderKey`/`clearAllFolderKeys`/`unlockedFolderIds` — en in-memory-only karta
   (mapp-id → FK), aldrig persisterad, aldrig loggad, äger en kopia av varje nyckel och nollar
   bytena vid omlåsning. **Clear-on-lock wired:** både stores anropar nu `clearAllFolderKeys()` i
   app-lås/logout-vägen (mobil `setSecurityLocked(true)` + `logout`; web `setAppLocked(true)` +
   `logout`), bevisat av `apps/{web,mobile} __tests__/store.test.ts` ("clears the folder-key session
   on app-lock"). No-op tills enrolment landar. **Kvar:** anropa `unlockFolderKey` → `setFolderKey`
   när användaren sätter/anger mapp-lösenordet (enrolment + upplåsning).
3. **Skriv-väg.** Noter i en mapp med bundle sealas med `wrapNoteForFolder(fält, FK)` i stället för
   `encrypt(...)` under dataKey. Endast medan mappen är upplåst (FK i minnet).
4. **Läs-väg (`materializeOneNote`).** ✅ **Shared-dispatch levererad** (`materializeFolderField`
   i `packages/shared/src/encrypt.ts`, 8 tester): `v3f:` + FK → dekryptera; `v3f:` utan FK / fel
   FK / manipulerad → mask (`lockedFallback`); annars befintlig `safeDecrypt` (`v3:`/legacy/klartext)
   — **bakåtkompatibelt**. Som extra skydd returnerar även `safeDecrypt`/`decrypt` masken (aldrig
   chiffertexten) om ett `v3f:`-värde råkar nå dem utan FK. ✅ **Store-wiring klar:**
   `materializeOneNote`/`materializeNotesFromEncrypted` i **båda** stores dispatchar nu `title`/
   `content` via `materializeFolderField` med `getFolderKey(<närmaste låsta förälder>)` när fältet är
   `v3f:` (annars oförändrad `safeDecrypt`/`decrypt` — no-op för all befintlig data). Bevisat av
   `apps/{web,mobile} __tests__/store.test.ts` ("materializes a v3f note decrypted with the session
   folder key, masked without it").
5. **Lösenordsbyte.** `rewrapFolderKey(FK, nyttLösen)` → uppdatera bundle. Ingen not krypteras om.
6. **Mekanisk grind.** Utöka `scripts/check-index-unlock-leak.mjs` eller lägg en ny guard så
   `v3f:`-innehåll aldrig kan nå en publicerings-/index-yta okrypterat.

Krav som måste hålla (invarianter, se index §3): bakåtkompatibel läsning av `v3:`-noter; krypto bara
från `@repo/shared`; FK lämnar aldrig minnet; logga aldrig FK/lösenord.

## Slutfas — implementations-spec för enrolment + skriv-seal (device-verifierad)

Allt ovan (Fas 1 + 2.1–2.6) är byggt och testat headless. Det som återstår *skapar* riktig
`v3f:`-data och rör den heta spar-vägen, så det görs i en egen cykel med en manuell `/verify` på en
riktig enhet/webbkörning. Designen är fastställd här så cykeln inte gissar:

**Skriv-seal — var den ska ligga (undvik dubbel-kryptering).** Krypterings-gränsen för noter är
`apps/web/services/api.ts` (`createNote`: `title: encrypt(data.title)`, `content: encrypt(data.content)`;
`updateNote` likadant) och motsvarande i `apps/mobile/services/api.ts`. `encrypt()` använder
användarens `dataKey`. **Seal-beslutet (vilken nyckel) hör hemma i storen** (den har note-mappen
för att hitta närmaste låsta förälder), inte i `api.ts`. Plan:
1. Storen resolvar `folderKey = getFolderKey(<närmaste låsta förälder till parentId>)` (samma
   `findBlockingLockedAncestor(..., new Set())`-logik som läs-vägen redan använder) och skickar in
   den som ett **valfritt** fält på DTO:t (`CreateNoteDto`/`UpdateNoteDto`: `folderKey?: Uint8Array`).
2. `api.ts` blir: `title: data.folderKey ? wrapNoteForFolder(data.title, data.folderKey) : encrypt(data.title)`
   (samma för `content`). Så fält i en krypto-skyddad mapp sealas till `v3f:` i stället för att
   `dataKey`-krypteras — **aldrig båda** (ingen dubbel-wrap). Övriga fält (tags/icon/…) lämnas tills
   vidare på `dataKey`-vägen; bara `title`/`content` är känsligt nog för Fas 1.
3. `folderKey` får **aldrig** loggas eller sparas i offline-kön i klartext — offline-kön sparar redan
   det krypterade DTO:t, så sealen måste ske *före* enqueue (dvs. i `api.ts` precis som `encrypt`).

**Enrolment-flöde (UI, båda appar).** I projektmappens tre-prickarsmeny/editor: "Lås den här mappen
med ett lösenord" → fråga lösenord → `createFolderKey(lösenord)` → `updateNote(folderId, withFolderKeyBundle(folder, bundle))`
(persisteras nu av backend) → `setFolderKey(folderId, key)` → re-materialisera. Upplåsnings-prompt när
man öppnar en låst krypto-mapp: `unlockFolderKey(lösenord, readFolderKeyBundleFromNote(folder))` →
`setFolderKey`; fel lösenord → `FolderUnlockError` → visa "fel lösenord", lämna låst. Lösenordsbyte:
`rewrapFolderKey` → uppdatera bundlen.

## Manuell /verify-checklista (slutfasen)

1. Skapa en projektmapp → "Lås med lösenord" → ange lösenord. Mappnoten får `folderKeyBundle`
   (verifiera i nätverksanropet/DB), FK i sessionen.
2. Skapa en not i mappen, skriv text, spara. **Verifiera i nätverksanropet/DB att `title`/`content`
   börjar med `v3f:`** (inte `v3:`) — sealad under mapp-nyckeln, inte dataKey.
3. Lås appen (eller logga ut) → öppna igen. Noten ska visa **mask** ("Låst anteckning" / tomt
   innehåll), **aldrig** chiffertexten. AI/index/publicering ska aldrig se mappen (lås-filtret).
4. Ange mapp-lösenordet → noten blir läsbar igen (FK åter i sessionen).
5. Byt mapp-lösenord → gammalt lösenord slutar fungera, noterna förblir läsbara (re-wrap, ingen
   om-kryptering).
6. **Regressions-skydd:** befintliga `v3:`-noter (utanför krypto-mappar) är oförändrade — skapa/öppna/
   redigera/synka en vanlig not och en vanlig låst (endast filtrerad) mapp som vanligt.
7. Synk: `v3f:`-innehåll + `folderKeyBundle` överlever en round-trip till backend och tillbaka på en
   andra enhet (backend-passthrough är redan headless-testad; verifiera multi-device manuellt).

## Open questions

- **Mapp-recovery:** ska en mapp ha en egen recovery-kod (som E2E-kontot) för glömt mapp-lösenord,
  eller är det medvetet oåterkalleligt? (Tas i en uppföljande ADR vid Fas 2.)
- **Nästlade låsta mappar:** en låst undermapp i en låst mapp — egen FK eller ärver förälderns?
  (Förslag: egen FK per lås-nod; bestäms vid wiring.)
- **Delning/extern sync:** `v3f:`-noter ska aldrig projiceras till MD/CalDAV/Neo4j (de är låsta);
  bekräfta att lås-filtret redan utesluter dem innan wiring.
