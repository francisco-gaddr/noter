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
1. **Bundle-lagring.** `FolderKeyBundle` lagras på projektmapp-noten (t.ex. ett fält krypterat med
   användarens dataKey, eller som klartext eftersom det inte innehåller någon hemlighet utan
   lösenordet). En mapp utan bundle = "gammal stil" (endast filtrerad) och måste fortsatt fungera.
2. **Opt-in enrolment + FK-session.** ✅ **Session-mekanismen levererad**
   (`packages/shared/src/folderKeySession.ts`, 10 tester): `setFolderKey`/`getFolderKey`/
   `hasFolderKey`/`clearFolderKey`/`clearAllFolderKeys`/`unlockedFolderIds` — en in-memory-only karta
   (mapp-id → FK), aldrig persisterad, aldrig loggad, äger en kopia av varje nyckel och nollar
   bytena vid omlåsning. **Kvar:** anropa `unlockFolderKey` → `setFolderKey` när användaren sätter/
   anger mapp-lösenordet, och `clearAllFolderKeys()` vid app-lås/logout (mirror
   `unlockedProtectedNoteIds`).
3. **Skriv-väg.** Noter i en mapp med bundle sealas med `wrapNoteForFolder(fält, FK)` i stället för
   `encrypt(...)` under dataKey. Endast medan mappen är upplåst (FK i minnet).
4. **Läs-väg (`materializeOneNote`).** ✅ **Shared-dispatch levererad** (`materializeFolderField`
   i `packages/shared/src/encrypt.ts`, 8 tester): `v3f:` + FK → dekryptera; `v3f:` utan FK / fel
   FK / manipulerad → mask (`lockedFallback`); annars befintlig `safeDecrypt` (`v3:`/legacy/klartext)
   — **bakåtkompatibelt**. Som extra skydd returnerar även `safeDecrypt`/`decrypt` masken (aldrig
   chiffertexten) om ett `v3f:`-värde råkar nå dem utan FK. **Kvar:** anropa `materializeFolderField`
   från `materializeOneNote` i båda stores (mata in mappens FK från in-memory-sessionen).
5. **Lösenordsbyte.** `rewrapFolderKey(FK, nyttLösen)` → uppdatera bundle. Ingen not krypteras om.
6. **Mekanisk grind.** Utöka `scripts/check-index-unlock-leak.mjs` eller lägg en ny guard så
   `v3f:`-innehåll aldrig kan nå en publicerings-/index-yta okrypterat.

Krav som måste hålla (invarianter, se index §3): bakåtkompatibel läsning av `v3:`-noter; krypto bara
från `@repo/shared`; FK lämnar aldrig minnet; logga aldrig FK/lösenord.

## Open questions

- **Mapp-recovery:** ska en mapp ha en egen recovery-kod (som E2E-kontot) för glömt mapp-lösenord,
  eller är det medvetet oåterkalleligt? (Tas i en uppföljande ADR vid Fas 2.)
- **Nästlade låsta mappar:** en låst undermapp i en låst mapp — egen FK eller ärver förälderns?
  (Förslag: egen FK per lås-nod; bestäms vid wiring.)
- **Delning/extern sync:** `v3f:`-noter ska aldrig projiceras till MD/CalDAV/Neo4j (de är låsta);
  bekräfta att lås-filtret redan utesluter dem innan wiring.
