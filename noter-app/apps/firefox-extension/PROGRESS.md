# Firefox-extension – status

_Senast uppdaterat: 2026-04-23_

Det här dokumentet beskriver den faktiska minimala implementationen i `apps/firefox-extension/`. Tidigare angav dokumentet fler färdiga funktioner än vad som fanns i kod; det är nu synkat med verklig status.

## Implementerat

- [x] `manifest.json` med `sidebar_action`, bakgrundsscript, kortkommando och grundpermissions
- [x] `background.js` som:
  - skapar context menu för markerad text
  - lägger sparad text i en lokal capture-kö
  - öppnar sidopanelen efter capture
- [x] `sidebar.html` som innehåller:
  - bas-URL-inställning för Noter-webappen
  - lista över lokalt köade captures
  - iframe som laddar webappen
  - enkel bottennavigering mellan vyer
- [x] `sidebar.js` för rendering av queue, vybyte och sparning av bas-URL
- [x] `sidebar.css` för grundläggande layout och användbar sidopanel

## Nuvarande beteende

- Standard-URL för iframe är `http://localhost:3000/app`.
- Markeringar på webbsidor sparas lokalt i `browser.storage.local` under en capture-kö.
- Sidopanelen kan öppnas med toolbar-ikonen eller `Ctrl+Shift+L` / `Command+Shift+L`.
- Köade captures visas i sidopanelen tills användaren rensar dem.

## Inte implementerat ännu

- [ ] Direkt skapande av riktiga notes i backend från extensionen
- [ ] Säker auth-delning mellan extension och huvudapp
- [ ] Tvåvägssynk mellan capture-kö och användarens faktiska notes
- [ ] Full extension-specifik i18n
- [ ] Produktionspaketering, signering och releaseflöde

## Installation lokalt

1. Öppna Firefox och gå till `about:debugging`.
2. Välj `This Firefox`.
3. Klicka på `Load Temporary Add-on...`.
4. Välj `manifest.json` i `apps/firefox-extension`.

## Manuell verifiering

1. Ladda extensionen temporärt i Firefox.
2. Öppna sidopanelen och verifiera att webappens bas-URL laddas i iframe.
3. Markera text på en extern sida och välj `Spara till Noter`.
4. Kontrollera att posten dyker upp i capture-listan i sidopanelen.
5. Byt vy via bottennavigeringen och verifiera att `extensionView` ändras i iframe-URL:en.
