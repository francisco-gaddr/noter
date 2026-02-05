# Noter - Säker och Modern Anteckningsapplikation

"Noter" är en webbapplikation designad för enkelhet, modern design och maximal säkerhet genom full end-to-end (E2E) kryptering. Applikationen syftar till att erbjuda en trygg plats för dina tankar, idéer och projekt, med stöd för rich-text, media-embedding och hierarkisk organisering.

## 🌟 Nyckelfunktioner

*   **Full E2E-Kryptering:** All data krypteras på klienten (AES-256) innan den skickas till servern. Din integritet är garanterad.
*   **Hierarkisk Struktur:** Organisera anteckningar i trädstrukturer med drag-and-drop funktionalitet.
*   **Rich-Text Editor:** Skriv med stil med stöd för fetstil, listor, kodblock, och mer (via Slate).
*   **Media & Embedding:** Ladda upp bilder, bädda in videor och länkar direkt i dina anteckningar.
*   **Realtidssynkronisering:** Arbeta sömlöst över enheter med omedelbara uppdateringar (Socket.io).
*   **Offline-stöd:** Fortsätt arbeta utan internetanslutning; ändringar synkroniseras när du är online igen (PWA/IndexedDB).
*   **Export:** Exportera dina anteckningar till PDF, Markdown eller Text.
*   **Tasks:** Integrerad uppgiftshantering kopplad till dina anteckningar.

## 🏗 Arkitektur och Teknikstack

Projektet är ett monorepo som använder **Turborepo** för att hantera frontend, backend och delad kod.

### Frontend (`/apps/web`)
*   **Ramverk:** Next.js 14+ (App Router)
*   **Språk:** TypeScript
*   **Styling:** Tailwind CSS (med stöd för Dark Mode)
*   **State Management:** Zustand
*   **Editor:** Slate-react
*   **Lokala Data:** IndexedDB (idb)

### Backend (`/apps/backend`)
*   **Runtime:** Node.js 20+
*   **Ramverk:** Express.js
*   **Databas:** MongoDB (med Mongoose)
*   **Realtid:** Socket.io
*   **Autentisering:** JWT (JSON Web Tokens)

### Delad Kod (`/packages/shared`)
*   Typdefinitioner (TypeScript interfaces)
*   Krypteringslogik (CryptoJS)
*   Valideringsscheman

## 🚀 Kom igång

### Förutsättningar
*   Node.js 20+
*   npm eller yarn

### Installation
1.  Klona repot (eller skapa mappen):
    ```bash
    git clone <repo-url>
    cd noter-app
    ```
2.  Installera beroenden:
    ```bash
    npm install
    ```
3.  Starta utvecklingsmiljön:
    ```bash
    npm run dev
    ```

## 🔐 Säkerhet
Säkerheten är kärnan i Noter.
*   **Klientkryptering:** Inga okrypterade data lämnar någonsin din enhet.
*   **Nyckelhantering:** Krypteringsnycklar härleds från ditt lösenord med PBKDF2.

## 📄 Dokumentation
Se `Doc/` mappen för detaljerad dokumentation:
*   [Overview.md](Doc/Overview.md) - Kravspecifikation och systemöversikt.
*   [Implementation.md](Doc/Implementation.md) - Steg-för-steg implementeringsplan.

## 📱 Version
*   **Mobile:** 1.0.1 (Build 3)
*   **Web:** 1.0.0
