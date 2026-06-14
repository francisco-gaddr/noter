# Kvarstående förbättringar — sammanställning (2026-06-13/14)

_Avstämning mot allt som efterfrågats igår och idag. Status per punkt + konkret nästa steg._

## Levererat & verifierat (klart, live på `dev`)

| Område | Status |
|---|---|
| PDF-textutvinning på enheten (web/Electron) | ✅ klart, byggverifierat |
| Semantisk sök: vektor + RRF-hybrid (delad kärna, krypterat index, inställningar, graf-toggle) | ✅ båda apparna |
| Mätbar produktivitets-/agentstatistik + mobil AdminDashboard (paritet) + web manuell synk | ✅ |
| Hopfällbara admin-/orkestreringssektioner | ✅ båda apparna |
| Grafvy: riktig riktad graf (synliga kanter, pilar/flödesriktning, legend) | ✅ båda apparna |
| Realtid via WSS (AI-skapat innehåll syns direkt) + `cache:invalidate`-fallback | ✅ |
| Mobil-UX: tool-use-kort visar innehåll, tangentbordssäkert länk-fält, delegerings-autofyll vid skapande | ✅ |
| Ikoner + splash (SDK 54 `expo-splash-screen`-plugin) | ✅ |
| **All WebSocket via WSS** (CSP + `enforceSecureSocketUrl`, testad) | ✅ |
| **E2E-kryptering i alla ändar** — audit + krypterat JWT/user at rest i web + provider/modell-val krypterat på mobil | ✅ |
| Honest lokal-AI-gate på mobil (ingen fejkad modell-reply) + 6 tester | ✅ |
| Testbarhet: web 121/121, Electron 224/224, mobil 350/356 (alla sviter körbara) | ✅ förbättrat |

## Kvarstående (prioriterad backlog)

### 1. ⭐ Verklig på-enheten-LLM-inferens på mobil (största punkten)
Idag är den lokala MLC-motorn **inte inlänkad** — JS-/native-bryggan är en platshållare. Nedladdning, val och krypterad lagring fungerar, men själva inferensen körs inte på telefonen (chatten ger nu ett **ärligt felmeddelande** + hänvisar till Hermes istället för en fejkad reply).
**Nästa steg:** integrera `llama.rn` (kör GGUF direkt på enheten via llama.cpp, ingen MLC-konvertering behövs) i ett EAS dev-build, skriv om `ModelManager` att använda dess `initLlama`/`completion`-API, och verifiera på en riktig enhet. Alternativt länka in MLC-AAR/pod. **Kräver native-build + enhetstest — kan inte verifieras i CI utan device.**
**Fungerar redan idag som "lokalt":** Hermes-källan (din egen Ollama/LM Studio på Pi/Mac) — ingen tredje part, krypterat.

### 2. Mobil-testsvit #12 (6 sviter)
6 render-tunga sviter faller på o-mockade expo-native-moduler (`ExponentConstants`/`ExpoUpdates`/UIManager `viewManagersMetadata`). Safe-area-kraschen är redan fixad (alla 67 sviter importerar nu).
**Nästa steg:** lägg jest-mockar för dessa native-moduler i `jest.setup.js` + triagea per test.

### 3. Graf: force-/cytoscape-layout för stora dataset
Nuvarande koncentriska ringar är tydliga men inte fysikbaserade (ADR 0006 fas 2).

### 4. Semantisk sök: koppla `autoIndex` till spar-hook
Flaggan sparas men triggar inte automatisk omindexering ännu (manuell "Indexera nu" fungerar). Gemini-embeddings (`:embedContent`) stöds ej — endast OpenAI-kompatibla.

### 5. `notes:reordered` skickar `order` i klartext över tråden
Lågkänslig sorterings-metadata; kryptera för fullständig E2E i alla ändar.

### 6. Multi-pod `aiAgent`-concurrency
In-memory-guard i backend-runnern; ofarligt på single-pod Pi, men kräver distribuerat lås vid skalning.

### 7. Automatiserade E2E-flöden (Detox/Playwright)
För graf, realtid, delegering-vid-skapande och lokal-modell-flödet.

### 8. CI dead-code (#12)
knip-fynd kvarstår som icke-blockerande.
