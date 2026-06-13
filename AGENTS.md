# AGENTS

## Syfte
- Definierar hur agenter och automation ska arbeta i detta workspace.
- Standardiserar säkerhet, kvalitet, testning, release och dokumentation.
- Är normativ toppnivå för hela workspace: `noter-app`, `electron-noter`, dokumentation och CI-relaterade artefakter.

## Lokal sekretess
- Denna fil, `agent.md`, `RULES_INDEX.md`, `INSTRUCTIONS.md` och allt under `.trae/` är lokala arbetsfiler.
- De får inte checkas in, packas in i EAS-bygg eller publiceras i open source-repot.
- Om en lokal agentregel eller skill ändras ska ignore-regler och open-source-sanity fortsatt stoppa oavsiktlig publicering.

## Styrhierarki
- Vid konflikt gäller detta dokument först.
- Därefter gäller `agent.md` som navigations- och beslutsstöd för vilken underregel som ska användas.
- Därefter gäller projektspecifika regler i `noter-app/.trae/rules/`.
- Därefter gäller relevanta skills för specialfall som release readiness, mobil AI eller lokal säkerhet.
- `INSTRUCTIONS.md` är drift- och infrastrukturguide, inte agentpolicy.

## Aktiv arbetsyta
- `noter-app/` innehåller aktivt monorepo med `apps/mobile`, `apps/web`, `apps/backend`, `apps/docs`, `packages/*`.
- `electron-noter/` innehåller aktiv Electron-shell, preload/main process och build-pipeline mot web-renderer.
- `Doc/` innehåller runbooks, säkerhetsgranskningar och arkitekturbeskrivningar som ska hållas uppdaterade.
- Parallella eller äldre katalogträd får behandlas som referens eller arkiv om inte uppgiften uttryckligen gäller dem.

## Prioriteringar
- Säkerhet först för data at rest och data in transit.
- Rätt funktionalitet före optimering.
- Verifierad leverans före handoff.
- Konsistent UX mellan mobil, web och Electron.
- Full i18n-kvalitet för svenska och engelska.
- Release readiness för EAS APK och Electron ska bevisas med faktisk build-gate, inte bara konfiggranskning.
- Task- och notes-flöden ska kännas omedelbara i UI även när lokal persistens, sync och påminnelser kör i bakgrunden.
- Startup, navigering, övergångar och stora listor ska optimeras för att undvika dubbelarbete, långa seriekedjor och UI-blockering.
- Bakgrundsladdning ska prioriteras framför blockerande foreground-laddning när samma slutresultat kan uppnås säkert.
- Reminder/notis-flöden ska vara idempotenta; samma task får inte schemalägga flera samtidiga lokala notifieringar för samma trigger.
- Slutförda eller raderade tasks får aldrig lämna kvar aktiva notifieringar lokalt.

## Relevansstyrning
- Läs bara de lokala regler och skills som faktiskt minskar risk eller sökkostnad för den aktuella uppgiften.
- Välj den minsta uppsättning lokala dokument som täcker uppgiftens riskprofil: fullstack, säkerhet, release, i18n, mobil AI eller drift.
- Om uppgiften spänner över flera klienter ska fullstack-skill prioriteras före ytspecifika mikrofiler.
- Om uppgiften kan påverka push, packaging, EAS, ignore-regler eller open source-publicering ska CI/CD- och release-skills alltid bedömas först.
- Om ändringen rör lås, kryptering, settings eller credential-lagring ska säkerhetsskills behandlas som obligatoriska.

## Arbetskontrakt för agenter
- Börja i `agent.md`, läs sedan endast de regler som är relevanta för aktuell yta.
- Arbeta i små, verifierbara steg.
- Följ befintliga mönster i respektive app.
- Introducera inga nya bibliotek utan att först verifiera behov och kompatibilitet.
- Ändra inte semantik i lås/krypteringsflöden utan explicit testtäckning.
- Återställ aldrig användarens avsiktliga lokala ändringar.
- Om två dokument överlappar ska agenten välja den mest specifika regeln och dokumentera antagandet i leveransen.
- Om en regel inte kan verifieras praktiskt ska agenten behandla arbetet som ofullständigt.

## Standardflöde för arbete
- Kartlägg först vilka appar, paket, dokument och scripts som faktiskt påverkas.
- Identifiera säkerhetsrisker, databanor, stateflöden och releasepåverkan innan kod eller dokumentation ändras.
- Uppdatera kod, tester och dokumentation i samma leverans när beteendet ändras.
- Verifiera med relevanta tester, typecheck, lint och build-gates innan handoff.
- För prestandaarbete ska agenten aktivt leta efter dubblett-fetches, onödiga full-rerenders, seriell I/O och långa JS-loopar innan ny funktionalitet adderas.
- Sammanfatta vad som ändrades, hur det verifierades och vilka kvarvarande risker som finns.

## Proaktiv skill-användning
- `release-readiness-gate` när release readiness, EAS, Electron packaging eller större konfigändringar berörs.
- `noter-ci-cd-guardian` när scripts, workflows, ignore-regler, publish-säkring eller build automation ändras.
- `noter-fullstack-delivery` när en bugg eller feature korsar backend, state, sync och minst en klientyta.
- `security-at-rest-auditor` eller `noter-local-security-hardening` när lokal persistens, lås eller settings påverkas.
- `mobile-ai-e2e-verifier` när mobil AI, modellflöden eller provider-integrationer påverkas.
- `mobile-i18n-guardian` när mobil användartext, dialoger, tabs eller språkväxling ändras.

## Säkerhetsregler
- Lagra aldrig secrets i klartext i lokala filer eller localStorage för produktionsflöden.
- Lagra API-nycklar med plattformens säkra mekanismer.
- Exponera aldrig dekrypterat låst innehåll innan korrekt upplåsning.
- Visa aldrig rå ciphertext som fallback i UI; vid dekrypteringsfel ska appen maska eller visa tomt innehåll.
- Logga aldrig känslig data som token, lösenord, nycklar eller råa krypteringsnycklar.
- Dekryptera endast i runtime-sammanhang där behörighetskontroll redan passerat.
- AI-sync får aldrig falla tillbaka till att visa rå krypterad text; decrypt-fel ska maskas i mobil, web och Electron.
- Säkerhetskänsliga API-flöden ska ha fail-closed-validering, rimliga payload-gränser och skydd mot injektion, sabotage och brute force.

## Kryptering och lås
- Alla note/task-fält som kan innehålla känsligt innehåll ska vara krypterade i lokal databas.
- Låsta projekt och anteckningar får inte rendera innehåll eller tags innan unlock.
- Ikoner för låsta projekt får visas, men inte avslöja innehållsmetadata.
- Electron-settings ska vara krypterade via OS-stödd mekanism.
- Ändringar i lås- eller unlockflöden kräver negativa tester för fel lösenord, låst parent och återläsning efter restart eller resume.

## i18n-standard
- All användarsynlig text ska gå via i18n-nycklar.
- Undvik hårdkodade engelska strängar i komponenter och skärmar.
- Svenska och engelska ska båda hållas kompletta.
- Nya nycklar läggs i `apps/mobile/services/i18n.ts` och motsvarande web-filer vid behov.

## Testpolicy
- Minimikrav vid feature eller fix:
  - Enhetstest för ny logik.
  - E2E- eller integrationstest för användarflöde.
  - Regressionsfall för tidigare bugg eller risk.
- Prestandakritiska UI-flöden ska ha regressionsskydd som verifierar optimistiska uppdateringar utan global loading-flicker.
- Prestandakritiska laddningsflöden ska verifiera att arbete kan ske parallellt eller i yielding batcher utan att UI fastnar.
- Säkerhetskritiska ändringar ska ha testbevis för att plaintext inte persisteras och att accesskontroller faktiskt stoppar felaktiga flöden.
- Obligatoriskt före handoff:
  - Relevanta workspace-tester gröna.
  - `lint` grönt där lint-gate finns.
  - `check-types` grönt.
  - Relevanta build-kommandon gröna.

## Build och release
- Mobil:
  - Verifiera readiness-script före APK-build.
  - Säkerställ EAS-profiler och ignore-regler.
  - Kör faktisk EAS Android-build när release readiness är en del av leveransen och dokumentera build-id och status.
  - Bekräfta att startup, initial sync och bakgrundsarbete inte ligger kvar som blockerande seriekedjor på kritisk UI-path före release.
  - Native AI-stöd ska verifiera filsystem, zip-stöd och MLC-modul i installerad EAS-build; Expo Go-feltext får inte användas för andra native fel.
  - AI-modellflödet ska verifiera hela kedjan: sök, filval, lokal lagring, lokal eller serverstödd konvertering, modell-load och chatt.
- AI-modellpaket ska valideras efter unzip eller konvertering genom att hitta faktisk paketrot med `mlc-chat-config.json`; agenten får inte anta att zip packas upp platt.
- Nedladdning eller konvertering ska ha tydlig progress, kunna fortsätta i bakgrunden och ge begripligt fel om paketet inte går att ladda eller måste konverteras om.
- Electron och mobil ska returnera faktiskt assistentsvar från AI-runtime till chattkedjan; tool-use får inte bygga på DB-hack eller rå stderr-token.
- Web:
  - Bygg med konfiguration som undviker kända Turbopack- och symlink-problem på Windows.
- Electron:
  - Verifiera renderer-build och fallback-beteende.
  - Håll main och preload kompatibla med `contextIsolation` och säker IPC-yta.
  - Bekräfta att renderer-start inte gör onödiga dubbelladdningar och att stora UI-ytor inte triggar överlappande fetchar vid mount.

## Dokumentationskrav
- Uppdatera runbook, säkerhetsdokument och projektregler när beteende eller flöde ändras.
- Förklara påverkan på migration, bakåtkompatibilitet och verifieringskrav när lagringsformat eller policies ändras.
- Beskriv verifieringssteg för lokala builds, testsviter och release-gates.
- Regeldokument ska vara tydligt uppdelade i syfte, scope, beslutsgång, verifiering och leveranskrav.
- Lokala agentdokument ska hållas fria från repointerna secrets, personuppgifter och driftuppgifter som inte behöver ligga på utvecklarmaskinen.

## Enforcement
- `noter-app/package.json` och scripts i `noter-app/scripts/` är den praktiska ingången till kvalitetsgates.
- `npm run validate:prepush` är blockerande miniminivå före push till delade brancher.
- `npm run test:security:deep` ska användas när säkerhet, kryptering, lock, settings eller attackhärdning berörs.
- Manuell policy utan verifiering räknas inte som färdig leverans.

## Definition of Done
- Funktion uppfyller krav i alla berörda klienter.
- Säkerhetskrav för lagring, transport och låsning är verifierade.
- Översättningar för sv/en är täckta där användarsynlig text berörs.
- Tester, lint, typecheck och relevanta builds är gröna.
- Dokumentation är uppdaterad där ändringen påverkar drift, utvecklarflöde eller agentarbete.
- Lokala Trae-/agentfiler förblir ospårade och exkluderade från Git, EAS och publika releaseartefakter.
