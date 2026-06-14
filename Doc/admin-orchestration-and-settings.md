# Admin, AI-orkestrering och inställningar

_Senast uppdaterat: 2026-06-14 · Gäller `noter-app/apps/{web,mobile}`, `electron-noter/` och `packages/shared`._

Detta dokument beskriver admin-sektionen, AI-orkestreringen och inställningarna med full paritet mellan mobil och Electron/web, samt den mätbarhet som gör att förbättringar går att följa över tid. Det bygger vidare på [`Overview.md`](./Overview.md) (arkitektur + säkerhetsinvarianter) och [`App AI.md`](./App%20AI.md) (AI-flöden).

## 1. Delad, mätbar kärna (`@repo/shared/insights`)

All statistik beräknas av rena, datuminjicerade och enhetstestade funktioner i `packages/shared/src/insights.ts` — **en enda källa**, återanvänd identiskt i båda apparnas admin-vyer. Inget plaintext lämnar enheten för dessa mått; de räknas på redan avkrypterade notes/tasks i minnet.

| Funktion | Vad den mäter |
|---|---|
| `computeTaskInsights(tasks, now)` | Aktiva/klara/förfallna/idag/denna vecka, klargrad, prio-fördelning |
| `computeNoteInsights(notes)` | Antal anteckningar vs projekt vs uppgiftslistor |
| `computeProductivityStats(tasks, now)` | **Mätbarhet över tid:** klara senaste 7/30 dgr, skapade 7 dgr, genomflöde (klart/skapat), per-dag-serie (7 dgr), nuvarande svit (streak), snitt per aktiv dag |
| `computeAgentStats(tasks)` | **AI-orkestrering:** antal delegerade, status (idle/scheduled/running/done/error), källa (local/hermes/api), modeller i bruk, totala körningar, endast-lokalt, på-Pi |

`computeProductivityStats` använder `updatedAt` som färdig-tidsstämpel (bästa tillgängliga proxy) och lokala dygnsnycklar (matchar `startOfDay`, så dygnskolumnerna inte glider en tidszon). Testtäckning: `packages/shared/src/insights.test.ts`.

## 2. Admin-sektionen (paritet mobil ↔ Electron/web)

| Vy | Web | Mobil |
|---|---|---|
| Komponent | `apps/web/components/AdminDashboard.tsx` | `apps/mobile/components/AdminDashboard.tsx` |
| Serveröversikt | `/api/admin/overview` (version, säkerhetsnivå, DB, upptid, node, miljö) | samma endpoint via `API_URL` + auth-token |
| Konto (server) | antal notes/tasks/AI-trådar/AI-meddelanden | samma |
| Uppgiftsinsikter | aktiva/förfallna/idag/vecka/klargrad/prio/projekt/listor | samma |
| **Produktivitet** | 7/30-dgr klart, skapade, svit, snitt/aktiv dag, genomflöde + per-dag-stapeldiagram | samma |
| **AI-orkestrering** | delegerade, klara/väntar/fel, körningar, lokalt/Pi, källfördelning, modeller i bruk | samma |
| AI-användning | verktyg/skills + tokens per modell (krypterat lokalt) | samma (`getToolUsageRows`/`getAllUsageRows`) |
| Städning (batch) | `AdminCleanup` — tomma notes, titellösa tasks, klara tasks; "Rensa allt" | samma |

Allt renderas som vanliga rader/rutor utan klippande fasta höjder, så **hela vyn är scrollbar och synlig** — inget avskuret. Mobilen visar dashboarden i inställningarnas sektion "Admin & orkestrering".

### Säkerhet
- `/api/admin/overview` skyddas med JWT (Bearer). Endast den inloggade användarens egna räknare returneras (ingen cross-user).
- Lokala mått (insikter, produktivitet, AI-användning) beräknas på redan avkrypterad klientdata; inget plaintext skickas till servern.

## 3. AI-orkestrering

Orkestreringen styrs per delegerad uppgift via det strukturerade fältet `aiAgent` på `Task` (`packages/shared/src/agentTasks.ts`, `AiTaskDelegation`):

- **Källa/modell:** `source` (`local` | `hermes` | `api`), `provider`, `model`, `baseUrl`.
- **Läge:** `localOnly` (kör helt lokalt, synkas/spåras aldrig), `runOnBackend` (alltid-på Pi).
- **Kontextnivå:** `contextLevel` (`minimal`/`fast`/`standard`/`deep`) — styr hur mycket data/sök agenten får använda (`contextLevels.ts`).
- **Roll/persona + budget (Paperclip-paritet):** `role` (kort steer i system-prompten) + `budget` (`maxStepsPerRun`, `maxRuns`, `maxTokens`, `maxCredits`) som hårda spärrar i runnern.
- **Minne:** `memoryProjectIds` — projektmappar agenten läser som sitt kunskaps-/MD-minne och planerar i (`agentMemory.ts`). Faller tillbaka till "AI-agent"-projektet.
- **Säkerhet (HARD invariant):** agenten läser **aldrig** låsta anteckningar/projektmappar — `@repo/shared/locks` filtrerar innan innehåll når modell eller minne.

Schemaläggning sker via `selectDueAiTasks` (delad, ren logik) i tre tunna körare: mobil-foreground, Electron-foreground och Pi-backend (`backendAgentRunner`). Admin-vyns "AI-orkestrering" visar utfallet av detta (vilka modeller/källor, körningar, fel) så man kan se **hur agenterna används när och hur**.

## 4. Inställningar och best-practice-defaults (juni 2026)

Defaults är valda för säkerhet + integritet + prestanda och verifierade som rimliga; vi ändrar inte fungerande defaults utan värde.

| Inställning | Default | Motivering |
|---|---|---|
| Auto-lås (web) | 15 min | Branschnorm för balans säkerhet/UX på desktop. |
| Auto-lås (mobil) | Omedelbart | Mobil är mer exponerad → säkrast default; användaren kan öka till upp till 12 h. |
| E2E-kryptering | AES-256-GCM, nyckel härledd via Argon2id, stannar i sessionen | Modern AEAD + minneshård KDF; nyckeln lämnar aldrig enheten/servern. |
| AI-kontextnivå | `standard` | Balans mellan kontextbredd och kostnad/latens. |
| Semantisk sök (embeddings) | Av (opt-in), källa `hermes`, modell `nomic-embed-text` | Integritet + prestanda: indexering körs först när användaren vill, helst mot egen modell så innehåll stannar på enheterna. |
| AI-bakgrundsarbete / backend-körning | Opt-in | Inget körs på Pi utan medvetet val. |

Paritet i inställningar (båda apparna): språk, tema, auto-lås, E2E-aktivering + lösenordsbyte, **manuell synk ("Synka nu" + pending + offline-status)**, backend-URL, AI-leverantör/modell/nycklar, system-prompt, kontextnivå, verktygsanvändning, MCP-konfiguration, nästa-tråd-endast-lokalt, semantisk sök (`EmbeddingsSettings`).

## 5. Verifiering

- Delad svit: `packages/shared` — 24 sviter, alla gröna (inkl. nya `insights`-tester för produktivitet + agentstatistik).
- `tsc --noEmit` rent på web + mobil; `next build` + Electron statisk export gröna.
- Pi-deploy via `noter-deploy.timer` → health 200, deep-status ok.

Se [`improvements.md`](./improvements.md) för kvarvarande backlog och [`Security Regression Suite.md`](./Security%20Regression%20Suite.md) för säkerhetstester.
