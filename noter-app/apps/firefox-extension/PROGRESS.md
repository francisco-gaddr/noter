# Utvecklingsstatus för Firefox Extension

## Klara funktioner
- [x] **Manifest V2 Setup**: Grundläggande manifest med sidebar_action och permissions.
- [x] **Sidopanel (Sidebar)**: `sidebar.html` som laddar webbappen via iframe.
- [x] **Hotkeys**: Kortkommando `Ctrl+Shift+L` (eller `Command+Shift+L` på Mac) för att öppna/stänga sidopanelen.
- [x] **Bottennavigering**: Mobil-liknande bottenmeny i sidebar-läge.
- [x] **Snabbkommandon**: Knappar i sidopanelens header för att snabbt skapa nya anteckningar.
- [x] **Context Menu**: Högerklicka på markerad text och välj "Spara till Noter".
- [x] **Spara urklipp**: Text sparas automatiskt som en ny anteckning (med källa).
- [x] **Offline-hantering**: Sparar urklipp till `storage` om sidopanelen är stängd, och synkar när den öppnas.

## Installation
1. Öppna Firefox och gå till `about:debugging`.
2. Klicka på "This Firefox".
3. Klicka på "Load Temporary Add-on...".
4. Välj `manifest.json` i mappen `apps/firefox-extension`.

## Användning
- Klicka på Noter-ikonen i verktygsfältet eller använd `Ctrl+Shift+L` för att öppna sidopanelen.
- Markera text på en webbsida, högerklicka och välj "Spara till Noter".
- Använd "+ Ny"-knappen i sidopanelen för att snabbt skapa en anteckning.
