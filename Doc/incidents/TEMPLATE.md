# Postmortem — &lt;Incident title&gt;

> _Senast uppdaterat: YYYY-MM-DD · IC: &lt;name&gt; · Severity: SEV1 / SEV2 / SEV3_

Skapas inom 72 timmar efter incident-end. Mall är Google-stil-blameless: vi
diskuterar systemet, inte personer.

## Sammanfattning

En–två meningar. Vad hände, vad fick användarna märka, hur löstes det.

## Status

| Fält | Värde |
|------|-------|
| Datum (start) | YYYY-MM-DD HH:MM TZ |
| Datum (slut) | YYYY-MM-DD HH:MM TZ |
| Detection-latens (start → första larm) | &lt;mm&gt; |
| Mitigation-latens (första larm → mitigation) | &lt;mm&gt; |
| Berörda komponenter | backend / web / mobile / electron / mcp / … |
| Berörda användare | &lt;antal eller fraktion&gt; |
| Datapåverkan | ingen / läs / skriv / tappad / läckt |
| Severity | SEV1 / 2 / 3 |
| IC | &lt;namn&gt; |
| Author | &lt;namn&gt; |

## Tidslinje

Alla tider i Europe/Stockholm. Var konkret, citera log-rader och commit-hash där relevant.

- 14:02 — &lt;event&gt;
- 14:05 — alert X fires (`alert-name`)
- …

## Påverkan

- **Vad upplevde användarna?**
- **Vilken data berördes?**
- **Vad missade vi?** (latent fel, känt fel, helt okänt)

## Rotorsaks-analys (5 whys)

1.
2.
3.
4.
5.

Ange den slutliga rotorsaken med en mening.

## Vad gick *bra*?

Lista observerbara saker som hjälpte. Detta är inte artighet — det är hur vi vet vilka system att *behålla*.

## Vad gick dåligt?

Brist på alerts, otydlig runbook, dålig observability — beskriv konkret.

## Action items

| ID | Owner | Type | Due | Status |
|----|-------|------|-----|--------|
| AI-1 | @user | prevent / detect / mitigate | YYYY-MM-DD | open |

Minst en _prevent_ + en _detect_ per incident.

## Bilagor

- Länkar till PR:er som mitigerade
- Skärmavbilder
- Relevanta dashboards / Slack-trådar
