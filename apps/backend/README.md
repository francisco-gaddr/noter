# Noter Backend – API och Arkitektur
En komplett översikt över backend-API:t för Noter. Dokumentet täcker arkitektur, autentisering, alla endpoints (Notes, Tasks, Auth), Socket.io-händelser för realtid, datamodeller, felkoder, och hur en mobilapp kan koppla upp sig och kommunicera med backenden. Backend är byggd med Express, MongoDB via Mongoose och JWT-baserad autentisering.

## Status för Backend
Backend är funktionell och stödjer följande kärnfunktioner:
- [x] **Autentisering:** Register/Login med JWT (och bcrypt för lösenordshashning).
- [x] **Anteckningar (Notes):** CRUD-operationer, hierarkisk struktur (parentId), sortering, sökning.
- [x] **Uppgifter (Tasks):** CRUD-operationer, koppling till anteckningar, prioritet, förfallodatum.
- [x] **Säkerhet:**
  - Lösenordsskydd för enskilda anteckningar (hashas på servern).
  - Verifiering av lås (`/verify-lock`) för klienter.
  - Stöd för krypterad data (lagrar ciphertext transparent).
- [x] **Realtid:** Socket.io events för synkronisering mellan klienter.
- [x] **Mobil Integration:** CORS-stöd och nätverkskonfiguration för åtkomst från fysiska enheter.

## Översikt
- Bas-URL: `http://<host>:<PORT>` (standard `http://localhost:3001`)
- REST-API: `GET/POST/PUT/DELETE` under `/api/*`
- Autentisering: JWT Bearer (krävs för alla `/api/notes` och `/api/tasks`)
- Databas: MongoDB (Atlas eller lokal). Scheman i Mongoose.
- Realtid: Socket.io för events om skapande/uppdatering/radering samt aktiva användare per note-rum.
- Låsning: Notes kan låsas med lösenord; backend verifierar lösenord för åtkomst till innehåll via en dedikerad endpoint.
## Komma igång
1. Miljövariabler:
   - `PORT` (valfritt, default `3001`)
   - `MONGO_URI` (krävs för databasanslutning)
   - `JWT_SECRET` (hemlighet för JWT; default finns för dev men bör sättas i prod)
2. Start:
   - Installera beroenden: `npm install`
   - Starta server: `npm run dev` eller `node dist/index.js` efter build
   - Start databsen:  docker-compose up -d
3. Hälsa-kontroll:
   - Besök `GET /` → svar: `Noter Backend Running`
4. CORS:
   - Backend tillåter CORS från alla origin under dev (`origin: *`).
## Autentisering
- Flöde:
  1. Registrera användare: `POST /api/auth/register`
  2. Logga in: `POST /api/auth/login` → JWT-token
  3. Skicka `Authorization: Bearer <token>` i headers på `/api/notes` och `/api/tasks`
- Fel:
  - Saknad token → 401
  - Ogiltig token → 401
### Endpoints – Auth
- `POST /api/auth/register`
  - Body: `{ "username": string, "password": string }`
  - Svar: `{ user: { _id, username, createdAt }, token }`
  - Fel: 400 om användare finns eller saknade fält, 500 vid serverfel
- `POST /api/auth/login`
  - Body: `{ "username": string, "password": string }`
  - Svar: `{ user: { _id, username, createdAt }, token }`
  - Fel: 401 vid felaktiga uppgifter, 500 vid serverfel
Exempel (curl):
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"oscar","password":"secret"}'
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"oscar","password":"secret"}'
```
## Datamodeller (Mongoose)
- Note
  - `userId: string`
  - `title: string`
  - `content: string` (lagrar text som skickas från klienten; kryptering kan göras klient-sida)
  - `tags: string[]`
  - `parentId?: ObjectId`
  - `locked: boolean`
  - `password?: string` (hash, returneras ej i vanliga svar)
  - `icon?: string`
  - `order?: number`
  - `createdAt`, `updatedAt`
- Task
  - `userId: string`
  - `title: string`
  - `description: string`
  - `dueDate: Date | null`
  - `completed: boolean`
  - `priority: 'low' | 'medium' | 'high'`
  - `parentNoteId: ObjectId | null`
  - `createdAt`, `updatedAt`
- User
  - `username: string`
  - `passwordHash: string`
  - `createdAt: Date`
## Endpoints – Notes
Bas-URL: `/api/notes` (kräver `Authorization: Bearer <token>`)
- `GET /api/notes`
  - Hämtar alla notes för den inloggade användaren.
  - Innehåll (`content`) döljs för låsta anteckningar och deras barn (saniteras till tom sträng).
  - Sortering: primärt på `order` (asc), sekundärt på `createdAt` (desc).
  - Svar: `Note[]`
- `GET /api/notes/:id`
  - Hämtar en specifik note. Om `locked` sätts döljs `content`.
  - Svar: `Note`
- `POST /api/notes`
  - Body:
    ```json
    {
      "title": "string",
      "content": "string",
      "tags": ["string"],
      "parentId": "string|null",
      "locked": false,
      "password": "string|''",
      "icon": "string|null",
      "order": 0
    }
    ```
  - `password` hashas om angiven.
  - Svar: skapad `Note`
  - Emit: `note:created`
- `PUT /api/notes/:id`
  - Partial update; samma fält som ovan, alla valfria.
  - `password`: tom sträng tar bort lösenordet; icke-tom hashas.
  - Låsta notes svar saniterar `content` till tom sträng.
  - Svar: uppdaterad `Note`
  - Emit: `note:updated`
- `DELETE /api/notes/:id`
  - Tar bort note.
  - Svar: `{ message: 'Note removed' }`
  - Emit: `note:deleted`
- `POST /api/notes/:id/verify-lock`
  - Verifierar lösenord mot låspunkten (närmsta låsta förfader eller noden själv).
  - Body: `{ "password": "string" }`
  - Svar vid OK: `{ "success": true, "content": "<note-content>" }`
  - Fel: 401 vid felaktigt lösenord, 404 om note saknas
Exempel (curl):
```bash
TOKEN="Bearer <jwt>"
curl -H "Authorization: $TOKEN" http://localhost:3001/api/notes
curl -H "Authorization: $TOKEN" http://localhost:3001/api/notes/NOTE_ID
curl -X POST -H "Authorization: $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"New Note","content":"Hello","locked":false}' \
  http://localhost:3001/api/notes
curl -X PUT -H "Authorization: $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Updated","order":5}' \
  http://localhost:3001/api/notes/NOTE_ID
curl -X POST -H "Authorization: $TOKEN" -H "Content-Type: application/json" \
  -d '{"password":"secret"}' \
  http://localhost:3001/api/notes/NOTE_ID/verify-lock
```
## Endpoints – Tasks
Bas-URL: `/api/tasks` (kräver `Authorization: Bearer <token>`)
- `GET /api/tasks`
  - Query: `parentNoteId=<noteId>` (valfri, filtrerar tasks under en note)
  - Svar: `Task[]`
- `POST /api/tasks`
  - Body:
    ```json
    {
      "title": "string",
      "description": "string",
      "dueDate": "ISODate|null",
      "completed": false,
      "priority": "low|medium|high",
      "parentNoteId": "string|null"
    }
    ```
  - Svar: skapad `Task`
  - Emit: `task:created`
- `PUT /api/tasks/:id`
  - Partial update; alla fält valfria.
  - Svar: uppdaterad `Task`
  - Emit: `task:updated`
- `DELETE /api/tasks/:id`
  - Svar: `{ message: 'Task removed' }`
  - Emit: `task:deleted`
## Realtid – Socket.io
- Anslut till Socket.io-servern (samma host/port).
- Rumshantering för anteckningar:
  - `note:join` → `{ noteId, user }`
  - `note:leave` → `{ noteId, user }`
  - Server emitterar `note:active-users` → `{ noteId, users: Array<{ _id, username, ... }> }`
- CRUD-events:
  - Notes: `note:created`, `note:updated`, `note:deleted`
  - Tasks: `task:created`, `task:updated`, `task:deleted`
- Rekommenderat klientflöde (mobil):
  - Join på aktiv note vid öppning och leave vid stängning.
  - Lyssna på `note:active-users` för att visa samarbetare.
  - Lyssna på CRUD-events för att uppdatera lokal state i realtid.
## Felhantering
- Global error-middleware returnerar:
  ```json
  { "message": "<beskrivning>", "stack": "<stack|null>" }
  ```
  - `stack` returneras ej i production.
- HTTP-status:
  - 400: Valideringsfel (Joi)
  - 401: Autentiserings-/auktoriseringsfel
  - 404: Resurs saknas
  - 500: Serverfel
## Mobilapp – Rekommenderad integration
- Autentisera först med `/api/auth/login` och cachad JWT.
- Anropa `/api/notes` för att hämta struktur; observera att låsta notes har tomt `content`.
- Verifiera lås för en specifik note via `/api/notes/:id/verify-lock` innan visning/redigering av innehåll.
- För skapa/uppdatera:
  - Skicka `order` vid drag-and-drop för att bevara sortering.
  - Uppdatera `parentId` för nestning.
  - Ange `password` tom sträng för att ta bort lås.
- För tasks:
  - Filtrera på `parentNoteId` när uppgifter kopplas till en anteckning.
- Realtid:
  - Anslut Socket.io vid appstart.
  - Lyssna på events för att uppdatera UI.

### Anslutning från Fysisk Enhet (Mobil)
För att testa mobilappen på en fysisk telefon mot den lokala backenden:
1. **Samma Nätverk:** Se till att både datorn (där backend körs) och mobilen är anslutna till samma WiFi-nätverk.
2. **Brandvägg:** Tillåt inkommande trafik till Node.js (port 3001) i datorns brandvägg.
   - På Windows: Sök "Tillåt en app genom Windows-brandväggen", leta upp `node.exe` och kryssa i för både Privat och Offentligt nätverk (om tillämpligt).

3. **Hitta IP:** Mobilappen försöker automatiskt hitta datorns IP via Expo, men du kan behöva verifiera din lokala IP (kör `ipconfig` på Windows eller `ifconfig` på Mac/Linux).
   - Exempel IP: `192.168.1.15`
   - Backend URL blir då: `http://192.168.1.15:3001`
4. **Backend config:** Backend lyssnar som standard på alla nätverksgränssnitt (`0.0.0.0` implicit i Express), så ingen kodändring krävs i backend, men verifiera att inga strikta CORS-regler blockerar mobilens IP (nuvarande config tillåter `origin: *`).

## Säkerhet och produktion
- Sätt `JWT_SECRET` via .env.
- Använd MongoDB Atlas eller säker lokal instans.
- Aktivera korrekt CORS för produktionsdomäner.
- Loggning och rate-limiting kan läggas till (t.ex. `express-rate-limit`).

