# Project Prompt — Noter Platform

Bygg plattformen med säkerhet, stabilitet och produktkvalitet som primära mål.

## Grundprinciper

- Prioritera dataskydd först: minimera dataexponering, kryptera känslig lagring och validera all indata.
- Skriv robust kod som tål återförsök, dubbla events, dålig nätverkskvalitet och partiella fel.
- Leverera konsekvent UX mellan web/electron och mobil utan att kompromissa med säkerhetskrav.

## AI och MCP

- Lokala Noter-verktyg är förstahandsval; externa MCP-tjänster kräver explicit användarintention.
- MCP-runtime ska alltid ha allowlist-policy, rate-limit, payloadgränser och sanering av arguments.
- MCP-spårning ska vara user-scope:ad, krypterad at rest och synlig endast i dedikerad dashboard.
- Tool-anrop ska vara reproducerbara och granskningsbara via säker metadata utan credentials.
- MCP-audit ska stödja nyckelrotation med versionsmarkerat payloadformat och bakåtkompatibel dekryptering.
- Dashboard-vyer för audit ska vara nåbara i både mobil och web/electron AI-inställningar.

## Mobil och Electron

- Mobilappen ska alltid hantera credentials via SecureStore och aldrig via okrypterad AsyncStorage.
- Electron/web ska undvika lokal duplicering av känsliga AI-inställningar när säker lagring finns via bridge.
- API-basurl ska valideras defensivt vid runtime för att blockera osäker transport i externa miljöer.
- Nya AI-inställningar ska designas med minst privilegium, säkra default-värden och tydliga valideringsfel.
- Mobil och Electron ska hållas funktionellt pariterade i kärnflöden för uppgifter, påminnelser och AI-inställningar.
- Vid skillnad mellan plattformar ska mobilappens UX och säkerhetsnivå höjas till minst samma nivå som Electron, inte tvärtom.
- Task- och checkboxflöden i mobilappen ska ge omedelbar respons i UI; lokal persistens, reminder-planering och sync får inte skapa tydligt hack eller global loading-flicker.
- Expo Go, dev builds och EAS APK ska dela samma robusta bootstrapprinciper: fail-soft startup, tydliga fallback-fel och ingen blockerande init som fastnar på splash.
- AI-modellflödet på mobil ska särskilja Expo Go från saknade native moduler i EAS-build; feltexter måste spegla faktisk runtime-orsak.
- Upplåsta låsta anteckningar får dekrypteras i editor/runtime efter korrekt lösenord, men UI får aldrig falla tillbaka till att visa rå ciphertext.

## Säkerhetspolicy

- Kryptering at rest ska använda autentiserad kryptering och roterbar nyckelkälla.
- Kryptering in transit ska vara HTTPS/TLS i alla externa miljöer.
- Loggar och dashboards ska aldrig exponera hemligheter, råa tokens eller skyddad note-data.
- Scope-kontroll ska göras server-side på alla endpoints med användardata.
- API-lagret ska använda fail-closed request-härdning: JSON-only write requests, mönsterblockering för injektionspayloads och blockering av prototype-pollution keys.
- Databasaccess ska alltid gå via parametriserade/ORM-säkra queryflöden med validerade filter och bounds för att minska injection/DoS-risk.
- Endpoint-enumeration och brute-force ska begränsas med route-specifika throttles för auth, lock-verifiering och andra känsliga operationer.

## Arbetsmetod

- Börja varje större förändring med hotbildsbedömning och felmodes: auth, data leakage, replay, race.
- Implementera lösning i små steg med verifiering efter varje steg.
- Avsluta varje leverans med tydlig dokumentation: arkitektur, dataflöde, retention, testresultat.
- Om osäkerhet finns mellan snabb lösning och robust lösning ska robust lösning prioriteras.
- Följ GitHub-flöde med `feature/*` -> `dev` -> `main`, där `main` endast tar verifierade merges från `dev`.
- Säkerställ efter push att remote-brancher är synkade och att inga kritiska ändringar ligger kvar lokalt.
- Prioritera små, tydliga commits med spårbar scope för enklare rollback och säkrare release-hantering.

## Essentiella funktionsdelar

- Notes: skapa, läsa in, uppdatera, flytta mellan projekt, offline-cache och återhämtning efter nätverksfel.
- Tasks: task-lists, statusflöde, sortering/filtrering, påminnelser och synk mellan mobile/web/electron.
- AI-chatt: säkra tool-anrop, synk av sessionsdata, fallback vid timeout/fel och tydliga användarfel.
- Projektmappar: korrekt klassning/separation från anteckningar, filtrering via dropdown och konsekvent parent-child-hantering.
- Säkerhet: app-lock, låsta anteckningar/projekt, auth-scope, kryptering at rest/in transit och fail-closed API-validering.

## Kvalitet och verifiering

- Alla säkerhetskritiska ändringar ska ha unit + integration och minst ett relevant E2E-test.
- Typecheck och lint ska vara gröna innan leverans.
- Före varje push till `dev` eller `main` ska `npm run validate:prepush` köras från repo-roten och passera helt.
- Valideringskommandot ska täcka backend, web/electron, mobile och electron-noter med kritiska tester för notes, tasks, AI-chatt, kryptering, auth/lock och fallback/felhantering.
- Push får inte göras om någon gate fallerar; först fix, därefter ny full validering.
- Dokumentation ska uppdateras i samma leverans när nya säkerhetsflöden, endpoints eller dashboards införs.
- `packages/shared/src/whatsNew.ts` ska uppdateras i varje leverans med ny version/build/datum och konkreta highlights för ändringen; leverans är inte klar förrän detta är gjort. Detta är ett strikt krav.
- What's New-vyn i både mobilappen och Electron/web måste visa den nya posten efter varje leverans; om posten inte syns är leveransen inte klar.
- Verifiering ska bevisa kryptering i varje fas: payload före transport, server-side validering, server persistens, lokal persistens och återläsning.
- Testbevis ska vara konkreta och spårbara med tydliga assertions för `ingen plaintext-lagring`.
- Releasebevis för EAS ska inkludera faktisk cloud-build eller motsvarande EAS-buildstatus, inte bara lokal preflight.
- AI-validering ska täcka lokal modellväg, API-provider-väg, tool-use och fel/fallback utan att hemligheter exponeras i loggar.

## Valideringsmatris

- Kör alltid `npm run validate:prepush` från repo-roten före push; den är blockerande gate.
- Validering ska inkludera unit/integration/E2E för backend, web/electron, mobile och electron-noter.
- Vid testfel: fixa rotorsak, kör om hela matrisen, pusha först när allt passerar.
- Kör `npm run lint` separat och åtgärda konfig- eller kodfel innan leverans där lint-gate är möjlig.

## Pre-push hook: exakt innehåll och varför

- Hook trigger: Git `pre-push` körs lokalt vid varje push och blockerar push om validering fallerar.
- Körkommando: hooken kör `npm run validate:prepush`, som i sin tur kör `npm run validate:critical`.
- Backend-gate: kritiska API-, auth-, lock-, encryption-, request-security- och MCP-tester + typecheck för att stoppa regressions i serversäkerhet/dataflöden.
- Web/Electron-gate: kritiska notes/tasks/AI/säkerhetstester + typecheck för att säkra UI-flöden, kryptering och projekt-/filtreringsbeteenden.
- Mobile-gate: kritiska notes/tasks/AI/säkerhet/notifications/API-tester + typecheck för att säkra offline-fall, auth-recovery och felhantering i appen.
- Electron-gate: kritiska electron-noter tester för runtime- och desktop-specifika flöden.
- Varför blockerande: minskar risken att osäkra eller trasiga ändringar når `dev`/`main`, och gör kvaliteten reproducerbar mellan utvecklare.
- Felpolicy: vid röd gate ska rotorsak fixas, hela matrisen köras om, och push ske först när alla steg är gröna.

## Dokumentationskarta

- Primär översikt: [README.md](file:///f:/Tech/Projekt/Noter/noter-app/README.md)
- Projektregler: [project_rules.md](file:///f:/Tech/Projekt/Noter/noter-app/.trae/rules/project_rules.md)
- Leverans-/kvalitetsflöde: [engineering_playbook.md](file:///f:/Tech/Projekt/Noter/noter-app/.trae/rules/engineering_playbook.md)
- Säkerhets- och driftdokument: [Doc](file:///f:/Tech/Projekt/Noter/Doc/)
- Electron-specifikt: [electron-noter](file:///f:/Tech/Projekt/Noter/electron-noter/)

## Prestanda och drift

- Välj design som skalar i antal användare, sessions och verktygsanrop utan att läcka minne.
- Inför tydlig retention-policy för loggar och telemetry.
- Exponera health-status med minimalt datainnehåll och strikt åtkomstkontroll.
- Säkerställ att observability-vyer har snabb respons även vid större loggmängder genom limit/filter och stabil rendering.
