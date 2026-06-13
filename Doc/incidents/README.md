# Incidents & postmortems

Den här mappen lagrar postmortems för Noter-incidents. Vi kör **blameless
postmortems** i Google-stil — fokus är på systemet, inte på personerna.

## När en incident inträffar

1. Skapa Slack-tråd `#inc-YYYYMMDD-<keyword>`.
2. Utse incident commander (IC). IC samlar status, fattar mitigation-beslut.
3. Mitigera. Skriv `start_time`/`end_time` i tråden.
4. Inom 72 h efter resolve: kopiera [`TEMPLATE.md`](./TEMPLATE.md) till
   `YYYY-MM-DD-<keyword>.md` och fyll i.
5. Boka 30-min retro inom 7 dagar. PR action items till relevanta backlogs.

## Severity-stege

| Sev | Definition | Pager |
|-----|------------|-------|
| SEV1 | Allt eller många användare blockerade (login, sync). Data-loss/leak. | Direkt |
| SEV2 | En större feature trasig. Workaround finns. | Inom 30 min |
| SEV3 | Mindre feature degraderad. Inga blockers. | Inom 4 h |

## Konventioner

- En postmortem per incident, namn `YYYY-MM-DD-<slug>.md`.
- Action items får **inte** vara "var mer försiktig". Konkreta tickets eller bortkastat.
- Lägg PR-länkar i tabellen där lärdomarna landade i kod.
