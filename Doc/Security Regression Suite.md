# Security Regression Suite

Den här sviten samlar riktade säkerhetstester för backend, mobilappen och Electron-appen samt en mutationssvit som verifierar att kritiska skydd faktiskt bryter när skyddskoden muteras.

## Omfattning

- Backend
  - brute-force-begränsning för autentisering
  - blockerad NoSQL-, SQL-lik och prototype-pollution-injektion
  - URL-längdsskydd och lås-/krypteringsregressioner
- Mobil
  - HTTPS-policy och säker API-normalisering
  - 401-hantering, 429-retry och skydd mot sessionsabotage
  - kryptering at rest för anteckningar, uppgifter och sync-kö
- Electron
  - krypterad settings-persistens
  - BrowserWindow-hardening
  - preload-kontrakt och begränsad IPC-yta
  - blockering av osäkra externa URL-protokoll

## Körning

Från `noter-app/`:

```bash
npm run test:security:deep
```

För enbart mutationer:

```bash
npm run test:security:mutations
```

## Hur mutationssviten fungerar

- Sviten muterar utvalda skydd i källkod temporärt.
- Efter varje mutation körs den minsta relevanta testsviten.
- Om testerna fortfarande passerar markeras mutanten som överlevande och sviten fallerar.
- Källfilen återställs alltid efter varje mutationsfall.

## Aktiva mutationsmål

- Backend `requestSecurity.ts`
  - URL-längdskydd
  - injektionsdetektion för misstänkta URL-mönster
- Mobil `api.ts`
  - HTTPS-krav utanför utvecklingsläge
- Mobil `database.ts`
  - kryptering av sync-köpayload
- Electron `main.js`
  - allowlist för externa URL-protokoll
  - vägran att skriva settings i klartext när OS-kryptering saknas

## Förväntat resultat

- Säkerhetsregressioner fångas tidigt i CI och lokalt.
- Kritiska skydd för kryptering, auth, IPC och injektionsfilter måste ha verklig testkraft.
- Mutationer som försöker försvaga skyddskoden ska dödas av testerna.
