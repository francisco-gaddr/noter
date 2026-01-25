# Noter Backend

En robust och säker REST API-backend för Noter-applikationen. Byggd med Node.js och Express, med fokus på säkerhet och skalbarhet.

## 🚀 Funktioner

*   **REST API:** Standardiserade endpoints för CRUD-operationer på anteckningar och uppgifter.
*   **MongoDB Integration:** Schemabaserad datamodellering med Mongoose.
*   **Dubblettskydd:** Unika index på `clientId` för att förhindra dubbletter vid synkronisering från offline-klienter.
*   **Säkerhet:**
    *   Hanterar krypterad data (lagrar ciphertext utan att validera innehåll, vilket bevarar E2E-krypteringens integritet).
    *   CORS-konfiguration för säker åtkomst från frontend.

## 🛠 Teknisk Stack

*   **Runtime:** Node.js
*   **Ramverk:** Express.js
*   **Databas:** MongoDB (via Mongoose ODM)
*   **Språk:** TypeScript

## 📂 Projektstruktur

*   `src/index.ts`: Applikationens startpunkt. Konfigurerar Express, middleware och databasanslutning.
*   `src/models/`: Mongoose-scheman (Note, Task). Definierar datastrukturen och index.
*   `src/routes/`: API-rutter som mappar HTTP-anrop till databasoperationer.

## 🚦 Kom igång

### Förutsättningar
*   Node.js
*   MongoDB (Lokal instans eller Atlas URL)

### Miljövariabler
Skapa en `.env` fil i roten av `apps/backend` (om den inte redan finns/hanteras globalt):

```env
PORT=3001
MONGO_URI=mongodb://localhost:27017/noter
```

### Installation

```bash
# Från roten av monorepot
npm install
```

### Kör servern

```bash
# Utvecklingsläge (med hot-reload)
npm run dev --workspace=apps/backend

# Produktion
npm run build --workspace=apps/backend
npm start --workspace=apps/backend
```

Servern startar normalt på `http://localhost:3001`.


Stäng portanvändning:

netstat -ano | findstr :3200
Du får ett PID längst till höger.

Döda processen
taskkill /PID 12345 /F

## 💾 Datamodeller

### Note
*   `userId`: Ägarens ID.
*   `clientId`: Unikt ID genererat av klienten (UUID) för att identifiera objektet unikt över enheter och förhindra dubbletter.
*   `title`: (Krypterad sträng)
*   `content`: (Krypterad sträng)
*   `tags`: (Krypterad array/sträng)
*   `isFavorite`: Boolean

### Task
*   `userId`: Ägarens ID.
*   `clientId`: Unikt ID.
*   `text`: (Krypterad sträng)
*   `completed`: Boolean
*   `dueDate`: (Krypterad sträng/datum)

## 🔒 Säkerhet & Persistens

Backend-tjänsten är utformad för att vara en "dum" lagringsplats för krypterad data. Den validerar inte innehållet i de krypterade fälten, vilket innebär att servern aldrig ser användarens data i klartext.

*   **Persistens:** MongoDB används med `w: majority` (konfigurerbart) för att säkerställa att data är skrivet till disk/replikerat innan bekräftelse skickas till klienten.
*   **Index:** `clientId` är indexerat och unikt per användare för att garantera idempotens vid "retry"-logik från klienten.
