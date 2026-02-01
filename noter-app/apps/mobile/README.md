# Noter Mobile App

Detta är mobilapplikationen för Noter-systemet, byggd med React Native och Expo. Appen är designad för att vara en förlängning av webbapplikationen med fokus på offline-first funktionalitet, snabbhet och säkerhet.

## Status och Funktioner (Pågående)

Applikationen är under aktiv utveckling. Nedan listas nuvarande status för olika delar av appen.

### Implementerade Funktioner
*   **Anteckningar (Notes):**
    *   Visa lista av anteckningar (List/Grid view).
    *   Skapa och redigera anteckningar med rich text (formaterad text).
    *   Automatisk sparning (Auto-save) vid redigering.
    *   Sortering (Datum, Titel).
*   **Uppgifter (Tasks):**
    *   Skapa, redigera och ta bort uppgifter.
    *   Markera som klara/ej klara.
    *   Prioritetsnivåer (High, Medium, Low).
    *   Koppling till anteckningar (Parent Note).
*   **Sökning:**
    *   Global sökning (Fuzzy search) som hittar både anteckningar och uppgifter.
*   **Säkerhet & Kryptering:**
    *   **E2E-kryptering:** Anteckningar och uppgifter krypteras lokalt innan de skickas till backend.
    *   **Låsta Anteckningar:** Skydda känsliga anteckningar med lösenord.
    *   **Biometri:** App-låsning via FaceID/Fingerprint.
*   **Backend Integration:**
    *   Kopplad till Noter Backend API.
    *   **Smart API URL-detektering:** Appen försöker automatiskt hitta backenden på ditt nätverk (LAN) om den körs på en fysisk enhet, eller använder `10.0.2.2` för Android Emulator och `localhost` för iOS Simulator.

### Kommande Funktioner (Prioriterade)
*   **Offline-stöd:** Fullständig offline-funktionalitet med lokal databas (SQLite) och synkronisering.
*   **Autentisering:** Riktig inloggning och registrering (körs nu mot demo-user).

## Komma Igång

### Förutsättningar
*   Node.js (v20+)
*   Expo CLI
*   En mobiltelefon med "Expo Go" appen installerad (iOS eller Android) eller en emulator.
*   Noter Backend körandes lokalt.

### Installation

1.  Gå till mobil-mappen:
    ```bash
    cd apps/mobile
    ```
2.  Installera beroenden:
    ```bash
    npm install
    ```

### Köra Appen

1.  Starta backend (från roten av repot):
    ```bash
    npm run dev:backend
    ```
    *(Eller gå till `apps/backend` och kör `npm run dev`)*

2.  Starta mobilappen:
    ```bash
    npx expo start
    ```

3.  **Testa på fysisk enhet:**
    *   Se till att din telefon och dator är på **samma WiFi-nätverk**.
    *   Öppna **Expo Go** på din telefon.
    *   Skanna QR-koden som visas i terminalen.
    *   Appen kommer automatiskt försöka ansluta till backenden via din dators lokala IP-adress.

### Backend-anslutning & Felsökning

För att appen ska fungera på en fysisk enhet måste den kunna nå din dator där backenden körs.

*   **Automatisk Konfiguration:** Appen är programmerad (`services/api.ts`) att ignorera `localhost`-inställningar på Android-enheter och istället försöka hitta din dators LAN-IP (via Expos konfiguration).
*   **Om det inte fungerar:**
    1.  Kontrollera att backend körs (port 3001).
    2.  Kontrollera brandvägg (Windows Firewall kan blockera inkommande trafik till Node.js).
    3.  Gå till **Inställningar (Settings)** i mobilappen.
    4.  Kontrollera vad som står under "API URL".
    5.  Om det står `http://localhost:3001/api` och du är på en fysisk Android-enhet, ändra detta manuellt till din dators IP-adress, t.ex. `http://192.168.1.50:3001/api`.

## Bygga APK (EAS)

1. Installera EAS CLI (om du inte redan har):
   ```bash
   npm i -g eas-cli
   ```
2. Logga in:
   ```bash
   eas login
   ```
3. Bygg en APK (profil `preview`):
   ```bash
   eas build -p android --profile preview
   ```

Profilen `preview` är konfigurerad för att bygga en APK i [eas.json](file:///f:/Tech/Projekt/Noter/noter-app/apps/mobile/eas.json).

## Teknisk Stack
*   **Ramverk:** React Native (Expo)
*   **Navigering:** Expo Router
*   **State Management:** Zustand
*   **Databas (Lokal):** Expo SQLite
*   **API:** Fetch & Socket.io
