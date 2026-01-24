# Datapersistens, Säkerhet och MongoDB-hantering

Denna dokumentation beskriver strategier och tekniska lösningar för att säkerställa att data i Noter-applikationen är permanent, säker och skyddad mot förlust.

## 🛡️ Datapersistens: "Zero Data Loss"

För att garantera att ingen data förloras, varken vid krascher, nätverksfel eller databasproblem, använder vi en "Defense in Depth"-strategi.

### 1. MongoDB Write Concern (`w: majority`)
Detta är den enskilt viktigaste inställningen för datapersistens i backend.

*   **Vad det gör:** När backend sparar data (Note/Task), väntar den med att svara "OK" till klienten tills datan har skrivits till disken på *majoriteten* av noderna i databas-klustret (om Replica Set används) eller säkrat i journalen.
*   **Implementering:**
    I Mongoose-uppkopplingen eller per operation:
    ```typescript
    // I connection options
    mongoose.connect(uri, { writeConcern: { w: 'majority', j: true } });
    ```
    *   `w: 'majority'`: Garanterar att datan är replikerad.
    *   `j: true`: Garanterar att datan är skriven till journalen (disk) innan vi går vidare.

### 2. Klient-sida (Offline-First som Backup)
Frontend-arkitekturen fungerar som en första försvarslinje.
*   Data raderas **aldrig** från den lokala IndexedDB förrän backend uttryckligen bekräftat (HTTP 200/201) att datan är mottagen och säkrad.
*   Om backend misslyckas (500-fel, timeout), ligger datan kvar lokalt med `pendingSync = true` och försöks igen senare.

### 3. Backup-strategier (MongoDB Atlas / Self-hosted)
För att skydda mot katastrofala fel (t.ex. radering av fel collection):
*   **Point-in-Time Recovery (PITR):** Möjliggör återställning till en exakt tidpunkt (sekundnivå) de senaste 7 dagarna.
*   **Dagliga Snapshots:** Automatiska backuper som sparas i molnet.
*   **Cloud Provider Redundancy:** Om du använder Atlas, se till att klustret är utspritt över flera Availability Zones (AZ) för att tåla att ett helt datacenter går ner.

---

## 🔒 Datasäkerhet & Integritet

### 1. Kryptering (At Rest & In Transit)
Vi har implementerat en robust krypteringsmodell:
*   **In Transit (TLS/SSL):** All trafik mellan klient och server, samt mellan server och databas, MÅSTE ske över HTTPS/TLS. MongoDB Atlas tvingar TLS som standard.
*   **At Rest (Applikationsnivå):**
    *   Känsliga fält (`content`, `title`, `dueDate`) krypteras på klienten (eller i API-lagret) innan de når databasen.
    *   Databasmotorn ser bara slumpmässiga teckensträngar (Ciphertext).
    *   Detta skyddar datan även om någon får fysisk tillgång till databasfilerna eller en databas-dump.

### 2. Autentisering & Auktorisering
*   **SCRAM-SHA-256:** Använd starka lösenord för databas-användaren.
*   **IP Whitelisting:** Begränsa åtkomsten till databasen så att endast Backend-serverns IP-adress får ansluta. I utveckling kan du tillåta din egen IP, men i produktion ska det vara strikt ("0.0.0.0/0" är en säkerhetsrisk).
*   **Role-Based Access Control (RBAC):** Applikationens databas-användare ska endast ha `readWrite`-behörighet på just `noter`-databasen, inte admin-rättigheter på klustret.

### 3. Injektionsskydd (NoSQL Injection)
Även om vi använder Mongoose (som skyddar mot många enklare attacker), måste vi vara vaksamma.
*   **Sanering:** Använd aldrig användarinput direkt i query-objekt utan validering.
*   **Type Checking:** TypeScript hjälper oss att säkerställa att `id` verkligen är en sträng och `completed` en boolean, vilket försvårar attacker där man skickar in objekt `{ $gt: "" }` för att manipulera logik.

---

## ⚙️ Strukturella Förbättringar för MongoDB-kopplingen

För att göra kopplingen mer robust och förhindra "tömning" eller instabilitet:

### 1. Robust Connection Handling
Använd händelselyssnare för att upptäcka om kopplingen går ner och hantera det snyggt.

```typescript
mongoose.connection.on('disconnected', () => {
  console.error('MongoDB disconnected! Application is in read-only mode locally.');
  // Ev. pausa skrivförsök från backend
});

mongoose.connection.on('reconnected', () => {
  console.log('MongoDB reconnected!');
});
```

### 2. Auto-Index Varning
I produktion bör man vara försiktig med `autoIndex: true` (standard i Mongoose dev), då det kan låsa databasen vid omstart om stora index ska byggas om.
*   **Rekommendation:** Bygg index manuellt eller via script i samband med deploy, och sätt `autoIndex: false` i produktionskonfig.

### 3. Schema Validation (Server-side enforcement)
Utöver Mongoose-scheman, lägg till **MongoDB Native Validation Rules** på collection-nivå. Detta gör att databasen själv nekar dokument som saknar t.ex. `userId` eller `clientId`, oavsett om buggen ligger i din app-kod eller om någon försöker skriva direkt till databasen.

```javascript
// Exempel på native validation
db.createCollection("notes", {
   validator: {
      $jsonSchema: {
         bsonType: "object",
         required: [ "userId", "clientId", "title" ],
         properties: {
            userId: {
               bsonType: "string",
               description: "must be a string and is required"
            },
            // ...
         }
      }
   }
})
```

## 📝 Sammanfattning av Åtgärder

1.  [ ] **Aktivera `w: majority`** i din Mongoose-connect config.
2.  [ ] **Verifiera IP Whitelist** i MongoDB Atlas.
3.  [ ] **Implementera Native Validation** för extra säkerhet.
4.  [ ] **Schemalägg Backuper** om du inte kör Atlas (där det är inbyggt).
