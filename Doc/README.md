# Noter – Doc-index

_Senast uppdaterat: 2026-06-13 · Målgrupp: utvecklare, reviewers och releaseansvariga_

> **Ny här (särskilt AI-agenter)? Börja i [`index.md`](./index.md)** — master-ingången med
> vägvisare ("jag vill … → öppna denna fil"), invarianter som inte får brytas, och den
> prioriterade nästa-steg-backloggen. Den här filen är den fullständiga kategorilistan.

Den här mappen är arbetsdokumentationen för det aktiva workspace: `noter-app/`, `electron-noter/` och tillhörande AI-, säkerhets- och releaseflöden. Dokumenten nedan ska spegla faktisk kod, inte bara planerad målbild.

## Startpunkter

| Fråga | Dokument |
|------|----------|
| Vad är nuvarande arkitektur? | [`Overview.md`](./Overview.md) |
| Vad återstår från senaste granskningen? | [`improvements.md`](./improvements.md) |
| Hur ser nuvarande webb/mobile/backend-implementation ut? | [`Implementation.md`](./Implementation.md) |
| Hur fungerar AI- och modellflöden i app/Electron/web? | [`App AI.md`](./App%20AI.md) |
| Hur fungerar AI tool use och GraphQL-kontraktet? | [`Tool Calls.md`](./Tool%20Calls.md) |
| Vad är nuvarande säkerhetsstatus för AI/MCP? | [`AI Platform Security & Stability Review.md`](./AI%20Platform%20Security%20%26%20Stability%20Review.md) |
| Vad är status för Firefox-extensionen? | [`../noter-app/apps/firefox-extension/PROGRESS.md`](../noter-app/apps/firefox-extension/PROGRESS.md) |

## Dokumentkategorier

### Arkitektur och produkt
- [`Overview.md`](./Overview.md) beskriver nuvarande systemarkitektur, delade säkerhetsinvarianter och kända begränsningar.
- [`AI PRD.md`](./AI%20PRD.md) är produktkrav för AI-funktionaliteten.
- [`Mobile implementation.md`](./Mobile%20implementation.md) beskriver äldre mobilarbete och ska läsas som referens om den inte uttryckligen uppdaterats i samma ändringspaket.

### Implementation
- [`Implementation.md`](./Implementation.md) sammanfattar den faktiska levererade implementationen och vilka större omläggningar som nu är klara.
- [`App AI.md`](./App%20AI.md) täcker AI-runtime i web, mobil och Electron, inklusive modellproxyer och lokal modellkörning.
- [`AI impl.md`](./AI%20impl.md), [`AI mobile.md`](./AI%20mobile.md), [`LM Studio.md`](./LM%20Studio.md) och [`MLC AI.md`](./MLC%20AI.md) är djupare design- eller spårningsdokument.

### Säkerhet och kvalitet
- [`improvements.md`](./improvements.md) är den levande kritiska granskningen och backloggen för kvarvarande förbättringar.
- [`AI Platform Security & Stability Review.md`](./AI%20Platform%20Security%20%26%20Stability%20Review.md) sammanfattar genomförda AI/MCP-förstärkningar och kvarstående risker.
- [`Security Regression Suite.md`](./Security%20Regression%20Suite.md) beskriver verifieringskrav för säkerhetskritiska ändringar.
- [`Optimization Verification Matrix.md`](./Optimization%20Verification%20Matrix.md) och [`Benchmark Report - AI, Sync and Large Lists.md`](./Benchmark%20Report%20-%20AI%2C%20Sync%20and%20Large%20Lists.md) används vid prestanda- och regressionsarbete.

### Release och drift
- [`Electron & Mobile Build Readiness Runbook.md`](./Electron%20%26%20Mobile%20Build%20Readiness%20Runbook.md) beskriver verifieringsflöden inför mobil- och Electron-build.
- [`Open Source Release Guide.md`](./Open%20Source%20Release%20Guide.md) och [`Public Release Commit Checklist.md`](./Public%20Release%20Commit%20Checklist.md) styr publicerings- och open-source-hygien.

## Snapshot 2026-04-23

| Område | Nuvarande läge | Nästa dokument att läsa |
|--------|----------------|-------------------------|
| Klientkryptering | `DEFAULT_KEY` är borttagen, aktiv nyckel måste bootstrapas explicit, men payloadformatet är fortfarande CryptoJS-baserat | [`Overview.md`](./Overview.md), [`improvements.md`](./improvements.md) |
| Nyckelbootstrap | Web och mobil använder wrapped data key med `wrappedDataKey` + `salt` från backend | [`Overview.md`](./Overview.md), [`Implementation.md`](./Implementation.md) |
| GraphQL | Backend returnerar rå ciphertext och klienterna krypterar/dekrypterar lokalt via `packages/shared/src/graphqlCipher.ts` | [`Tool Calls.md`](./Tool%20Calls.md), [`Implementation.md`](./Implementation.md) |
| Web AI-route | Auth krävs och `modelPath` låses till tillåten modellkatalog | [`App AI.md`](./App%20AI.md) |
| Electron-härdning | CSP, bridge-allowlist och header-sanering finns nu i `electron-noter/main.js` | [`App AI.md`](./App%20AI.md) |
| Firefox-extension | Minimal faktisk extension finns nu med manifest, bakgrundsscript, sidebar och capture-kö | [`../noter-app/apps/firefox-extension/PROGRESS.md`](../noter-app/apps/firefox-extension/PROGRESS.md) |

## Skrivregler

1. Beskriv faktisk kodstatus först och målbild därefter.
2. Markera tydligt vad som är verifierat, vad som är plan och vad som fortfarande är risk.
3. Uppdatera indexet när nya dokument tillkommer eller när statusen i ett dokument ändras väsentligt.
4. Håll nya filnamn ASCII-baserade och helst utan mellanslag, även om äldre filer får ligga kvar.
5. Om ett dokument inte längre är korrekt, skriv om det eller markera det som historiskt i stället för att låta felaktiga checklistor leva vidare.

## Relaterat i repo-roten

- `README.md` är publik översikt.
- `improvements.md` i roten är äldre teknisk skuldbakgrund och överlappar delvis med [`Doc/improvements.md`](./improvements.md).
- Lokala agentfiler och allt under `.trae/` är arbetsfiler och ska inte publiceras.
