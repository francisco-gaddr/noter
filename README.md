# Noter App

En säker och effektiv anteckningsapp med hierarkiska listor och realtidsstöd.

## Kom igång

### Förutsättningar

*   Node.js (v18+)
*   Docker & Docker Compose (för databaser)

### Starta Databaser (MongoDB & Redis)

För att starta nödvändiga databaser, kör följande kommando i roten av projektet:

```bash
docker-compose up -d
```

Detta startar:
*   MongoDB på port 27017
*   Redis på port 6379

### Starta Applikationen

Installera beroenden:

```bash
npm install
```

Starta utvecklingsmiljön (både backend och frontend):

```bash
npm run dev
```

### Projektstruktur

*   `apps/web`: Frontend (Next.js)
*   `apps/backend`: Backend API (Express, Socket.io)
*   `apps/mobile`: Mobilapp (React Native/Expo)

### Felsökning

*   **CORS Fel:** Om du ser CORS-fel i konsolen, se till att backend körs och att `docker-compose up` har startat databaserna korrekt.
*   **Redis Error:** Om backend loggar `ECONNREFUSED` mot Redis, kontrollera att Redis-containern är igång (`docker ps`).

---

# Turborepo starter
... (resten av filen)
