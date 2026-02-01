
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
=======
# Noter

A comprehensive note-taking and task management application with cross-platform support (Web & Mobile).

## Features

- **Cross-Platform:** Available on Web (Next.js) and Mobile (React Native/Expo).
- **Real-time Sync:** Seamless synchronization between devices using WebSockets.
- **Offline Support:** Full offline capability with local database storage.
- **Rich Text Editor:** Advanced note editing with formatting support.
- **Task Management:** Kanban board, list view, and calendar view for tasks.
- **Project Organization:** Organize notes and tasks into projects and folders.
- **Security:** Password protection for sensitive notes.

## Project Structure

This is a monorepo managed with TurboRepo:

- `apps/web`: Next.js web application
- `apps/mobile`: Expo React Native mobile application
- `apps/backend`: Node.js/Express backend server
- `packages/shared`: Shared types and utilities
- `packages/ui`: Shared UI components

## Getting Started

### Prerequisites

- Node.js (LTS)
- npm or yarn
- MongoDB (for backend)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

### Running the App

**Backend:**
```bash
cd apps/backend
npm run dev
```

**Web:**
```bash
cd apps/web
npm run dev
```

**Mobile:**
```bash
cd apps/mobile
npm run start
```

## Git Workflow

- `main`: Stable production code
- `dev`: Active development branch
- Feature branches: Created from `dev` (e.g., `feature/new-feature`)


