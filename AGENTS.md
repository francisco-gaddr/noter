# AGENTS

## Syfte
- Definierar hur agenter och automation ska arbeta i detta workspace.
- Standardiserar säkerhet, kvalitet, testning, release och dokumentation.
- Gäller för hela workspace: `noter-app`, `electron-noter`, dokumentation och CI-relaterade artefakter.

## Repository Scope
- `noter-app/` innehåller monorepo med `apps/mobile`, `apps/web`, `apps/backend`, `apps/docs`, `packages/*`.
- `electron-noter/` innehåller Electron-shell, preload/main process och build-pipeline mot web-renderer.
- `Doc/` innehåller runbooks, säkerhetsgranskningar och arkitekturbeskrivningar.

## Prioriteringar
- Säkerhet först för data at rest och data in transit.
- Rätt funktionalitet före optimering.
- Verifierad leverans före handoff.
- Konsistent UX mellan mobil, web och Electron.
- Full i18n-kvalitet för svenska och engelska.
- Release readiness för EAS APK och Electron ska bevisas med faktisk build-gate, inte bara konfiggranskning.
- Task- och notes-flöden ska kännas omedelbara i UI även när lokal persistens, sync och påminnelser kör i bakgrunden.

## Arbetskontrakt för agenter
- Arbeta i små, verifierbara steg.
- Följ befintliga mönster i respektive app.
- Introducera inga nya bibliotek utan att först verifiera behov och kompatibilitet.
- Ändra inte semantik i lås/krypteringsflöden utan explicit testtäckning.
- Återställ aldrig användarens avsiktliga lokala ändringar.

## Säkerhetsregler
- Lagra aldrig secrets i klartext i lokala filer eller localStorage för produktionsflöden.
- Lagra API-nycklar med plattformens säkra mekanismer.
- Exponera aldrig dekrypterat låst innehåll innan korrekt upplåsning.
- Visa aldrig rå ciphertext som fallback i UI; vid dekrypteringsfel ska appen maska eller visa tomt innehåll.
- Logga aldrig känslig data (token, lösenord, nycklar, rå-krypteringsnycklar).
- Dekryptera endast i runtime-sammanhang där behörighetskontroll redan passerat.

## Kryptering och lås
- Alla note/task-fält som kan innehålla känsligt innehåll ska vara krypterade i lokal databas.
- Låsta projekt/anteckningar får inte rendera innehåll/tags innan unlock.
- Ikoner för låsta projekt får visas, men inte avslöja innehållsmetadata.
- Electron-settings ska vara krypterade via OS-stödd mekanism.

## i18n-standard
- All användarsynlig text ska gå via i18n-nycklar.
- Undvik hårdkodade engelska strängar i komponenter/skärmar.
- Svenska och engelska ska båda hållas kompletta.
- Nya nycklar läggs i `apps/mobile/services/i18n.ts` och motsvarande web-filer vid behov.

## Testpolicy
- Minimikrav vid feature/fix:
  - Enhetstest för ny logik.
  - E2E/integrationstest för användarflöde.
  - Regressionsfall för tidigare bugg.
- Prestandakritiska UI-flöden ska ha regressionsskydd som verifierar optimistiska uppdateringar utan global loading-flicker.
- Obligatoriskt före handoff:
  - Relevanta workspace-tester gröna.
  - `lint` grönt.
  - `check-types` grönt.
  - Relevanta build-kommandon gröna.

## Build och release
- Mobil:
  - Verifiera readiness-script före APK-build.
  - Säkerställ EAS-profiler och ignore-regler.
  - Kör faktisk EAS Android-build när release-readiness är en del av leveransen och dokumentera build-id/status.
  - Native AI-stöd ska verifiera filsystem, zip-stöd och MLC-modul i installerad EAS-build; Expo Go-feltext får inte användas för andra native fel.
  - AI-modellflödet ska verifiera hela kedjan: sök -> filval -> lokal lagring -> lokal eller serverstödd konvertering -> modell-load -> chatt.
- Web:
  - Bygg med konfiguration som undviker kända Turbopack/symlink-problem på Windows.
- Electron:
  - Verifiera renderer-build och fallback-beteende.
  - Håll main/preload kompatibla med contextIsolation och säker IPC-yta.

## Krypteringsbevis
- Leveransbevis ska täcka notes och tasks i transit, serverpersistens, lokal mobilpersistens och Electron/web-lagring där relevant.
- Tester ska uttryckligen verifiera att plaintext inte sparas för känsliga fält.
- Lås- och unlockflöden ska testas negativt för fel lösenord, låst parent och återläsning efter restart/resume.

## Kodkvalitet
- Följ filens lokala style och naming.
- Håll funktioner små och läsbara.
- Duplicera inte affärslogik mellan mobile/web om shared-lösning är rimlig.
- Lägg till test först eller samtidigt när buggfix görs i säkerhetskritiska områden.

## Dokumentationskrav
- Uppdatera runbook/säkerhetsdokument när beteende eller flöde ändras.
- Förklara påverkan på migration/kompatibilitet när lagringsformat ändras.
- Beskriv verifieringssteg för lokala builds och testsviter.

## Definition of Done
- Funktion uppfyller krav i alla berörda klienter.
- Säkerhetskrav för lagring och låsning är verifierade.
- Översättningar för sv/en är täckta.
- Tester, lint, typecheck och relevanta builds är gröna.
- Dokumentation är uppdaterad där ändringen påverkar drift eller utvecklarflöde.
