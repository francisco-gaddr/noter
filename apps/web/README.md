## Build Info

- Version: 1.0.1
- Build: 4/5

# Noter Web Application

En säker, offline-först anteckningsapplikation byggd med Next.js. Appen fokuserar på dataintegritet, kryptering och sömlös synkronisering mellan enheter.

## 🚀 Funktioner

*   **Offline-First:** All data sparas lokalt i IndexedDB först och synkroniseras med servern när uppkoppling finns.
*   **End-to-End Kryptering:**
    *   Anteckningsinnehåll, titlar och metadata krypteras på klientsidan innan det skickas till servern.
    *   Uppgifter (Tasks) och deras metadata (förfallodatum etc.) är fullt krypterade.
    *   Unika krypteringsnycklar per användare/session (i nuvarande implementering hanteras detta via `EncryptionService`).
*   **Optimistiska Uppdateringar:** UI:t uppdateras omedelbart vid interaktion, och ändringar köas för bakgrundssynkronisering.
*   **Konflikthantering & Dubblettskydd:** Smart logik för att förhindra dubbletter vid dålig uppkoppling (använder `clientId`).
*   **PWA-stöd:** Kan installeras som en app på dator och mobil.

## 🛠 Teknisk Stack

*   **Ramverk:** [Next.js](https://nextjs.org/) (React)
*   **Språk:** TypeScript
*   **State Management:** [Zustand](https://github.com/pmndrs/zustand)
*   **Lokal Databas:** [Dexie.js](https://dexie.org/) (IndexedDB wrapper)
*   **Kryptering:** Web Crypto API (AES-GCM)
*   **Styling:** Tailwind CSS + Shadcn/ui

## 📂 Projektstruktur

*   `services/api.ts`: Hanterar all kommunikation med backend (REST). Innehåller även logik för kryptering/dekryptering av data "in-transit".
*   `services/db.ts`: Hanterar lokal lagring i IndexedDB. Här ligger logiken för "Pending Sync" (köade ändringar).
*   `stores/useStore.ts`: Globalt tillstånd som binder ihop UI, lokal databas och API. Hanterar logiken för att växla mellan offline/online-data.
*   `components/`: Återanvändbara UI-komponenter.

## 🚦 Kom igång

### Förutsättningar
*   Node.js (LTS rekommenderas)
*   npm

### Installation

```bash
# Från roten av monorepot
npm install
```

### Kör utvecklingsserver

```bash
# Från roten
npm run dev --workspace=apps/web
# ELLER gå in i mappen
cd apps/web
npm run dev
```

Appen startar på `http://localhost:3000`.

## 🔐 Säkerhetsmodell

1.  **Lokal Lagring:** Data sparas i webbläsarens IndexedDB. Känslig data bör rensas vid utloggning (implementerat via `clearStore`).
2.  **Serverkommunikation:** All data som lämnar klienten är krypterad. Servern ser endast krypterade strängar (ciphertext) och har ingen tillgång till nycklarna för att dekryptera innehållet (i en fullständig E2E-lösning).
3.  **Bakåtkompatibilitet:** Systemet hanterar både gammal okrypterad data (legacy) och ny krypterad data sömlöst.

## 🔄 Synkroniseringsflöde

1.  **Skapa/Uppdatera:** Användaren gör en ändring.
2.  **Lokal Sparning:** Ändringen sparas direkt i IndexedDB med flaggan `pendingSync = true`.
3.  **Optimistisk UI:** UI:t uppdateras direkt.
4.  **Sync-försök:** `useStore` försöker skicka datan till backend.
    *   *Lyckas:* `pendingSync` sätts till `false` lokalt. Backend-ID uppdateras.
    *   *Misslyckas (Offline):* Datan ligger kvar som `pendingSync = true`.
5.  **Återuppkoppling:** Vid nästa omladdning eller nätverksstatus-ändring försöker appen synkronisera alla `pendingSync`-objekt.

## 🧪 Testning

```bash
npm test
```
Kör enhetstester för komponenter och logik.
