# Innovation backlog — kreativa funktioner (2026-06)

_Fokus: INNOVATION, inte säkerhet. Vad som gör Noter spännande/differentierande, grundat i
2026 års note-app/PKM-trender + Noters unika position._

## Noters moat (varför vi kan göra detta bättre än andra)

Noter har redan **E2E-kryptering, local-first, on-device-AI (llama.rn/MLC), RAG (hybrid + GraphRAG),
graf/bidirektionella länkar, AI-agenter och cross-platform (web/mobil/Electron)**. 2026 års trender
pekar mot **"privacy-first AI", on-device, graf-baserad kunskap och spatiala/multimodala ytor**
([codewave](https://codewave.com/insights/note-taking-app-market-trends-analysis/),
[AFFiNE](https://affine.pro/blog/note-taking-ai-apps)). → **Differentieraren:** de kreativa
AI-funktionerna nedan kan vara **helt on-device + E2E** — ingen annan app kombinerar "wow"-AI med att
datan aldrig lämnar enheten. Det är vinkeln.

## Topp-kandidater (wow × passar stacken × återanvändning)

| # | Funktion | Vad | Återanvänder | Effort | Wow |
|---|----------|-----|--------------|--------|-----|
| 1 | **Spatial canvas / infinite whiteboard** | Placera noter som kort på en oändlig duk, dra kopplingar (Heptabase/Affine-stil); bi-dir-länkar som synliga linjer | grafdatan, backlinks | **L** | ⭐⭐⭐ |
| 2 | **Spaced-repetition flashcards från noter** | AI genererar kort/quiz ur en not, schemalägger repetition (RemNote/Knowt-stil) | AI-providers, ny scheduler | M | ⭐⭐⭐ |
| 3 | **Röst-capture + on-device transkribering** | Spela in, transkribera lokalt (Whisper-on-device), länka till noter; talaridentifiering | mobil-AI, fileIngest | L | ⭐⭐⭐ |
| 4 | **Daglig genomgång / "resurface"** | AI lyfter teman över veckan + "på denna dag" + bortglömda noter (spaced resurfacing) | RAG, cronScheduler | M | ⭐⭐ |
| 5 | **Text→diagram / sketch→not** | Beskriv i text → Mermaid/diagram; eller skiss → strukturerad text | AI-providers | M | ⭐⭐ |
| 6 | **Inline auto-länkning medan man skriver** | Föreslår backlinks/relaterat live i editorn (Mem/Tana-stil) | relatedNotes (klart!), RAG | M | ⭐⭐ |
| 7 | **Auto-titel + auto-tagg (supertags)** | AI sätter titel/taggar vid sparning; konsekvent metadata-typsystem | AI, summarize-kärnan | M | ⭐⭐ |
| 8 | **GraphRAG "fråga mina noter" + tidslinje-frågor** | "Vad bestämde jag om X förra månaden?" — graf+tid-medveten Q&A | RAG/GraphRAG, AI-chatt | M | ⭐⭐ |
| 9 | **Graf-visualisering 2.0** | Interaktiv kunskapsgraf som tänk-yta (befintlig `graph.tsx` → linjer, kluster, fokusläge) | befintlig graf | M | ⭐⭐ |
| 10 | **Tidslinje-vy (journal)** | Kronologisk ström som förenar noter/uppgifter/entries (LiveIt-stil) | befintlig data | M | ⭐ |
| 11 | **Multimodalt: bild→not (OCR/förståelse)** | Släpp bild → AI extraherar text + länkar; on-device OCR | befintlig OCR i sync-ingest | M | ⭐⭐ |
| 12 | **AI-mallar / "gör om till …"** | "Gör om till mötesnot/beslutsdokument/checklista" | AI, summarize | S | ⭐ |

## Status (bygge påbörjat 2026-06-20)

- ✅ **Delad grund** — `featureSettings.ts` (på/av + per-funktion AI-källa/modell-val), per-app-lagring, inställnings-UI (`FeatureToggles` web+mobil).
- ✅ **Delad AI-resolver** — web `services/ai/featureCompletion.ts` (`listAiOptions` + `runFeatureCompletion`) + återanvändbar `AiSourcePicker`. (mobil-resolver kvar)
- ✅ **#1 Inline auto-länkning** — live lexikalt förslag via `agentSearchNotes`, toggle, web+mobil.
- ✅ **#2 Flashcards (web)** — delad ren `flashcards.ts` (prompt + parse + SM-2, 8 tester); generera ur not via vald källa/modell + review-modal med betyg. (mobil-paritet kvar)
- ⏳ **#3 Daglig genomgång** (klient-sidig) · **#5 Röst** (capture + vald transkriberings-provider; ej on-device pga no-EAS) · **#4 Spatial canvas** (per-not-toggle).

## Föreslagen ordning (om vi kör innovations-spår)

1. **#6 Inline auto-länkning** — bygger DIREKT på `relatedNotes` (redan klar), liten yta, kännbart "smart". Snabb vinst.
2. **#2 Spaced-repetition flashcards** — hög engagemangsdrivare (studenter/PKM), återanvänder AI-providers, on-device = unik vinkel.
3. **#4 Daglig genomgång / resurface** — återanvänder RAG + cronScheduler (audit-retention-cronen visar mönstret), låg risk, hög "stickiness".
4. **#1 Spatial canvas** — den stora differentieraren (visuellt tänkande), men störst effort → eget spår.
5. **#3 Röst + on-device-transkribering** — multimodal capture, mobil-först, "privacy-wow".

## Tillägg till backloggen — prioriterat (2026-06-20)

Kandidater UTÖVER de 12 ovan, rankade efter nytta × passform × återanvändning × genomförbarhet
(no-EAS / E2E). Återanvänder mycket av det vi just byggt (AI-resolver/picker, RAG, agentSearch, graf).

**P1 — högst (störst nytta, mest återanvändning):**
| # | Funktion | Vad | Återanvänder | Effort |
|---|----------|-----|--------------|--------|
| 13 | **Inline AI-skrivassistent** | Markera text → fortsätt / utveckla / skriv om / fixa / översätt (Notion-AI-stil), i editorn | AI-resolver + picker (klart) | M |
| 14 | **Smarta samlingar (sparade semantiska sökningar)** | En "mapp"/vy definierad av en NL-fråga, auto-fylld via RAG (smart folder) | retrieval/RAG | M |
| 15 | **Auto-backlink / `[[wiki-länk]]`-autocomplete** | Skriv `[[` → fuzzy-matcha titlar → infoga länk; föreslå länkar för nämnda titlar | agentSearch (ingen AI-kostnad) | M |

**P2 — värdefullt:**
| # | Funktion | Vad | Återanvänder | Effort |
|---|----------|-----|--------------|--------|
| 16 | **"Organisera/klustra mina noter" (AI-städning)** | AI grupperar lösa noter i föreslagna ämnen/mappar ("var hör detta hemma") | RAG + AI | M |
| 17 | **Snabb-capture / global scratchpad** | Direkt-capture (hotkey/dela-till), AI auto-arkiverar senare (research: nyckel-differentiering) | store + AI | M |
| 18 | **Dubblett-/sammanfognings-förslag** | Hitta nära-dubbletter via embeddings, föreslå merge | vektor-index | S |
| 19 | **Not → presentation/slides (AI)** | Gör om en not till en deck/punkt-struktur | AI-resolver | M |
| 20 | **Vecko-/månads-digest** | Utökar daglig genomgång till längre tidsspann | #3 daily-review | S |

**P3 — senare / villkorat:**
| # | Funktion | Vad | Notering | Effort |
|---|----------|-----|----------|--------|
| 21 | **Koncept-/entitets-extraktion → index** | AI drar ut personer/projekt/teman → rikare graf | bygger på GraphRAG | M |
| 22 | **Handskrift/penna på canvas** | Stylus-input på surfplatta | multimodalt; canvas-utökning (#4) | L |
| 23 | **Webb-clipper / dela-till-Noter** | Fånga webbsidor/markeringar → krypterad not | Android-intent OK; **iOS share-extension kräver native → no-EAS-block** | M |
| 24 | **Realtids-samarbete (delade ytor)** | Co-edit i realtid | CRDT finns redan (`markdav/live.ts`) men stort | L |

**Rekommenderad insprint efter de 5 pågående:** #15 (auto-backlink — billig, kärn-PKM, ingen AI-kostnad)
→ #13 (inline AI-skrivassistent — återanvänder resolvern, hög daglig nytta) → #14 (smarta samlingar).

## Medvetet INTE här (säkerhet/härdning — separat backlog)

Säkerhets-/drift-/parity-poster ligger kvar i [`forward-roadmap-2026-06.md`](forward-roadmap-2026-06.md)
(npm-audit, E2E-test-flöden, migration-rollback, a11y, i18n m.fl.). Detta dokument är RENT innovation.

## Källor
- [Note-taking app market trends 2026 (codewave)](https://codewave.com/insights/note-taking-app-market-trends-analysis/)
- [AI note apps 2026 (AFFiNE)](https://affine.pro/blog/note-taking-ai-apps)
- [Best second brain apps 2026 (Buildin)](https://buildin.ai/blog/best-second-brain-apps-2026)
- [Best PKM software 2026 (GoLinks)](https://www.golinks.com/blog/10-best-personal-knowledge-management-software-2026/)
- [RemNote — flashcards/spaced repetition](https://www.remnote.com/) · [Best AI note-takers for students 2026 (Polar)](https://www.polarnotesai.com/blog/best-ai-note-taker-apps/)
