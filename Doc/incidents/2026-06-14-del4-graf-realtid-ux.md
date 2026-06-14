# Del 4 — Graf, realtid, mobil-UX, orkestrering, ikoner & docs (slutrapport)

_Datum: 2026-06-14 · Branch: `dev` (auto-deploy Pi) · Uppföljning på Del 1–3._

Fokus: konkreta "fungerar inte"-buggar + paritet + hopfällbar admin/orkestrering + ikoner/splash + dokumentation.

## 1. Vektorgrafen — riktig grafgrafik (mobil + Electron/web)

**Problem:** grafvyn ritade kanter som tunna (0.8–1.4px), 55 % opaka linjer utan pilar → på telefon såg det ut som lösa prickar ("bara listor").

**Åtgärd:**
- Ny ren, testad `edgeGeometry()` i `packages/shared/src/graphLayout.ts` — trimmar varje kant till nodkanterna och ger en pilspets vid målet (flödesriktning källa → mål). Återanvänd av både web-SVG och mobil-`react-native-svg`.
- `apps/web/components/GraphExplorer.tsx` + `apps/mobile/app/graph.tsx`: kanter nu 2px @ 0.85 opacitet med fylld pilspets per relationsfärg; större noder med centrerade etiketter; **relationsfärg-legend** över ytan. O(1) nod-uppslag. Grafvyn är fortsatt default; listvyn oförändrad.

## 2. Realtid via WSS (AI-skapat innehåll syns direkt)

**Verifierat komplett:** AI-chattens tool-use skapar via `store.createNote`/`createTask` → `api` → backend emittar `note:created`/`task:created` till `user:<id>`-rummet (GraphQL-resolvers, REST-rutter och Pi-agent-runnern). Backend joinar rummet vid anslutning; båda klienterna registrerar lyssnare som materialiserar + lägger till entiteten. Innehåll propagerar alltså utan omladdning.

**Säkerhetsnät tillagt:** båda stores lyssnar nu på change-stream-eventet `cache:invalidate` (emittas vid varje ägd DB-skrivning) och gör en debouncad (600 ms) refetch, så även ett missat specifikt event ändå syns live. De-dupliceras vid reconnect.

## 3. Mobil-UX

- **Tool-use-kort:** fick riktig `surfaceVariant`-bakgrund (var transparent → osynlig text) + 2-radig innehållsförhandsvisning även hopfällt, full markerbar text expanderat. Aldrig tomt.
- **Länk-input + tangentbord:** uppgiftseditorn wrappad i `KeyboardAvoidingView` + stor bottenpadding + interaktiv dismiss → "Länka till andra (graf)"-fältet och förslagslistan döljs inte längre bakom tangentbordet.
- **Delegera vid skapande:** `AiDelegationSection` stöder nu ett kontrollerat **draft-läge**. Att slå på delegering för en ny uppgift förifyller senaste källa/modell/kontext **och** visar de fulla redigerbara kontrollerna direkt; draften sparas på uppgiften vid skapande.

## 4. Egen hopfällbar admin-/orkestreringssektion (paritet)

- Mobil `AdminDashboard`: varje sektion (Server, Konto, Insikter, Produktivitet, AI-orkestrering, AI-användning) har en tryckbar ▸/▾-rubrik; tyngre statistik startar hopfälld.
- Web `AdminDashboard`: sektioner som native `<details>/<summary>` (tillgängliga, hopfällbara).
- Statistiken (produktivitet + agent-orkestrering) kommer från delade, testade `insights.ts` (se [`admin-orchestration-and-settings.md`](../admin-orchestration-and-settings.md)).

## 5. Ikoner & splash

Expo SDK 54 ignorerar den gamla `expo.splash`-nyckeln — splash måste konfigureras via `expo-splash-screen`-pluginet (dependencyn fanns men låg inte i `plugins`). Lade till pluginet (image + imageWidth + contain + ljus/mörk bakgrund) och tog bort den deprecerade nyckeln. App-ikon + Android adaptive icon var redan korrekt konfigurerade.

## 6. Dokumentation

Utökade befintlig struktur: [`index.md`](../index.md) (vägvisare + kodkarta) och [`README.md`](../README.md) länkar nu admin/orkestrering, grafvyn och semantisk sök. Ny [`admin-orchestration-and-settings.md`](../admin-orchestration-and-settings.md) och Del 3-rapporten kvarstår.

## 7. Verifiering

- Delad svit grön (inkl. ny `edgeGeometry`-test); `tsc --noEmit` rent på web + mobil; `next build` + Electron statisk export gröna; Pi-deploy health 200.

## 8. Kvarvarande / förslag framåt

1. **Force-/cytoscape-layout** för grafen vid stora dataset (nuvarande koncentriska ringar är tydliga men inte fysik-baserade) — ADR 0006 fas 2.
2. **Mobil-testflakighet (#12):** `react-native-safe-area-context` saknar jest-mock → 8 sviter "failed to run". Egen avgränsad insats.
3. **Detox/Playwright-E2E** för graf + realtid + delegering-vid-skapande.
4. **autoIndex** (semantisk sök) ännu inte kopplad till spar-hook (manuell "Indexera nu" fungerar).
