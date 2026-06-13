# Disaster recovery runbook

_Senast uppdaterat: 2026-05-14 · Målgrupp: oncall, ops_

Konkreta steg för incidenter som kräver mer än "starta om appen". Alla
operationer ska först köras mot **staging** om möjligt.

## Allmänt

- **Status-tråd**: skapa Slack-kanal `#inc-YYYYMMDD-<keyword>`.
- **IC**: utse en. IC fattar beslut, övriga skickar fakta.
- **Postmortem**: kopiera [`Doc/incidents/TEMPLATE.md`](../incidents/TEMPLATE.md) inom 72 h.

## Scenario 1 — MongoDB-replikset failover

Symtom: write-fel, `MongoServerSelectionError`, monitorering visar primary
crashar / DNS-skiftar.

1. Ping Atlas/självhostad statusboard. Notera vilken nod som är primary nu.
2. Om Atlas: kör en *manuell* failover via Atlas-UI:n bara om automatisk inte
   redan löst sig inom 60 s.
3. På backend-noder: säkerställ att `MONGO_URI` använder `replicaSet=` och
   `readPreference=secondaryPreferred` så reads aldrig blockerar.
4. När primary skiftat: kör `npm run db:reconcile-indexes` för att verifiera
   att index-meta inte drev under failover (Atlas brukar bevara, men kontroll
   är cheap).
5. Sätt en _post-incident_ check i staging: skriv 100 noter, läs tillbaka,
   verifiera replikset-status med `db.serverStatus().repl`.

## Scenario 2 — Redis flush vid bad-key incident

Symtom: rate-limit eller cache returnerar trasiga svar; misstänkt nyckel
har förgiftats av en bugg eller en angripare.

1. Identifiera bucket via Redis-prefix. För användarspecifik: `noter:<userId>:*`.
2. Använd `SCAN MATCH 'noter:<id>:*' COUNT 1000` (aldrig `KEYS`) och `DEL`
   i batch om 100. Skriv ett zx-skript med rate-limit för att inte
   prata-blockera Redis.
3. Bumpa cache-epoch för berörda användare:
   `redis-cli SET 'noter:<userId>:epoch' "$(date +%s%3N)"`.
4. Om hela db:n är komprometterad: `FLUSHDB` på rate-limit-instansen är OK
   (genererar bara en kortvarig burst); aldrig på cache utan att först bumpa
   epoch för alla användare för att undvika reinflation.
5. Verifiera att inga sliding-window-counters förlorade läge: `INFO replication`.

## Scenario 3 — Rotation av Argon2id-parametrar

Vi bumpar Argon2id memoryCost/timeCost när hårdvara skalar.

1. Lägg nya defaults i `packages/shared/src/kdf.ts` (`DEFAULT_ARGON2_*`).
2. Bumpa `KEY_WRAP_VERSION` i `keyBootstrap.ts`.
3. Vid login: om användarens `keyWrapVersion < KEY_WRAP_VERSION`, kör
   `rewrapDataKey` i bakgrunden och PATCH:a `wrappedDataKey/salt/version`.
4. Behåll stöd för båda kdf-versionerna i `unwrapDataKeyWithPassword` under
   en release-window om ≥ 30 dagar.
5. Logga andel användare som migrerats; ta bort gamla parametrar när %
   passerar 99.

## Scenario 4 — MCP-paket komprometterat upstream

Symtom: säkerhetsbulletin från upstream-MCP-paket (Slack/Notion/…).

1. Pinned versioner i `package.json` ska redan stoppa nya pulls; bekräfta
   med `npm ls @modelcontextprotocol/server-<x>`.
2. Avaktivera tjänsten direkt: sätt env `MCP_<SERVICE>_DISABLED=1` (kräver
   minimal kod-patch — lägg i `requirePolicy`-check).
3. Rotera secrets för den tjänsten (Slack bot-token, Notion API-token).
4. Skanna `noter:rev:*` set efter nya jti-poster — om det är en credential-
   leak ska vi bumpa `tokenVersion` på berörda användare.
5. Postmortem.

## Scenario 5 — Replay-detect i refresh-token-flödet

Symtom: `securityFlagAt` sätts på många användare, replay_detected loggas
i error.log.

1. Är det en bot? Kolla User-Agent + IP-fördelning i de senaste 5 min.
2. Om bot: ta upp WAF/rate-limit-tröskel, lägg fingerprint på blocklist.
3. Om enskild användare: skapa support-ticket, kräv password reset.
4. Om bulk: bumpa `tokenVersion` för alla flagged-users + email om opt-in.
5. Postmortem — överväg om `useCount`-tröskel ska sänkas eller bevisbörda
   stärkas.

## Scenario 6 — Auto-update-feed komprometterad

Symtom: misstänkt installer-versjon distribueras via update-feed.

1. **Stoppa feedet omedelbart**: byt URL i CDN-konfig eller tag-radera
   `latest.yml`.
2. Bumpa `NOTER_ASAR_SHA256` env för Electron-clients som redan installerat
   sista legitima version — kommande starter validerar och refuserar.
3. Rotera signing-cert (Azure Trusted Signing / Apple Developer ID) om
   misstanke om cert-läck.
4. Push notifierar: "Avinstallera v X.Y.Z och installera om från noter.app".

## Generella post-incident kontroller

- Backups: när togs senaste? Är de återställbara? Testa _alltid_ restore.
- Auditspår: kontrollera att `McpAuditLog` är AEAD-krypterat och inte hade
  gaps under incidenten.
- Dependencies: körs `npm audit --audit-level=high` rent? Om inte: patcha
  och push:a en ny release före slutet av veckan.
