## Build Info

- Version: 1.0.1
- Build: 5/6

# Noter Mobile App

Mobilappen är byggd med Expo och React Native och delar anteckningar, tasks, kryptering och AI-flöden med webb och Electron. Open source-förberedelsen innebär att backend-URL och andra känsliga värden hålls lokalt via settings eller lokala env-filer.

## Funktioner

- Notes, tasks, projekt och sökning
- Lokal kryptering och app-lås med biometri
- Offline-first lagring i SQLite och lokal synckö
- AI-inställningar och integrationsvärden i lokal krypterad lagring
- Backend-URL via kugghjulet på login-skärmen eller i inställningar
- Lokala task-påminnelser som schemaläggs exakt för varje vald offset
- AI-modellnedladdning, server- eller lokal konvertering och tydliga felmeddelanden per steg

## Kom igång

### Förutsättningar

- Node.js 20+
- Expo CLI eller `npx expo`
- Expo Go eller emulator/simulator
- En lokalt körande Noter-backend

### Lokal konfiguration

Kopiera `.env.example` till `.env` om du vill förifylla en lokal API-URL:

```env
EXPO_PUBLIC_API_URL=http://localhost:3001/api
```

Du kan också lämna env-filen tom och i stället ange backend-URL lokalt via:

- kugghjulet på login-skärmen
- Settings-fliken när du är inloggad

### Starta lokalt

```bash
npm run dev --workspace=apps/backend
```

```bash
npm run start --workspace=apps/mobile
```

### Fysisk enhet

- Se till att telefon och dator är på samma nätverk
- Om `localhost` inte fungerar på en fysisk enhet, ange datorns LAN-adress i appens settings
- Den URL du sparar lagras lokalt i SecureStore

### Påminnelser

- Task-påminnelser i mobilappen är lokalt schemalagda Expo-notiser, inte server-push
- Varje vald offset, till exempel `30 min`, `10 min` och `vid förfallotid`, schemaläggs separat
- Appen återställer lokala påminnelser direkt vid init så att redan sparade tasks inte väntar på senare sync innan notiserna blir aktiva
- Operativsystemets batterioptimering kan fortfarande påverka faktisk leverans på enskilda enheter, men appen räknar och schemalägger nu tiderna exakt

### Felsökning

- Om anteckningar eller tasks ibland visar `Aborted` eller timeout-liknande fel använder appen nu längre lästimeout för samlingshämtningar och faller tyst tillbaka till lokal cache när sådan finns
- Om du inte har någon lokal cache ännu och hämtningen timeoutar: kontrollera att backend kör, att enheten når rätt API-URL och att stora datamängder kan hämtas från `/notes` och `/tasks`
- Vid fysisk enhet är felaktig `localhost` den vanligaste orsaken till laddningsfel

### AI-modeller

- Modellsökning, filhämtning och konverteringsanrop använder tydliga timeout-fel i stället för tysta låsningar
- Nedladdning kan avbrytas och avbrutna installsessioner återupptas inte som om de vore aktiva
- Installerad modell förbereds och aktiveras innan den markeras som redo för lokal chatt
- Trasiga eller ofullständiga native AI-byggen visas som tydliga runtimefel i stället för att ge missvisande “aktiv modell”-läge
- `verify:build-ready` och `build:apk:preflight` kontrollerar nu även AI-relaterade beroenden och plugins för APK-bygg

## Bygga APK (EAS)

Projekt-ID för EAS ingår inte längre i repot. Initiera ditt eget EAS-projekt lokalt innan du kör cloud-builds.

```bash
npm run verify:build-ready --workspace=apps/mobile
npm run build:apk:ready --workspace=apps/mobile
npm run build:apk:preflight --workspace=apps/mobile
```

Om du vill använda EAS cloud-build behöver du först köra `eas init` eller konfigurera ditt eget projekt lokalt.

## Teknisk Stack

- React Native / Expo
- Expo Router
- Zustand
- Expo SQLite
- SecureStore
- Socket.io

## Open source-checklista

- Checka aldrig in `.env`
- Lagra aldrig API-nycklar i `EXPO_PUBLIC_*`
- Sätt backend-URL lokalt i appen eller i lokal `.env`
- Behåll EAS-konfiguration och bundle-publicering i din egen lokala Expo-konto-konfiguration

## Verifiering

```bash
npm test --workspace=apps/mobile
npm run verify:build-ready --workspace=apps/mobile
```

- Säkerhets- och releasegates körs även via `npm run validate:prepush` från `noter-app`
