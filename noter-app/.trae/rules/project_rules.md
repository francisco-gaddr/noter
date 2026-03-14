# Project Rules

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
- `npm run check-types` och `npm run lint` måste vara gröna innan ändringar betraktas som färdiga.
- Testnamn ska beskriva beteende och förväntat utfall, inte implementation.
- Säkerhetsändringar i backend kräver minst ett test som verifierar access-scope per användare.
- Krypteringsändringar kräver test som verifierar att data inte lagras i klartext.

## Skalning, Stabilitet och Robusthet

- Nätverksanrop ska ha tydlig felhantering, timeoutstrategi och fallback för offline-läge där det är relevant.
- State-uppdateringar ska vara idempotenta och tåla dubbla events från sync/socket utan datakorruption.
- Funktioner som hämtar stora listor ska undvika onödiga full-reloads och använda chunking/batching där det finns stöd.
- Ändringar i synkflöden ska verifieras för race conditions mellan lokal cache, socket-events och HTTP-respons.
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

## Electronapp — Kvalitetsregler

- Renderer får inte hantera råa hemligheter; känslig lagring ska ske via säker bridge/main-process med strikt API-kontrakt.
- IPC ska vara allowlist-baserad per kanal, validera payload-scheman och returnera sanitiserade felmeddelanden.
- WebPreferences ska följa säker baseline: contextIsolation aktiv, nodeIntegration av, remote module av och strikt navigation-policy.
- Dashboard- och AI-inställningsvyer i Electron ska vara fullt nåbara i UI men med server-side scope-kontroll för dataåtkomst.
- Känsliga settings får inte speglas till localStorage när säker bridge-lagring finns tillgänglig.
- Electronflöden ska verifieras för återhämtning efter renderer-reload, app-restart och tillfälliga backendavbrott.

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
- Kör backend-, web- och mobile-tester för berörda förändringar, inklusive E2E där UI påverkats.
- Bekräfta att befintlig funktionalitet i AI-inställningar och MCP-flöden är bakåtkompatibel.
- Följ verifieringsmatrisen i `.trae/rules/engineering_playbook.md` och inkludera leveransbevis enligt playbooken.
- För krypteringsleveranser ska leveransbevis täcka hela kedjan: klient-payload krypterad, server validerar ciphertext, server lagrar ciphertext, lokal lagring är ciphertext.
- För mobil/electron-paritet ska leveransbevis inkludera minst ett test per plattform som verifierar samma beteende.
- För intrångsskydd ska leveransbevis inkludera minst ett negativt test för injektionsförsök mot API/databaslager.

## Build Readiness och Release

- Electron-leveranser ska validera `electron-noter` med `npm run verify:build-ready`, `npm test` och minst en `build:web` i samma leverans.
- Mobilleveranser som påverkar Expo/EAS ska validera `apps/mobile` med `npm run verify:build-ready`, `npm run build:apk:ready` och `npm run build:apk:preflight`.
- EAS-profiler för APK ska bibehålla `android.buildType: apk` i både `preview` och `apk` om inte en medveten releaseändring dokumenteras.
- Build readiness-dokumentation ska uppdateras när scripts, profiler eller releaseflöden ändras.
- CI ska ha separat verifiering för mobile EAS och electron build, inklusive dependency-installation och byggbara artefakter.
