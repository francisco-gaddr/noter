# Guide: Bygga en Firefox Extension av Noter Web App

Denna guide beskriver hur du konverterar den befintliga Next.js-webbapplikationen till ett kraftfullt Firefox-tillägg med Sidebar-stöd. Firefox är unikt lämpat för denna typ av applikation tack vare sitt robusta Sidebar API.

## 📑 Översikt

Vi kommer att använda **Next.js** för att bygga UI:t, men med vissa begränsningar eftersom tillägg körs i en lokal miljö utan server (Node.js).

### Arkitektur
*   **Core:** Samma React-komponenter och logik som webbappen (`apps/web`).
*   **Extension Wrapper:** En ny app (`apps/extension`) som paketerar webbappen för webbläsaren.
*   **Sidebar:** Appens huvudvy i Firefox, vilket ger en "alltid öppen" upplevelse.

---

## 🚀 Steg 1: Projektstruktur

Skapa en ny mapp `apps/extension`. Strukturen bör se ut så här:

```text
apps/extension/
├── manifest.json       # Webbläsarens konfigurationsfil
├── sidebar.html        # Ingångspunkten för sidebaren
├── package.json        # Beroenden
├── public/             # Ikoner och statiska resurser
└── src/                # (Valfritt) Om du bygger specifik logik för tillägget
```

## 📜 Steg 2: Manifestet (manifest.json)

Detta är hjärtat i tillägget. Firefox stödjer fortfarande Manifest V2 (vilket är mer flexibelt för vissa saker), men V3 är framtiden. Nedan är en V2-konfiguration som är optimerad för Sidebar.

```json
{
  "manifest_version": 2,
  "name": "Noter Sidebar",
  "version": "1.0.0",
  "description": "Secure, offline-first notes in your sidebar.",
  "icons": {
    "48": "icons/icon-48.png"
  },
  "permissions": [
    "storage", 
    "activeTab"
  ],
  "sidebar_action": {
    "default_title": "Noter",
    "default_panel": "sidebar.html",
    "default_icon": "icons/icon-32.png"
  },
  "browser_specific_settings": {
    "gecko": {
      "id": "noter@yourdomain.com",
      "strict_min_version": "42.0"
    }
  }
}
```

**För Manifest V3:**
Om du väljer V3, ändra `manifest_version` till 3 och justera behörigheter (Permissions) och CSP (Content Security Policy) enligt Mozillas dokumentation. Sidebar-API:et fungerar likadant.

## 🖥 Steg 3: Sidebar & Utvecklingsmiljö

För att få en smidig utvecklingsupplevelse (Hot Module Replacement, HMR) använder vi en iframe-strategi under utveckling.

**sidebar.html (Dev Mode):**
```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body, html { margin: 0; padding: 0; height: 100%; overflow: hidden; }
      iframe { width: 100%; height: 100%; border: none; }
    </style>
  </head>
  <body>
    <!-- Peka mot din lokala Next.js server -->
    <iframe src="http://localhost:3000"></iframe>
  </body>
</html>
```

### Hur du kör detta:
1.  Starta webbappen: `npm run dev` i `apps/web`.
2.  Öppna Firefox och gå till `about:debugging#/runtime/this-firefox`.
3.  Klicka på **"Load Temporary Add-on..."**.
4.  Välj din `manifest.json` fil i `apps/extension`.
5.  Nu ser du "Noter" i din sidebar (Ctrl+B / Cmd+B för att öppna/stänga).
6.  Alla ändringar du gör i `apps/web` syns direkt i sidebaren!

---

## 📦 Steg 4: Bygga för Produktion

När du ska släppa tillägget kan du inte använda `localhost`. Du måste exportera Next.js-appen till statiska HTML/CSS/JS-filer.

**1. Konfigurera Next.js för export:**
I `apps/web/next.config.js`:
```javascript
module.exports = {
  output: 'export', // Viktigt!
  // ...
};
```

**2. Bygg kommandot:**
```bash
cd apps/web
npm run build
# Detta skapar en 'out' mapp med statiska filer
```

**3. Kopiera filer:**
Kopiera innehållet i `apps/web/out` till `apps/extension`.
*OBS:* `_next`-mappen måste hanteras korrekt. Firefox tillåter underscore i filnamn, men det kan vara bra att döpa om om problem uppstår.

**4. Uppdatera sidebar.html (Prod):**
Istället för iframe, peka direkt på den exporterade `index.html`.
```json
"sidebar_action": {
  "default_panel": "index.html"
}
```

---

## ⚠️ Begränsningar & Viktiga Insikter

### 1. Inget Node.js API
Du kan inte använda `fs`, `path`, eller server-side logik. Allt måste vara klient-kod.
*   **Lösning:** Noter är redan byggd "Offline-first" med IndexedDB och API-anrop, vilket passar perfekt. API-anropen till backend kommer fungera som vanligt (CORS måste tillåta extension-IDt).

### 2. Routing
Next.js routing (filbaserad) fungerar annorlunda i en statisk export inuti en extension.
*   **Rekommendation:** Använd "Hash Routing" om möjligt, eller bygg appen som en Single Page Application (SPA) utan djupa URL-strukturer om du märker problem med navigering.

### 3. Lokal Lagring
Webbappen använder IndexedDB.
*   I Firefox Extension delas lagringen *inte* automatiskt med webbversionen på `localhost:3000` eller din domän.
*   Tillägget har sin egen isolerade lagring.
*   **Fördel:** Användaren kan ha en separat "instans" i sidebaren.

### 4. CSP (Content Security Policy)
Firefox är strikt. Inline-scripts är ofta blockerade.
*   Next.js genererar oftast säkra bundles, men var beredd på att justera `content_security_policy` i `manifest.json` om du får felmeddelanden i konsolen.

## 🌟 Varför Firefox Sidebar?

*   **Multitasking:** Användaren kan ha sina anteckningar uppe *samtidigt* som de surfar.
*   **Resizable:** Användaren bestämmer bredden.
*   **Native känsla:** Känns som en del av webbläsaren, inte en flik som tappas bort.

## 🔗 Resurser

*   [MDN: Sidebars](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/user_interface/Sidebars)
*   [MDN: Manifest V2 vs V3](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Manifest.json/manifest_version)
*   [Extension Workshop](https://extensionworkshop.com/)
