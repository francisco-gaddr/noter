# ADR-0002: MCP intent classification + deny-by-default

**Status:** Accepted
**Date:** 2026-05-14
**Author(s):** realdini

## Context

MCP-integration ger AI:n förmåga att anropa externa SaaS (Slack, Notion,
Google Workspace). Prompt-injection via tidigare assistent/tool-meddelanden
kan trigga oavsiktliga write-actions.

## Decision

- Deny-by-default på alla `/api/mcp/*` write-routes. `evaluatePolicy()`
  (OPA-stödd) körs *före* intent-check.
- Intent-classifier kräver: explicit service-keyword *+* verb i senaste
  user-meddelande, ingen negation-cue inom ±40 tecken.
- Audit-event loggar `intentText` i klartext (inom AEAD-encrypted store) så
  vi kan analysera false-positives.

## Considered alternatives

- **Lokal SLM-klassificering** — bättre precision men 30–80 MB extra modell
  + cold-start; vi kör regex-pipe tills accuracy är otillräcklig.
- **Always-confirm-modal** — säker men nukar UX; reserverat för
  high-impact-tools (delete, push externt).

## Consequences

- + Prompt-injection-attack från assistent-historik blockeras med
    explicit intent-check.
- + Policy-engine separat från affärslogik → enklare att audit:a.
- − Användare måste uttryckligen säga "skapa i Notion" — naturligt, men
    upptäck-pinch när det inte fungerar för dem.

## Open questions

- Lokal SLM-classifier för svenska + engelska.
- Action-level granularity (`mcp:notion.pages.create` vs allt-eller-inget).
