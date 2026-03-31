# Project Rules

## Scope och prioritet

- Detta dokument innehåller projektspecifika tekniska regler för aktiv utveckling i `noter-app/`, `electron-noter/` och tillhörande dokumentation.
- Rotens `AGENTS.md` är överordnad vid konflikt.
- `project_prompt.md` styr hur agenten ska resonera; detta dokument styr vad som faktiskt är tillåtet, obligatoriskt och verifierbart.
- `engineering_playbook.md` operationaliserar reglerna till kommandon, gates och leveransbevis.
- `INSTRUCTIONS.md` används endast för drift och deploy, inte som regelkälla för utvecklingspolicy.
- Parallella eller äldre katalogträd får inte användas som normativ källa om inte uppgiften uttryckligen gäller dem.

## Whats New / Changelog

- Varje gång mobilappen eller Electron-appen ändras i en leveransbar build ska `packages/shared/src/whatsNew.ts` uppdateras.
- En ny post ska alltid läggas först i `WHATS_NEW_ENTRIES` med:
- `version`
- `build`
- `date` (YYYY-MM-DD)
- `highlights` (kort sammanfattning i punktform)
- Inställningsvyer i både mobile och web/electron ska visa senaste changelog via `WHATS_NEW_ENTRIES`.
- Ändringar får inte levereras utan att What's New-listan har uppdaterats för aktuell build.

## Säkerhet och Kryptering

- Låsta anteckningar och låsta projektmappar får aldrig exponeras i AI prompts, AI tool-resultat, loggar eller debugutskrifter.
- Krypterad data ska alltid hanteras via delade helpers i `@repo/shared` och aldrig med parallell egen kryptologik i featurekod.
- Lösenord får aldrig loggas, persistas i klartext eller inkluderas i testfixtures som delas externt.
- Upplåsning av skyddad data ska kräva explicit verifiering och vara sessionsbunden om inte annat är definierat i backend-kontraktet.
- Ändringar i auth/lock/crypto-flöden kräver negativa tester (fel lösenord, saknat token, låst parent, offline-fall).
- Nya backend-loggar med säkerhets- eller användardata ska krypteras at rest och ha dokumenterad retention-policy.
- API-trafik med hemligheter eller säkerhetsmetadata ska använda HTTPS i alla miljöer utanför localhost/dev.
- MCP-relaterad telemetry får endast exponeras via user-scope:ade endpoints och dedikerad dashboard-vy.
- AI-inställningar som innehåller tokens, API-nycklar eller credentials måste klassas som känsliga och får inte skrivas till okrypterad lagring.
- Känsliga settings-värden får inte inkluderas i console.log, felmeddelanden, telemetry eller E2E-artifacts.
- Nya krypterade backend-lager ska använda AEAD och verifierad dekryptering med fail-closed-beteende.
- När krypterad persistens används för audit/loggar ska key-rotation stödjas via key ring och versionsmarkerat payloadformat.

## Tester och Kvalitet

- Nya funktioner ska ha minst ett enhetstest för normalfall och ett test för fel-/kantfall.
- Säkerhetskritiska flöden ska täckas av både unit/integration och minst ett E2E-scenario.
- Före leverans ska relevanta suites i web, mobile och backend köras för berörda förändringar.
- Före varje push till `dev`/`main` ska `npm run validate:prepush` köras från repo-roten och passera.
- `validate:prepush` är obligatorisk gate för notes, tasks, AI-chatt, säkerhet och fallback/felhantering i backend/web/mobile/electron.
- När auth, lock, kryptering, settings, IPC, AI-sync eller request-härdning ändras ska `npm run test:security:deep` betraktas som standardvalidering om inte en snävare verifiering kan motiveras.
- `npm run check-types` och `npm run lint` måste vara gröna innan ändringar betraktas som färdiga.
- Testnamn ska beskriva beteende och förväntat utfall, inte implementation.
- Säkerhetsändringar i backend kräver minst ett test som verifierar access-scope per användare.
- Krypteringsändringar kräver test som verifierar att data inte lagras i klartext.

## Skalning, Stabilitet och Robusthet

- Nätverksanrop ska ha tydlig felhantering, timeoutstrategi och fallback för offline-läge där det är relevant.
- State-uppdateringar ska vara idempotenta och tåla dubbla events från sync/socket utan datakorruption.
- Funktioner som hämtar stora listor ska undvika onödiga full-reloads och använda chunking/batching där det finns stöd.
- Startup- och hydrationsflöden får inte trigga dubbla note/task-fetches eller parallella refreshar mot samma scope utan explicit deduplicering.
- Ändringar i synkflöden ska verifieras för race conditions mellan lokal cache, socket-events och HTTP-respons.
- Optimistiska mutationer för tasks/notes får inte slå på global loading-state om UI redan kan uppdateras lokalt säkert.
- Reminder-planering, lokal DB-persistens och sync ska flyttas bort från kritiska UI-paths när samma slutresultat kan säkras i bakgrunden.
- Långa persistensloopar för notes/tasks ska delas upp i chunkar eller yielding batcher när datasetet kan bli större än ett fåtal poster.
- UI-komponenter i inställningar och säkerhetsflöden ska ha stabila testID/data-testid för E2E-automation.
- Backendflöden med externa integrationer ska ha rate-limit, input-sanitization, retries med kontrollerad budget och tydlig circuit-breaker-strategi.
- Nya observability-flöden ska inkludera health-endpoint eller dashboard-support med åtkomstkontroll och minimal dataexponering.
- Mobil och Electron-flöden ska validera transportpolicy vid runtime och ge tydliga fel för osäkra endpoints.
- Alla nya dashboard-endpoints ska ha query-bounds, pagineringsgränser och default-limit för att skydda stabilitet.
- Dashboard-funktioner för säkerhetsdata ska vara upptäckbara via AI-inställningar i både mobil och web/electron.
- API ska blockera NoSQL/SQL-injektionsmönster, prototype-pollution-keys och onormalt långa URL:er innan affärslogik körs.
- Skrivande API-endpoints ska kräva `application/json` och returnera tydlig 415 för avvikande content-type.
- Säkerhetskänsliga endpoints (auth, lock-verifiering, graphql) ska ha separata rate-limiters utöver global limiter.
- Felrespons för 5xx får inte läcka interna detaljer, stacktrace eller databasinformation i produktion.

## Mobilapp — Kvalitetsregler

- Secrets och tokens får endast lagras i SecureStore och aldrig i AsyncStorage, logs eller crash-metadata.
- AI-inställningar ska vara användarscope:ade, versionsmarkerade och ha migration/fallback till säkra default-värden.
- AppState-övergångar ska hanteras explicit: på bakgrundsläge ska tunga AI-resurser frigöras eller fortsätta endast vid explicit opt-in.
- Nätverksflöden ska ha timeout, retry-budget, exponentiell backoff och tydlig hantering av offline/online-återhämtning.
- Mobil-UI för säkerhetsdashboard ska ha stabila testID, visa tydliga felmeddelanden och aldrig rendera känsligt innehåll i klartext.
- Nya AI-inställningar ska testas för cold start, app-resume, token-förnyelse och 401-flöden utan att användarstate korruptas.
- Task-editor i mobilappen ska ha single-tap-beteende även med öppet tangentbord; `keyboardShouldPersistTaps` får inte regressa.
- När förfallodatum/förfallotid väljs i mobilappen ska påminnelse aktiveras automatiskt med default-offset `vid förfallotid` om användaren inte valt annat.
- Mobilens AI-inställningar ska alltid innehålla separata vyer för `Modeller` och `AI Instruktioner` med samma kärnkapabilitet som web/electron.
- Mobilens startup, bakgrundsrefresh och listvyer ska föredra parallella reads, indexerade parent-barn-strukturer och minimerade AsyncStorage-rundor framför upprepade fullskanningar.

## Electronapp — Kvalitetsregler

- Renderer får inte hantera råa hemligheter; känslig lagring ska ske via säker bridge/main-process med strikt API-kontrakt.
- IPC ska vara allowlist-baserad per kanal, validera payload-scheman och returnera sanitiserade felmeddelanden.
- WebPreferences ska följa säker baseline: contextIsolation aktiv, nodeIntegration av, remote module av och strikt navigation-policy.
- Dashboard- och AI-inställningsvyer i Electron ska vara fullt nåbara i UI men med server-side scope-kontroll för dataåtkomst.
- Känsliga settings får inte speglas till localStorage när säker bridge-lagring finns tillgänglig.
- Electronflöden ska verifieras för återhämtning efter renderer-reload, app-restart och tillfälliga backendavbrott.
- Electron/web-renderern ska undvika överlappande startup-fetches, onödiga mount-triggerade laddningar och upprepade fulla lookup-pass i editor- och sidebarflöden.

## AI och Inställningskvalitet

- Alla AI-inställningar ska ha tydliga gränsvärden, validering och säker default-konfiguration.
- Feature-flags för AI/MCP ska kunna stängas av utan migreringsfel eller dataförlust.
- Tool-use-flöden ska vara deterministiska nog för testning: tydliga preconditions, begränsad iteration och reproducerbara fel.
- AI-dashboarddata ska separeras mellan operativ hälsa och audit-historik för att minimera dataexponering.
- Ändringar i prompt/reglering ska testas mot både lokala Noter-verktyg och externa MCP-routingar.

## Granskningsprotokoll

- Varje större AI/MCP-leverans ska inkludera en kort riskgranskning: data leakage, auth-scope, replay, rate-limit och recoverability.
- Definition of Done för säkerhetskritiska ändringar kräver: kodändring, tester, dokumentation och verifierad dashboard-nåbarhet.
- Om en förbättring ökar robusthet men kräver extra komplexitet ska robusthet prioriteras före kortsiktig implementationstid.

## Leveranschecklista

- Uppdatera relevanta md-dokument när nya säkerhetsflöden, endpoints eller dashboard-sektioner införs.
- Uppdatera regel-, prompt- eller runbook-dokument i samma leverans när utvecklingsflöde, agentpolicy eller verifieringskrav ändras.
- Kör backend-, web- och mobile-tester för berörda förändringar, inklusive E2E där UI påverkats.
- Bekräfta att befintlig funktionalitet i AI-inställningar och MCP-flöden är bakåtkompatibel.
- Följ verifieringsmatrisen i `.trae/rules/engineering_playbook.md` och inkludera leveransbevis enligt playbooken.
- För krypteringsleveranser ska leveransbevis täcka hela kedjan: klient-payload krypterad, server validerar ciphertext, server lagrar ciphertext, lokal lagring är ciphertext.
- För mobil/electron-paritet ska leveransbevis inkludera minst ett test per plattform som verifierar samma beteende.
- För intrångsskydd ska leveransbevis inkludera minst ett negativt test för injektionsförsök mot API/databaslager.

## Build Readiness och Release

- Electron-leveranser ska validera `electron-noter` med `npm run verify:build-ready`, `npm test` och minst en `build:web` i samma leverans.
- Mobilleveranser som påverkar Expo/EAS ska validera `apps/mobile` med `npm run verify:build-ready`, `npm run build:apk:ready` och `npm run build:apk:preflight`.
- Mobilleveranser som påverkar Expo/EAS ska dessutom verifiera att `i18next`, `react-i18next`, Expo-plugins och `.easignore`-regler täcks av tester eller readiness-script.
- EAS-profiler för APK ska bibehålla `android.buildType: apk` i både `preview` och `apk` om inte en medveten releaseändring dokumenteras.
- Build readiness-dokumentation ska uppdateras när scripts, profiler eller releaseflöden ändras.
- CI ska ha separat verifiering för mobile EAS och electron build, inklusive dependency-installation och byggbara artefakter.
- När releasekravet uttryckligen gäller APK ska leveransbevis inkludera EAS build-id, status och eventuell nästa blockerare om cloud-build ännu inte är klar.

## GitHub-flöde och Branch-policy

- `main` ska alltid representera stabil releasekandidat och uppdateras via merge från `dev`, inte via direkta feature-pushar.
- `dev` ska vara integrationsgren för verifierade ändringar och vara synkad mot `main` efter varje godkänd leverans.
- Featurebrancher ska namnges konsekvent med prefix (`feature/`, `fix/`, `security/`, `refactor/`, `chore/`) och vara kortlivade.
- Säkerhetsfixar ska alltid gå via branch med tydlig risketikett i commit/PR-titel och kräva gröna säkerhetstester innan merge.
- Direkta pushes till `main`/`dev` ska undvikas; när undantag krävs ska det dokumenteras i leveransbevis med orsak och verifieringslogg.
- Varje merge till `dev` och `main` ska följas av snabb kontroll av `git branch -vv` och remote-status så att brancherna är fast-forward synkade.
- Otrackade build-artefakter, lokala dist-mappar och temporära filer får inte inkluderas i release-commit utan explicit avsikt.
