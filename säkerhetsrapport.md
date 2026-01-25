# Säkerhetsrapport och Inventering

## 1. Sammanfattning
Denna rapport sammanställer nuvarande säkerhetsstatus för Noter-appen, med fokus på kryptering av data i transit, vila (databas/lagring) och minne.

## 2. Nulägesanalys (Inventering)

### 2.1 Kryptering av Anteckningar (Notes)
- **Titel & Innehåll:** Krypteras på klienten (Mobile/Web) innan det skickas till servern. Lagras krypterat i databasen. Dekrypteras vid visning.
- **Metadata (Tags, Ikoner, Struktur):** Lagras i klartext. Detta innebär att en angripare med databasåtkomst kan se struktur och taggar, men inte innehåll.
- **Lokal Lagring:**
  - **Mobil:** Lagras i SQLite. Data som hämtas från API sparas krypterat (titel/innehåll).
  - **Webb:** Lagras i IndexedDB. Samma som mobil.

### 2.2 Kryptering av Uppgifter (Tasks)
- **Titel & Beskrivning:** Krypteras på klienten. Lagras krypterat.
- **Status (Completed):** Krypteras på klienten ("true"/"false" sträng). Lagras krypterat i DB och lokalt.
- **Prioritet:** Krypteras på klienten. Lagras krypterat i DB och lokalt.
- **Datum (DueDate):** Lagras i klartext.
- **Lokal Lagring:** Fullständig kryptering implementerad för känsliga fält (titel, beskrivning, status, prioritet).

### 2.3 Kommunikation (Transit)
- All kommunikation sker över HTTPS (förutsatt produktionsmiljö).
- Websockets används för realtidsuppdateringar. Data i events (t.ex. `task:created`) innehåller krypterade fält.

## 3. Identifierade Brister & Risker
1. **Metadata-läckage:** Datum (DueDate) och struktur (Parent/Child) är synliga.
2. **Sökbarhet:** Krypterad data går inte att söka i på serversidan. All sökning måste ske på klienten efter dekryptering.

## 4. Åtgärdsplan (Roadmap)

### Fas 1: Utökad Kryptering (Genomförd)
- Databasschema uppdaterat för att stödja krypterad status och prioritet.
- Klienter (Mobil & Webb) uppdaterade för att kryptera/dekryptera dessa fält.
- Lokal lagring uppdaterad för att lagra krypterad data.

### Fas 2: Förbättrad Lokal Säkerhet
- Implementera "Encryption at Rest" för hela databasfilen (SQLite) eller använd Secure Enclave för nyckelhantering. (Delvis hanterat genom fält-nivå kryptering).

## 5. Status för Uppgifter
- [x] **Inventering:** Genomförd.
- [x] **Kryptering av Status/Prioritet:** Genomförd.
- [x] **Rapportering:** Denna fil.
