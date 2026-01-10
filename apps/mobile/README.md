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
    *   Stöd för dynamisk IP-adress för testning på fysisk enhet via Expo Go (samma WiFi).

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


Bygga APK från appen:


eas build -p android --profile preview


### Felsökning av Anslutning

Om appen inte kan nå backenden (Network Error):
1.  Kontrollera att backend körs (vanligtvis port 3001).
2.  Kontrollera att datorns brandvägg tillåter inkommande trafik på port 3001 (Node.js).
3.  Verifiera att telefonen och datorn är på samma nätverk.
4.  IP-adressen loggas i terminalen/konsolen i appen ("API_URL configured as...").

## Teknisk Stack

*   **Ramverk:** React Native (Expo)
*   **Språk:** TypeScript
*   **State Management:** Zustand
*   **UI:** React Native Paper, @shopify/flash-list
*   **Navigation:** Expo Router
*   **Formulär:** React Hook Form + Yup
*   **Nätverk:** Fetch API
