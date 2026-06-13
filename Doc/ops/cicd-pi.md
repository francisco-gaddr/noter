# CI/CD — auto-deploy till Raspberry Pi ("eget Vercel")

_Senast uppdaterat: 2026-06-13 · Gäller backend + web på Pin (`rp5`, tailnet 100.64.0.2)_

Noter deployas automatiskt till Pin via Pins egna CI/CD-system — **systemd-timers +
per-projekt deploy-script** under `/srv/selfhost/cicd/`. När du pushar till GitHub
`dev` pollas och deployas det inom ~2 minuter, helt automatiskt. Du behöver inte
röra något.

> Samma mönster som `francisco-site` (`francisco-deploy.timer`). Komodo ("Daylited
> Deploy", :9120) sköter *andra* stackar (nextcloud m.fl.); Noter använder den enklare,
> robustare systemd-timer-vägen — bl.a. för att Noters data-volymer (mongo/redis,
> compose-projekt `noter`) inte ska klonas om i en ny namespace och tappa innehåll.

## Flöde (vad som händer när du pushar)

```
git push origin dev
        │
        ▼  (≤ 2 min, systemd-timer pollar)
noter-deploy.timer ──> noter-deploy.service ──> /srv/selfhost/cicd/noter-deploy.sh
        │
        ├─ git fetch origin dev; om HEAD == origin/dev → avsluta (inget nytt)
        ├─ git merge --ff-only origin/dev      (vägrar vid lokala ändringar → ntfy-varning)
        ├─ docker compose build                (BYGGFEL → gammal version kvar + ntfy-larm)
        ├─ docker compose up -d --remove-orphans
        ├─ smoke: /api/health == 200  + /api/health/deep status==ok, läs version
        ├─ skriv state/noter.json  (status + version + historik, 30 senaste)
        └─ ntfy: "noter deployad 🚀 (vX.Y.Z)"  eller  "ohälsosam ⚠️"
```

**Felsäkerhet:** bygg- eller hälsofel **behåller den gamla versionen** (deployar inte
en trasig build) och larmar via ntfy. En `flock` hindrar dubbelkörning.

## Var allt bor (på Pin)

| Sak | Sökväg |
|-----|--------|
| Deploy-script | `/srv/selfhost/cicd/noter-deploy.sh` |
| systemd-units | `/etc/systemd/system/noter-deploy.{service,timer}` (timer var 2:e min) |
| Logg | `/srv/selfhost/cicd/logs/noter.log` |
| Status (JSON) | `/srv/selfhost/cicd/state/noter.json` — senaste deploy + 30 i historik |
| Repo (deployad) | `/home/realdini/srv/projects/noter` (äger de körande containrarna) |
| Hemligheter | `…/noter/.env` (`JWT_SECRET` m.m., gitignored) |
| Generisk motor | `/srv/selfhost/cicd/deploy-engine.sh` + `projects.d/*.conf` (noter.conf = `ENABLED=false`; det dedikerade scriptet äger Noter) |

## Hälsa & diagnos (läsbart på Pin)

- **`/api/health`** → `200` (publik uptime-probe). Lägg till som monitor i **Uptime Kuma**
  (redan installerad på Pin): HTTP(s) GET `http://localhost:3001/api/health`, intervall 60s.
- **`/api/health/deep`** (loopback/token-gated) → `{status, version, securityLevel,
  uptime_sec, checks:{mongo,redis}}`. Läs inifrån containern:
  `docker exec noter-backend wget -qO- http://127.0.0.1:3001/api/health/deep`.
- **state/noter.json** — senaste deploy, version, hälsa, historik (för dashboard/Komodo).
- **ntfy** — larm vid deploy/bygg-/hälsofel till topic `daylited-alerts`
  (`http://100.64.0.2:8095/daylited-alerts`). Prenumerera i ntfy-appen för realtidsnotiser.

## Vanliga åtgärder

```bash
# Tvinga en deploy nu (utan att vänta på timern):
ssh rp5 '/srv/selfhost/cicd/noter-deploy.sh --force'

# Se senaste deploy-logg:
ssh rp5 'tail -40 /srv/selfhost/cicd/logs/noter.log'

# Pausa auto-deploy:
ssh rp5 'sudo systemctl disable --now noter-deploy.timer'
# Återuppta:
ssh rp5 'sudo systemctl enable --now noter-deploy.timer'

# När deployar den härnäst?
ssh rp5 'systemctl list-timers noter-deploy.timer'
```

## SSH till Pin (nyckel-only)

`ssh rp5` (tailnet, funkar hemma+borta) eller `ssh rp5-lan` (LAN). Lösenords-auth är
avstängt; nyckel `~/.ssh/pi_rp5`. Se [[../../memory]] / `project-pi-deploy`.

## Förbättringsbacklog (CI/CD)

- [ ] Lägg Noter-monitorn i Uptime Kuma (HTTP `/api/health`) + ntfy-koppling vid down.
- [ ] Preflight-gate före build (t.ex. `scripts/ci-check.sh` likt francisco) — kör en
      snabb typecheck innan den tunga web-builden, så trasig kod aldrig ens byggs.
- [ ] Konsolidera de två checkouterna (`/srv/projects/noter` är en föråldrad kopia från
      2026-06-11; den dedikerade timern använder `/home/realdini/srv/projects/noter`).
- [ ] GitHub Actions: kör `validate-critical` i molnet vid PR så `dev` alltid är grön
      innan Pin ens pollar (Pin bygger då bara känt-gröna commits).
