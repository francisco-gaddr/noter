# Contributing

## Innan du börjar

- Läs [README.md](README.md)
- Läs [Open Source Release Guide.md](Doc/Open%20Source%20Release%20Guide.md)
- Håll lokala AI-, Trae- och IDE-filer utanför git

## Setup

```bash
npm install
cd noter-app
npm install
cd ..
cd electron-noter
npm install
```

## Lokalt arbete

- Backend körs från `noter-app/apps/backend`
- Web körs från `noter-app/apps/web`
- Mobil körs från `noter-app/apps/mobile`
- Electron körs från `electron-noter`

## Förväntningar på ändringar

- Följ befintliga kodmönster i närliggande filer
- Lägg inte in riktiga secrets, tokens eller privata URL:er
- Lägg till eller uppdatera tester när beteende eller säkerhet ändras
- Uppdatera README eller runbooks när setup, guardrails eller releaseflöden ändras

## Verifiering före PR

```bash
cd noter-app
npm run test:repo:open-source
npm run validate:prepush
```

- Kör även relevanta app-specifika kommandon om din ändring påverkar build eller release
- Om du ändrar Electron eller web renderer, verifiera även `electron-noter`

## Pull requests

- Beskriv vad som ändrats och varför
- Beskriv risker, migrationer eller manuella steg
- Lista vilka tester och verifieringar som körts
- Länka berörda issues eller dokument

## Säkerhetsproblem

- Rapportera inte sårbarheter publikt
- Följ [SECURITY.md](SECURITY.md)
