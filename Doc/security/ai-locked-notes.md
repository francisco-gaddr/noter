# AI får aldrig läsa låsta anteckningar eller projektmappar

**Invariant:** Varken AI-chatten eller den delegerade/schemalagda AI-agenten — på någon
plattform, inklusive den alltid-på-servern — får läsa, avkryptera eller sammanfatta
innehållet i en **låst** anteckning eller **låst** projektmapp (eller något som ligger i en
låst mapp). Låst innehåll förblir krypterat tills användaren själv låser upp det med rätt
lösenord.

## Den kanoniska kontrollen

`@repo/shared/locks` är enda källan:
- `parseLockedFlag(value)` — tolkar `locked`-flaggan (bool / sträng / krypterad sträng).
- `hasLockSignal(note)` — låst om flaggan är sann **eller** ett lösenord är satt.
- `findBlockingLockedAncestor` / `isReadableWithLocks` — en nod är oläsbar om den **eller
  någon förälder­mapp** är låst och inte upplåst (`unlockedIds`).
- `filterReadableNotes`, `maskLockedNote` — defense-in-depth.
- `AGENT_LOCK_POLICY` — texten som läggs in i varje agents system-prompt.

`apps/web` och `apps/mobile` `services/ai/security.ts` re-exporterar denna delade modul, så
chatt-verktygen, agent-verktygen och minneslagret använder **samma** implementation.

## Var den enforced

| Yta | Skydd |
|-----|-------|
| Chatt-verktyg (web/mobil) | `ensureReadableNote` / `isReadableWithLocks` på varje `list_*`/`get_*`. |
| Agent-verktyg (web/mobil) | Hård filtrering med `unlockedProtectedNoteIds` från storen; `get_note`/`get_task` på en låst nod returnerar fel, aldrig innehåll. Endast upplåsta containrar/minnen injiceras i prompten. |
| **Backend-agent (Pi)** | `loadNoteSecurityMap` avkrypterar bara lås-**flaggan** (service-nyckeln); `list_*`/`get_note` vägrar låsta noder **innan** `content` avkrypteras. Servern har ingen upplåsnings-session ⇒ varje låst nod är permanent oläsbar för agenten. |
| Agent-minne | `collectAgentMemoryNotes` hoppar över låsta noder. |
| System-prompt | `AGENT_LOCK_POLICY` säger uttryckligen åt modellen att aldrig försöka komma åt låst innehåll. |

Detta innebär att skyddet inte längre beror på "incidental" maskning i klient-storen — det
finns en hård kod-spärr i verktygslagret på varje plattform.

## Tester

`packages/shared/src/locks.test.ts` — hierarkisk låsning (låst mapp döljer barn), lösenord
som lås-signal, upplåsning via `unlockedIds`, maskning. Plus de befintliga
`ai-security.test.ts` i web/mobil.

## Bakgrund

Tidigare granskning visade att chatt-verktygen var skyddade, men agent-exekutorerna förlitade
sig på klient-storens maskning, och backend-agenten avkrypterade låst innehåll med
service-nyckeln (en verklig läcka). Detta dokument beskriver den hårda spärr som nu gäller
överallt. Se commit "SECURITY: AI agents can never read or decrypt locked notes/projects".
