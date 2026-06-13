# SQLCipher full-file encryption (Stage-4) — implementation runbook

_Status: PLANNED (kräver dev-client-build + enhetsvalidering) · Senast uppdaterat: 2026-06-13_

> Varför ett runbook och inte kod redan? Att slå på SQLCipher kräver en **native
> ombyggnad** (inte Expo Go) och **enhetsvalidering** av att login → DB-öppning →
> omstart fungerar. Att checka in halv-trådad native-krypto utan att kunna köra den
> på enhet riskerar att låsa ute data. Den här filen är den fullständiga, körbara
> planen så att nästa dev-client-build kan aktivera den säkert och i ett svep.

## Vad vi redan har (och vad detta lägger till)

I dag krypteras **allt känsligt innehåll på fältnivå** innan det skrivs till SQLite
(titlar, innehåll, taggar, AI-meddelanden → `encrypt()` → `v3:`/legacy-envelope).
DB-**filen** innehåller alltså redan bara ciphertext för känsliga fält. Det som
*inte* är krypterat i dag: tabellstruktur, id:n, tidsstämplar, radordning och annan
metadata. **SQLCipher** krypterar hela filen (sidor à 4 KB med AES-256) → defense in
depth, så även metadata och en stulen `.db`-fil är oläsbar utan nyckeln.

## Nyckelmodell

- Generera en **slumpmässig 256-bitars DB-nyckel** (`crypto.getRandomValues` /
  `generateDataKey()` från `@repo/shared/cryptoV3`).
- Lagra den i **expo-secure-store** (Keychain/Keystore), aldrig i klartext på disk
  utanför secure enclave. Nyckeln är *separat* från v3-`dataKey` (olika syften:
  DB-at-rest vs E2E-innehåll), så att rotation av det ena inte tvingar det andra.
- Vid app-start: läs DB-nyckeln från secure-store → öppna DB med `PRAGMA key`. Finns
  ingen nyckel (första gången efter uppgradering) → generera, migrera, spara.

## Steg-för-steg

1. **Bygg-flagga.** expo-sqlite stödjer SQLCipher när native byggs med
   kryptering aktiverad. Lägg till i `app.json` under `expo-sqlite`-pluginens
   config (`"useSQLCipher": true`) och gör en **dev-client / EAS-build** (funkar
   inte i Expo Go).
2. **Key helper** (`apps/mobile/services/database/dbKey.ts`):
   - `getOrCreateDbKey(): Promise<string>` — läs hex-nyckel ur secure-store, eller
     generera 32 random-bytes → hex, spara, returnera. Rena delar (hex-kodning,
     32-byte-längd) **enhetstestas** i shared/mobil.
3. **Öppna med nyckel.** I `initDatabase()` (`services/database.ts`), direkt efter
   `openDatabaseAsync(...)`:
   ```ts
   const key = await getOrCreateDbKey();
   await db.execAsync(`PRAGMA key = "x'${key}'";`);   // raw 32-byte hex key
   await db.execAsync('PRAGMA cipher_memory_security = ON;');
   // Sanity: en SELECT mot sqlite_master kastar om nyckeln är fel.
   await db.getFirstAsync('SELECT count(*) FROM sqlite_master;');
   ```
4. **Migrera befintlig oskyddad DB** (enbart första gången):
   - Om en gammal klartext-`noter.db` finns: öppna den utan nyckel, `ATTACH` en ny
     krypterad DB med `PRAGMA key`, kör `sqlcipher_export('encrypted')`, `DETACH`,
     byt ut filen. Annars: ny DB skapas krypterad direkt.
   - Gör migreringen **idempotent** och bakom en `db_encrypted`-flagga i
     secure-store så den aldrig körs två gånger.
5. **Rollback-säkerhet.** Behåll den gamla filen som `.db.bak` tills en lyckad
   krypterad öppning verifierats; radera först därefter.

## Validering (måste göras på enhet före release)

- [ ] Färsk install → skapa anteckning → döda appen → starta → anteckning kvar.
- [ ] Uppgradering från klartext-DB → migrering körs en gång → all data läsbar.
- [ ] Fel nyckel (simulera korrupt secure-store) → tydligt fel, ingen datakorruption.
- [ ] `adb pull`/Filer-app på `.db` → filen är inte läsbar som SQLite (verifierar at-rest).
- [ ] Prestanda: kallstart-tid mätt före/efter (SQLCipher ~5–15 % overhead väntat).

## Klassificering & dokumentation vid aktivering

När detta slås på: sätt `WHATS_NEW_ENTRIES.security = 'security-hardening'`, uppdatera
`SECURITY_LEVEL` (t.ex. `v3+sqlcipher`), höj app-versionerna och bocka av i
[`../index.md`](../index.md) §4 + [`../security/security-upgrade-playbook.md`](../security/security-upgrade-playbook.md) §5.

## Electron-motsvarighet

Electron lagrar via `safeStorage` + ev. lokal cache. Samma princip: om en lokal
SQLite/IndexedDB-cache används, kryptera filen med en nyckel från `safeStorage`.
Dokumenteras separat när Electron-cachen växer.
