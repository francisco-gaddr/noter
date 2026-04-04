# Noter Docs App

Docs-appen används för att publicera eller förhandsgranska projektets dokumentation separat från huvudappen.

## Starta lokalt

```bash
npm run dev --workspace=apps/docs
```

## Bygg och testa

```bash
npm run check-types --workspace=apps/docs
npm run build --workspace=apps/docs
```

## Innehåll

- `app/page.tsx` – startsida för docs-appen
- `app/layout.tsx` – layout och globala wrappers
- `public/` – statiska resurser

## Open source-notering

- Lägg inte in interna eller privata deploylänkar i docs-appen
- Referera till lokala `.env.example`-filer och öppna källkodsflöden
- Använd den här appen för generell dokumentation, inte för lokala hemligheter

## Licens

[MIT](../../../LICENSE)
