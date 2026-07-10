# Kryptering & säkerhet — härdning (2026-07-10)

_Tre parallella granskningsagenter (E2E-kryptokärnan; backend+mobil secret/token-hantering;
hela-stacken crypto) plus egen genomläsning. Grundat i OWASP 2023/2024 (Password Storage +
Cryptographic Storage cheat sheets) och aktuell AES-GCM/Argon2id-praxis._

## Fixat (implementerat + testat + pushat)

### Kryptokärna (delade paket)
- **KDF-parametrar lagras nu PER WRAP** (`KeyBundle.kdfParams`, `FolderKeyBundle.kdfParams`). Tidigare
  lagrades bara KDF-*id*, och derive-vid-unwrap använde modulkonstanter — så påståendet att parametrar
  "kan höjas utan att bryta befintliga wraps" var falskt (varje höjning hade låst ut alla befintliga
  användare). `deriveRootKeyWithKdf` tar nu parametrar och reproducerar exakt nyckel; saknade parametrar
  faller tillbaka till ursprungsbaslinjerna (argon 19 MiB/t2/p1, pbkdf2 200k) → befintliga wraps orörda.
- **PBKDF2-fallback 200k → 600k** (OWASP 2023-minimum för PBKDF2-HMAC-SHA256), säkert tack vare
  parameter-lagringen. Nås bara när Argon2id är otillgänglig.
- **Tyst KDF-nedgradering mildrad**: Argon2id (ren JS, alltid *tillgänglig*) försöker igen en gång vid
  ett övergående fel innan fallback — en engångs-OOM pinnar inte längre kontot permanent till svagare
  KDF; och fallbacken är nu 600k, inte 200k.
- **Zeroization**: lösenordshärledda rootKey/recoveryKey/folder-rootKey nollställs (`.fill(0)`) direkt
  efter wrap/unwrap; aktiva dataKey-bytes nollställs när nyckeln ersätts/rensas (`setActiveDataKey`).
- **Data-loss-skydd**: en låst v3-anteckning som materialiserades till tom text kunde skrivas tillbaka
  och radera kryptotexten. `updateNote` (web + mobil) strippar nu titel/innehåll ur uppdateringen när
  anteckningen är oläsbar (ingen aktiv dataKey + lagrad text är kryptotext) → servern behåller
  kryptotexten.

### Backend
- **JWT-algoritm pinnad till HS256** på både sign och verify → stänger algoritm-förvirring
  (alg:none / RS-HS-confusion).
- **CORS**: dev-localhost-origins litas på ENDAST i icke-produktion (en illasinnad lokal server på
  offrets maskin kunde annars göra credentialed cross-origin-läsningar mot prod-API:t). Förstaparts-
  origins (daylited, `app://noter`, Tauri `tauri://localhost` + `http://tauri.localhost`) alltid tillåtna.
- **/internal/perf-snapshot** jämför delad hemlighet med `timingSafeEqual` över SHA-256 (ingen timing/
  längd-läcka).
- **GraphQL demo-token** gatead bakom `isDemoTokenEnabled()` som övriga auth-vägar.

### Desktop (Tauri)
- **CSP `connect-src`** släpper godtycklig klartext (`http:`/`ws:` till valfri host); kvar är `https:`/
  `wss:` + localhost för LM Studio/dev. En supply-chain-komprometterad beroende kan inte längre beacona
  E2E-nyckeln/token till en godtycklig klartext-host.

## Verifierat korrekt (inga defekter — checkat)
CSPRNG på båda plattformar (kastar om ingen finns, ingen Math.random-fallback); GCM-auth-tag verifieras
före all plaintext-användning; nyckel-wrap är autentiserad (manipulerad `v3w:` upptäcks); ingen
handrullad icke-konstant-tid jämförelse (delegeras till GCM); recovery-kod 100 bitar utan modulo-bias;
per-användare-salt unikt; bcrypt cost 12 + dummy-hash-timing mot enumeration; API-nyckel-verifiering
`timingSafeEqual` på SHA-256, bara hash lagras; mobil token endast i SecureStore; server får bara den
*wrappade* dataKey; `locks.parseLockedFlag` fail-closed; server-side fältkryptering (AES-256-GCM,
versionerad, per-scope-subnyckel) sund.

## Dokumenterad backlog (arkitektoniska — en blind ändring riskerar att bryta legacy-data/flöden)
- **H1 — `DEFAULT_KEY` för nya writes utan aktiv dataKey.** I praktiken är aktiva användare v3-enrollade
  (dataKey i keychain, `encrypt()` → v3), så DEFAULT_KEY-vägen träffas i huvudsak transient/legacy. En
  fullständig fix (vägra kryptera utan dataKey / per-install slumpnyckel) kräver hantering av
  icke-enrollade + legacy-konton och görs som en stagead migration, inte en blind ändring. Data-loss-
  skyddet ovan tar bort det farligaste symptomet (write-back-radering).
- **#2 — min-version-pinning** (enrollad användare avvisar nedgraderad/plaintext-injektion). Kräver
  per-anteckning version-metadata + migrationsspårning; en generell "avvisa icke-v3 för enrollade" hade
  dolt legitima icke-migrerade legacy-anteckningar. Design: stämpla en `minCryptoVersion` per konto +
  per fält och avvisa envelope under den.
- **M2/M3 — JWT-revokering + nyckelrotation.** 7-dagars token utan server-side blocklist/jti; `jwtKeySet.ts`
  (kid-baserad rotation) är död kod — auth-vägen använder en enda statisk hemlighet. Lägg till jti +
  revoke-lista och koppla in nyckeluppsättningen, eller korta token + inför refresh.
- **M5/#4 — web dataKey i sessionStorage** (XSS-nåbar). Dokumenterad avvägning; alternativet är
  in-memory-only + re-derive vid reload eller wrap under en icke-extraherbar WebCrypto-nyckel.
- **Argon2id på OWASP-golvet** (19 MiB/t2/p1). Nu höjbart tack vare parameter-lagringen; en höjning bör
  mätas mot unlock-latens på low-end-telefoner (ren-JS Hermes) innan den slås på.
