

# PRD: AI Agent Tool Use för Hantering av Anteckningar och Projektmappar

## 1. Introduktion

Detta dokument specificerar krav och steg för att implementera AI-agentens tool use-funktion för att skapa, läsa, redigera, ta bort samt lista anteckningar och projektmappar. Funktionaliteten ska vara tillgänglig både i Electron-appen och mobilappen, via GraphQL-API:t mot backend.

Det ska att gå via den nuvarande AI-chatten att chatta med AIn och be AIn att göra specifika handlignar soma tt tex hämta alla uppgifter för den okmmande veckan, så att denne då gör en tool call ( vilket ska synligt visas i chatt-UIn för användaren) och agera åt användaren mot databasen föra tt hämta såväl som ändra innehållet i databasen.

## 2. Syfte

Syftet är att ge AI-agenten möjlighet att interagera med en central databas för att hantera användarens anteckningar och projektmappar.

Mobilappen och ELectronappen ska kunna göra anrop mot backenden för att trigga tool-calls.

Det ska vara samma befintliga backend om nu men med tillagd GrapQL-API som arbetar mot databasen och som AI chatten kan kommunicera mot från Electron-appen och mobilappen.

## 3. Operationer

### 3.1 Skapa anteckning eller uppgift

* API:et ska tillåta AI-agenten att skapa en ny anteckning eller uppgift med titel, innehåll, och associerad projektmapp eller uppgiftslista.
* Klient: AI-agenten skickar ett GraphQL-mutation som innehåller nödvändiga fält.
* Backend: Validerar data, skapar posten i databasen, och returnerar det nygenererade ID:t.

### 3.2 Läsa anteckning eller uppgift

* AI-agenten ska kunna begära en specifik anteckning eller uppgift eller lista alla anteckningar inom en projektmapp.
* Klient: GraphQL-fråga som antingen hämtar en specifik anteckning via ID eller listar anteckningar per mapp.
* Backend: Hämtar data från databasen och returnerar det till klienten.

### 3.3 Redigera anteckning eller uppgift

* AI-agenten ska kunna uppdatera titel, innehåll, och eventuellt projektmapp.
* Klient: GraphQL-mutation med uppdaterade fält och antecknings-ID.
* Backend: Validerar och uppdaterar posten i databasen, returnerar uppdaterad data.

### 3.4 Ta bort anteckning eller uppgift
* AI-agenten ska kunna ta bort en specifik anteckning.
* Klient: GraphQL-mutation med ID för anteckningen att ta bort.
* Backend: Validerar att den finns, tar bort posten, och bekräftar operationen.

### 3.5 Lista projektmappar eller uppgiftstlistor

* AI-agenten ska kunna lista alla projektmappar / uppgiftslistor eller filtrera efter olika attribut.
* Klient: GraphQL-fråga som hämtar alla mappar eller filtrerat utifrån användarens behov.
* Backend: Returnerar listan av projektmappar eller uppgiftslistor från databasen.

## 4. Säkerhet

* Varje anrop ska autentiseras med användarens session.
* Backend kontrollerar behörigheter så att AI-agenten endast kan hantera data som tillhör användaren.

## 5. Testning

* Enhetstester för varje GraphQL-operation.
* Integrationstester för AI-agentens flöde från frontend till backend.

## 6. Dokumentation

* API-dokumentation ska inkludera alla GraphQL-frågor, mutationer, och svar.
* En användarguide för AI-agentens funktioner i både webb och mobil.

## 7. GraphQL-endpoint

* Endpoint: `{BASE_URL}/graphql`
* Base URL kommer från appens inställning `apiBaseUrl`.
* Autentisering: `Authorization: Bearer <token>`

### 7.1 Queries

* `notes(parentId, type)` – lista anteckningar
* `note(id)` – hämta anteckning
* `tasks(parentNoteId, completed)` – lista uppgifter
* `task(id)` – hämta uppgift

### 7.2 Mutations

* `createNote(input)` – skapa anteckning
* `updateNote(id, input)` – uppdatera anteckning
* `deleteNote(id)` – ta bort anteckning
* `createTask(input)` – skapa uppgift
* `updateTask(id, input)` – uppdatera uppgift
* `deleteTask(id)` – ta bort uppgift

## 8. Tool call‑format för AI

AI‑agenten ska returnera tool calls i ett JSON‑block enligt:

```json
{"tool":"create_note","arguments":{"title":"Mötesanteckning","content":"...","type":"note"}}
```

### Exempel: Hämta alla uppgifter för kommande veckan

```json
{"tool":"list_tasks","arguments":{"completed":false}}
```

### Exempel: Skapa uppgift med deadline

```json
{"tool":"create_task","arguments":{"title":"Färdigställ rapport","description":"Sammanställ siffror","dueDate":"2026-03-10","priority":"high"}}
```

### Exempel: Uppdatera anteckning

```json
{"tool":"update_note","arguments":{"id":"<NOTE_ID>","updates":{"title":"Ny titel","content":"Uppdaterad text"}}}
```


Du ska även göra en tydlig struktur för tool-calls som AI aganten ska kunna utföra från AI chatten. Detta ska även inkludera exempel på hur man ska skriva tool-calls i chatten och att det finns tydliga system-calls för kommunikation med tool callsen.

Varje gång som AI agenten i chatten använder ett tool call så ska det skrivas ut och listas i AI-chatten att en specifik tool call har gjorts.
Tex "skapa uppgift" såa tt varje tool call som görs listas och syns i AI chatten till vänster.

AI modellen ska tydligt få veta vilka tool calls denne kan glra, vilka variabler som ska skickas  med och hur dessa anrop görs.

Gör så att det till fullo funkar att be Ai agentern att göra hantlingar via chatten, såsom tex summera alla uppgifter, skapa en ny anteckning med ett specifikt innehåll. Eller tex skapa en uppgift med ett innehåll, en titel och specifik deadline och prioritering.
