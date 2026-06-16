# Graph Explorer — utforska kopplingarna mellan dina entiteter

En egen sektion i både **mobilappen** och **Electron/web** för att se hela kunskaps­grafen:
anteckningar, projektmappar, uppgiftslistor och uppgifter som **noder**, och relationerna
mellan dem som **kanter** — med tydliga texter, filtrering och sortering.

## Var hittar jag den?

- **Electron/web:** grafknappen (▦ projekt-diagram) i navbaren öppnar Grafutforskaren i
  helskärm. (`components/Navbar.tsx` → `components/GraphExplorer.tsx`.)
- **Mobil:** grafikonen i anteckningsskärmens header öppnar `/graph`-skärmen.
  (`app/(tabs)/index.tsx` → `app/graph.tsx`.)

Båda kör på redan **avkrypterad data i minnet** — inget lämnar enheten, och låsta
anteckningar/mappar visas aldrig.

## Två vyer

| Vy | Vad |
|----|-----|
| **Graf** | En interaktiv SVG-graf. Noder är färgade per typ (projekt = indigo, lista = blå, anteckning = grå, uppgift = grön) med etikett-text; kanter är färgade per relation. Tryck på en nod för att markera den och se dess relationer. Helskärm i web; nyp-zooma i mobilen. |
| **Lista** | Sökbar, sorterbar lista med en detaljpanel som visar nodens relationer (tillhör / innehåller) och en "Öppna →"-knapp som hoppar till entiteten. |

## Relationer (kanter)

Strukturella (alltid härledda ur dina parent-länkar):
- `in_project` — anteckning/lista ligger i en projektmapp
- `in_list` — uppgift ligger i en uppgiftslista
- `subtask` — deluppgift

Naturliga / dynamiska (slås på med "Auto"-chipparna):
- `sibling` — **samma mapp/lista**: anteckningar i samma projektmapp länkas till varandra,
  uppgifter i samma lista länkas till varandra (begränsat per grupp för att undvika
  N²-explosion via `siblingGroupCap`).
- `same_due` — **samma datum**: uppgifter med samma förfallodag länkas.
- `linked` — **explicita länkar** du själv ritat (`Note.links` / `Task.links`,
  `EntityLink{ targetId, rel }`). Visas som standard.

Allt detta härleds i den delade, testade modellen `@repo/shared/graphModel`
(`buildGraph`, `neighborsOf`, `filterGraphByQuery`, `sortGraphNodes`) och positioneras av
`@repo/shared/graphLayout` (`layoutGraph`, deterministisk ring-layout grupperad per typ,
`RELATION_COLORS` / `NODE_COLORS`). Inget externt grafbibliotek krävs; samma kod ritar i
web (inline-SVG) och mobil (`react-native-svg`).

## Filtrering & sortering

- **Typ-filter:** visa/dölj projekt, listor, anteckningar, uppgifter.
- **Relation-filter:** visa/dölj varje relationstyp.
- **Auto-relationer:** slå på samma-mapp / samma-datum.
- **Sök:** matchar nodetiketter och tar med en hopp ut (one-hop) så relationer syns.
- **Sortering (listvy):** flest kopplingar (default), namn (A–Ö), eller typ.

## Säkerhet

Grafen byggs av `store.notes`/`store.tasks` som redan är avkrypterade i klienten, och
låsta noder är maskerade där. Grafutforskaren visar därför aldrig låst innehåll. Detta är
samma princip som skyddar AI-agenterna (se `Doc/security/ai-locked-notes.md`).

## Vidare (valfri uppgradering)

En kraftfullare layout (cytoscape.js / force-directed) är en ren uppgradering ovanpå den
nuvarande SVG-vyn; se ADR `Doc/adr/0006-knowledge-graph-and-search.md` (Fas 2). Den
explicita länk-**redigeringen** i skapa/ändra-formulären + persistens av `links`-fältet är
nästa steg (modellen + visualiseringen finns redan).

Grafen + den semantiska sökningen driver också **AI-chattens RAG-hämtning**: GraphRAG
expanderar topp-träffarna med samma grafgrannar innan reranken. Se
[`ai-retrieval-rag.md`](./ai-retrieval-rag.md) (Del 2) + ADR 0010 — samma lås-grind
(`buildIndexableEntities`) gör att inget låst innehåll någonsin ytförs.
