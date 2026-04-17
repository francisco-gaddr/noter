# Noter — Förbättringsplan

En detaljerad, prioriterad genomgång av kvalitets-, prestanda- och framför allt säkerhets- och krypteringsförbättringar som kan göras i Noter-monorepot. Dokumentet är framåtblickande: varje punkt innehåller *problem*, *rekommendation* och *hur det bäst implementeras*, med referens till relevanta filer där det är möjligt.

Slutförda historiska punkter har flyttats till git-historiken (se `git log` och commit-meddelanden). Den här filen beskriver vad som *återstår*.

---

## 0. Snabb nulägesöversikt

- **Krypterat fält-nivå** på klienten via `@repo/shared/encrypt.ts` (CryptoJS AES-CBC).
- **Backend** validerar enbart att fälten är krypterade (`isEncryptedPayload` kollar `U2FsdGVkX1`-prefix), men kan *inte* läsa innehållet.
- **Auth** är Bearer/JWT. `authMiddleware` ger ett enkelt `{ userId }` på `req.user`.
- **Realtid** via Socket.IO med per-användarrum (`user:${userId}`) + note-rum.
- **Lokal lagring**: IndexedDB (web), SQLite (mobile), `safeStorage`/electron (Electron-settings).
- **Rate limiting** globalt + auth + känsliga endpoints + socket-anslutning.

Det mesta är i gott skick. Det stora kryptografiska arvet (CryptoJS AES-CBC med en hårdkodad `DEFAULT_KEY` som fallback) är den enskilt viktigaste svagheten.

---

## 1. Kryptering & nyckelhantering (högst prioritet)

### 1.1 Byt AES-CBC (CryptoJS) mot AES-GCM (WebCrypto / libsodium)

**Problem.** `noter-app/packages/shared/src/encrypt.ts` använder `CryptoJS.AES.encrypt`, som i CryptoJS default-läge är AES-CBC med PKCS#7 och OpenSSL-kompatibel `Salted__`-header. Detta:

1. Saknar **authenticerad kryptering**. Det finns ingen MAC, så en angripare som kan påverka `ciphertext` kan flippa bitar i klartexten (padding oracle, bit-flip). Servern kan inte heller skilja "giltig men tom" från "manipulerad".
2. CryptoJS kör **en iteration** av MD5-baserad `EVP_BytesToKey` för nyckelhärledning från lösenord — långt under modern standard.
3. CryptoJS är **inte constant-time** och har flera kända side-channels.
4. AES-CBC ger **deterministisk IV-kollision** om samma salt återanvänds.

**Rekommendation.** Flytta till AES-256-GCM. I webben och Electron via WebCrypto (`SubtleCrypto`), i Node via `crypto.webcrypto.subtle`. I React Native via `react-native-quick-crypto` eller `libsodium-jsi`.

**Implementation.**

```ts
// packages/shared/src/crypto/aesGcm.ts
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function encryptGcm(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(plaintext),
  );
  // Payload: v1 | iv(12) | ciphertext+tag
  const out = new Uint8Array(1 + iv.length + ct.byteLength);
  out[0] = 1;
  out.set(iv, 1);
  out.set(new Uint8Array(ct), 1 + iv.length);
  return `noter:v1:${btoa(String.fromCharCode(...out))}`;
}

export async function decryptGcm(payload: string, key: CryptoKey): Promise<string> {
  const [, , b64] = payload.split(':');
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv = raw.slice(1, 13);
  const ct = raw.slice(13);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return textDecoder.decode(pt);
}
```

**Migration.** Håll kvar `decrypt()` som *läs*-fallback så existerande CBC-data fortfarande kan läsas. Skriv alltid *ny* data i GCM-formatet med prefix `noter:v1:`. `isEncryptedPayload` i backend uppdateras till att acceptera både `U2FsdGVkX1…` och `noter:v1:…`. Kör en bakgrundsjobb-migration på klienten som re-krypterar poster när de rörs vid nästa gång (lazy migration). Efter N veckor, när telemetri visar 0 CBC-poster, ta bort fallbacken.

### 1.2 Ersätt `DEFAULT_KEY` med PBKDF2/Argon2id från användarens lösenord

**Problem.** `encrypt.ts:3` har `const DEFAULT_KEY = 'noter-default-key'`. Om `setEncryptionKey()` aldrig anropas används denna för *alla* användare. CryptoJS AES använder därtill bara 1 MD5-omgång → trivialt att brute-forca.

**Rekommendation.** Härled en per-användare-nyckel från **lösenordet** vid inloggning, med Argon2id (mobil + desktop) eller PBKDF2-SHA-256 med minst 600 000 iterationer (web, om WebCrypto krävs). Saltet lagras per användare i backendens `User`-dokument.

**Implementation.**

```ts
// packages/shared/src/crypto/kdf.ts
export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const passKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    passKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
```

Backend lagrar `encryptionSalt: Buffer` i `User`-modellen (ej hemligt, men per användare). Klienten hämtar saltet vid login, kör `deriveKey`, håller nyckeln endast i minnet och lämnar aldrig över den till servern.

**Varning.** Detta betyder att om användaren glömmer lösenordet är data förlorad (zero-knowledge). Erbjud därför en **recovery-kit**: generera en 24-ords mnemonic vid första login, visa engångs, och låt användaren välja att lagra krypterad kopia av nyckeln hos sig själv.

### 1.3 Separera innehållsnyckel från inloggningsnyckel

**Problem.** Om inloggningslösenordet byts måste allt krypteras om.

**Rekommendation.** Kör dubbelnyckelsystem:

- **Master Data Key (MDK)** — en slumpmässig 256-bit-nyckel som krypterar allt innehåll. Genereras en gång.
- **Key-Encryption Key (KEK)** — härledd från lösenordet via Argon2id/PBKDF2.
- MDK lagras **wrappad** med KEK i `User.wrappedDataKey`.

Vid lösenordsbyte räcker det att re-wrappa MDK med den nya KEK. Ingen re-kryptering av data behövs. Detta är samma modell som 1Password, Bitwarden, Signal Desktop m.fl.

### 1.4 Minska metadata-läckage

**Problem.** Rapporteras i `säkerhetsrapport.md`: `dueDate`, `parentId`, `order`, `clientId`, tid-ordning (`createdAt`-sortering) läcker struktur. Angripare med DB-access kan kartlägga hur ofta och när data skapas, samt föräldra-/barn-hierarki.

**Rekommendation.**

- **`clientId`** — byt från slumpmässig UUID till en *HMAC-deterministisk* id (HMAC_SHA256(MDK, original-uuid)). Servern ser en opaque sträng men kan fortfarande deduplicera per `{userId, clientId}`.
- **`order`** — lagra alltid krypterad (redan delvis gjort via `encryptedOptional`). Ta bort server-sidans `order`-sortering; klient sorterar lokalt efter dekryptering.
- **`createdAt`/`updatedAt`** — är redan krypterade strängar men sorteras av servern i `GET /api/notes`. Introducera `serverCreatedAt: Date` som rent server-intern metadata för paginering och ersätt `sort({createdAt: -1})` med `sort({serverCreatedAt: -1})`. Det läcker bara när datat hamnade på servern, inte användarens tidsstämplar.
- **`parentId`** — överväg att kryptera. Det kräver att subtrees dekrypteras i klient (vilket redan sker).
- **Blind index för sökning.** Om server-side sökning någonsin ska fungera, använd HMAC-baserade *blind indexes*: `HMAC(MDK, token)` per sökbart ord. Servern söker på hash utan att se klartext.

### 1.5 Ta bort `legacyKey`-heuristiken, ersätt med versionsprefix

**Problem.** `decryptWithSource` försöker två nycklar (active + DEFAULT_KEY) och *betygsätter* klartexten för att gissa rätt. Detta är bräckligt, ger undertäckta fel och förlänger timing-sidokanalen.

**Rekommendation.** Med versionsprefix från 1.1 (`noter:v1:…`, `noter:v2:…`) vet klienten exakt vilken algoritm och vilken nyckelversion som ska användas. `scoreDecryptedText` kan tas bort helt efter migrationsperioden.

### 1.6 Autentiserad kryptering för `password`-fält

**Problem.** `Note.password` hashas med `bcrypt.hash(rawPassword, 10)` (backend/notes.ts:239). Men före hashning avgör backenden genom en heuristik (`decrypt(password)` → om tomt, använd raw) om det mottagna fältet redan är krypterat. Heuristiken kan fallera.

**Rekommendation.** Kräv att klienten alltid skickar *krypterad* rå-sträng (inte bcrypt-hash) och låt backenden alltid `decrypt()` först; om decrypt ger tomt → 400. Ta bort `rawPassword = decrypted ? decrypted : noteData.password`-fallbacken. Höj också `bcrypt`-rundor till 12 (default används redan i `auth.ts`, men notes/tasks kör fortfarande hårdkodat `10`).

**Filer.** `noter-app/apps/backend/src/routes/notes.ts:239, :322`. Lyft konstanten:

```ts
const BCRYPT_ROUNDS = Math.max(10, Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10) || 12);
```

### 1.7 `verify-lock` kandidatloop — stäng timing-sidokanalen

**Problem.** `routes/notes.ts:200-207` kör upp till 3 `bcrypt.compare`-anrop per request. Om angriparen kan mäta svarstid kan de skilja "rätt kandidat var plaintext" vs "rätt kandidat var encrypted".

**Rekommendation.** Definiera ett enda förväntat format (alltid krypterad sträng) och anropa bcrypt exakt en gång. Om felaktigt format — `bcrypt.compare(password, DUMMY_HASH)` för att hålla konstant tid, returnera `{ success: false }`.

### 1.8 Förstärk password-hashning och dummy-jämförelse

- Höj `BCRYPT_ROUNDS` default till 12 i `auth.ts` — redan gjort, bra. Men överväg **Argon2id** (paket `argon2`) för nya hashar; behåll bcrypt-läsning för existerande `passwordHash`.
- `DUMMY_HASH` i `auth.ts:24` är hårdkodad. Om bcrypt ändrar rundor kommer `compare`-tiden divergera från riktiga hashar. Generera en aktuell dummy vid startup med samma `BCRYPT_ROUNDS` som används nu:

```ts
const DUMMY_HASH = await bcrypt.hash(randomBytes(16).toString('hex'), BCRYPT_ROUNDS);
```

### 1.9 JWT: korta access-tokens + refresh-tokens

**Problem.** `JWT_EXPIRES_IN` default `7d` ger tokens som lever en hel vecka. Ingen revokering, ingen rotation. Stulen token är gyllene.

**Rekommendation.** Split-token-modell:

- **Access token**: 15 min expiry, stateless JWT, skickas i `Authorization: Bearer`.
- **Refresh token**: 30 dagar, *opaque* id, lagras hashad i `RefreshToken`-collection med `revokedAt`, `familyId`, `userAgentHash`, `ipHash`. Rotera vid varje användning. Upptäcker återanvändning → revokera hela familjen (detection of token theft).

Socket.IO använder access-token och refreshar via engångs-endpoint. Lägg till `/api/auth/refresh` och `/api/auth/logout` (revokerar aktiv familj).

### 1.10 Content Security Policy + subresource hardening

**Problem.** `helmet()` körs med default-inställningar. Next.js har inte någon explicit CSP. En XSS kan exfiltrera tokens från `localStorage`.

**Rekommendation.**

- Flytta token från `localStorage` till **`httpOnly; Secure; SameSite=Strict` cookie** (så XSS inte når den). Kräver att backend sätter cookien och att klienten skickar `credentials: 'include'`.
- Sätt **strikt CSP**: `default-src 'self'; script-src 'self' 'sha256-…'; connect-src 'self' wss://…; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none';`.
- Aktivera **HSTS** (`helmet({ hsts: { maxAge: 63072000, includeSubDomains: true, preload: true } })`).
- Lägg till `Permissions-Policy` och `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`.

### 1.11 Socket.IO: hårdare autentisering och replay-skydd

**Problem.** `socket.data.userId` sätts vid connect men vid återanslutning kan samma socket-id läcka data om implementationen ändras. `note:join` litar på att `user._id === userId` — om klienten inte skickar `user._id` är kollen no-op.

**Rekommendation.**

- Verifiera JWT vid *varje* event, inte bara connect (eller hämta userId från `socket.data` och strunta i klientens `user`-payload helt).
- Inför `nonce + timestamp`-hash i alla events som förändrar data.
- Sätt `maxHttpBufferSize: 1e6` (1 MB) och `perMessageDeflate` för att förhindra upload-bombs.
- Ignorera `user`-argumentet helt i `note:join` — härled allt serverside från `socket.data.userId`.

### 1.12 Dependency supply-chain

- Lägg till **`npm audit --audit-level=high`** i `validate:prepush`. Misslyckas bygget vid high/critical CVE.
- Aktivera **Dependabot** för `noter-app`, `electron-noter` och `noter-app/apps/mobile` separat.
- Pinna **exakta versioner** (`"mongoose": "8.3.4"`, inte `^8.3.4`) för alla backend/crypto-paket. Versionsrange i kombination med `npm ci` är teoretiskt säkert men pin:ade versioner gör CVE-spårning trivial.
- Använd **`npm-check-updates`** i en egen workflow, inte inline.

### 1.13 MongoDB fältkryptering (CSFLE) som andra skydd

Klient-fältkryptering är redan på plats men backenden har fortfarande *access* till ciphertexten. För ytterligare skydd, kombinera med MongoDB **Queryable Encryption** (CSFLE) så att även DB-admins utan nyckelaccess ej kan läsa data från en dump.

### 1.14 `encryption.ts` utility — acceptera både CBC- och GCM-prefix

När 1.1 rullas ut behöver `isEncryptedPayload` i backend utvidgas:

```ts
const PREFIXES = ['U2FsdGVkX1', 'noter:v1:', 'noter:v2:'];
export const isEncryptedPayload = (v: unknown): boolean =>
  typeof v === 'string'
  && !/\s/.test(v)
  && PREFIXES.some(p => v.startsWith(p))
  && v.length >= 16;
```

---

## 2. Auktorisation och backend-API

### 2.1 Dela `findOne({_id, userId})` som en hjälpare

Sedan den senaste commiten kontrolleras `userId` explicit på alla rutter. För att förhindra återfall, lägg till en *mongoose plugin* som kräver `userId`-filter:

```ts
// src/models/plugins/requireUserId.ts
import { Schema } from 'mongoose';
export const requireUserId = (schema: Schema) => {
  ['find','findOne','findOneAndUpdate','findOneAndDelete','updateOne','updateMany','deleteOne','deleteMany']
    .forEach((op) => {
      schema.pre(op as any, function(next) {
        const filter: any = this.getFilter();
        if (!filter.userId) return next(new Error(`${op} on ${this.model.modelName} missing userId filter`));
        next();
      });
    });
};
```

Appliceras på `Note`, `Task`, `AI*Sync`, `McpAuditLog`. `findById` kommer inte ens kunna köras — det är exakt det vi vill.

### 2.2 Indexera `User.username` explicit

`unique: true` skapar index, men gör det explicit för tydlighetens skull och lägg till case-insensitive collation:

```ts
UserSchema.index({ username: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
```

### 2.3 Paginera listendpoints

**Problem.** `GET /api/notes` returnerar alla anteckningar. Vid tusentals poster blir payloaden stor, både i klient- och servermemory.

**Rekommendation.** Cursor-baserad paginering med `serverCreatedAt` (se 1.4):

```ts
router.get('/', async (req, res, next) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const cursor = req.query.cursor ? new Date(String(req.query.cursor)) : null;
  const filter: any = { userId };
  if (cursor) filter.serverCreatedAt = { $lt: cursor };
  const notes = await Note.find(filter).sort({ serverCreatedAt: -1 }).limit(limit);
  const next = notes.length === limit ? notes[notes.length - 1].serverCreatedAt.toISOString() : null;
  res.json({ items: notes, nextCursor: next });
});
```

Klient (`useStore.fetchNotes`) itererar tills `nextCursor === null` med `setTimeout(0)` mellan pages för att inte blocka UI.

### 2.4 Reorder-bulkWrite: begränsa payload

`PUT /api/notes/reorder` tar en lista utan max. Blockera med `Joi.array().max(1000)` och returnera 413 vid större.

### 2.5 Cache-invalidering är partiell

`notes.ts:245, :335, :373` deletar `notes:list:${userId}`. Men `notes:item:${userId}:${id}`-nycklar invalideras *bara* vid update/delete, inte vid reorder. Lägg till:

```ts
// Efter reorder
const keys = notes.map(n => `notes:item:${userId}:${n._id}`);
if (keys.length) await cache.delMany(keys);
```

Implementera `cache.delMany` via Redis `DEL key1 key2 ...` eller `UNLINK`.

### 2.6 Cacha `GET /api/tasks`

Tasks har ingen cache alls (`tasks.ts:63-74`). Lägg till samma `notes:list`-liknande mekanism per `{userId, parentNoteId}` med 5 min TTL, invalideras på POST/PUT/DELETE/assign/reorder.

### 2.7 Validering av `parentNoteId` query-param

`tasks.ts:66-68` tar `req.query.parentNoteId` rakt av utan typkontroll. Lägg till `mongoose.Types.ObjectId.isValid`-kontroll.

### 2.8 GraphQL introspection default

`index.ts:265-266` tillåter introspection i dev och kräver `ALLOW_GRAPHQL_INTROSPECTION=true` i prod. Bra. Men gör **`queryParser` depth-limit** till en hard requirement: använd `graphql-depth-limit` och `graphql-validation-complexity` för att förhindra deeply-nested query-DoS.

### 2.9 Audit-loggar för säkerhetsrelevanta händelser

Logga via winston till separat destination (eller OpenSearch/Loki):

- Inloggning (success + fail + IP + user-agent-hash).
- Lösenordsändring.
- Lås-verifiering (fail count per note, per IP).
- Rate-limit träff.
- JWT-refresh användning och återanvändning.

Lagra i `SecurityEvent`-collection med TTL 180 dagar.

### 2.10 CORS strictness i produktion

`getAllowedOrigins()` tillåter tom lista i prod (`allowedOrigins.length === 0 && !isProduction`). I prod, kräv att `CORS_ORIGINS` är satt — `throw` annars vid startup, samma mönster som `JWT_SECRET`. Det förhindrar att en oskyddad prod-deploy exponeras för alla origins.

---

## 3. Prestanda

### 3.1 Dela upp `useStore.ts` (1804 rader)

Zustand-storen i `noter-app/apps/web/stores/useStore.ts` är gigantisk. Delar i:

- `stores/notes.ts`
- `stores/tasks.ts`
- `stores/auth.ts`
- `stores/ui.ts`
- `stores/sync.ts`

Varje slice exporterar `create<T>()` och kombineras i `useStore` med `combine`/`merge`. Detta ger **mycket** mindre re-renders: idag re-renderar hela Sidebar när ett task-fält ändras.

### 3.2 Memoisera selectors

Komponenter väljer ofta hela listan (`const notes = useStore(s => s.notes)`). Använd `zustand/shallow` + projicera:

```ts
const visibleNotes = useStore(s => selectVisibleNotes(s), shallow);
```

Flytta selektorfunktioner till `stores/selectors.ts` och memoisera med `reselect` eller en egen `createSelector`. Detta halverar CPU-tid på stora träd.

### 3.3 Virtualisera listor

`SidebarTree` renderar hela trädet. Byt till **`@tanstack/react-virtual`** eller `react-window` för notes-listan och tasks-listan. Reducerar initial paint drastiskt vid >500 poster.

### 3.4 Dekryptera i Web Worker

`api.decryptNotes` dekrypterar i main-tråden i chunks om 50. Flytta till en `Worker` (via `comlink`). Plockar bort 100–300 ms jank vid fetch av stora dataset.

### 3.5 IndexedDB (services/db.ts) — batch writes

Granska `db.ts` (616 rader). Om varje note skrivs i en egen transaktion får man O(n) roundtrips. Byt till `db.notes.bulkPut(notes)` (Dexie) eller en enda `objectStore.put` i loop inom samma `transaction`.

### 3.6 Service worker: cache API-svar aggressivt

`public/sw.js` finns. Utöka med `stale-while-revalidate` för `GET /api/notes` (krypterade payloads är ändå odekrypterbara utan nyckel). Klient-side decryption sker sedan från cache. Första renderingen blir instant vid återbesök.

### 3.7 N+1 i verify-lock

`notes.ts:173-184` loopar ancestor-sök. Bygg i stället en enda aggregation med `$graphLookup`:

```ts
const result = await Note.aggregate([
  { $match: { _id: new mongoose.Types.ObjectId(targetId), userId } },
  { $graphLookup: {
      from: 'notes', startWith: '$parentId', connectFromField: 'parentId',
      connectToField: '_id', as: 'ancestors'
  }},
  { $project: { ancestors: 1, locked: 1, password: 1, title: 1, content: 1 } }
]);
```

Ett DB-anrop, oavsett djup. Klient-sidan är oförändrad.

### 3.8 React Compiler experimental

`next.config.js` har React Compiler aktiverat experimentellt. Mät innan och efter deploy: cold start, TTI, bundle-size. Stäng av om regressionerna är större än vinsterna (ofta fallet på React 19 + Next 16 i nuläget).

### 3.9 Bundle-storlek — analysera

Kör `ANALYZE=true next build` med `@next/bundle-analyzer`. Troliga kandidater:

- `crypto-js` (~40 kB) — kan plockas bort när 1.1 är migrerad.
- `lodash` — använd `lodash-es` + `babel-plugin-lodash` eller direktimport (`lodash/uniqBy`).
- `deepmerge` — 2 kB, ofta onödig i en store.
- Överväg att **tree-shaka `@repo/shared`** genom `"sideEffects": false` i dess `package.json`.

### 3.10 Mobile startup

`Mobile implementation.md` visar att socket-anslutning deferras med `InteractionManager`. Gå vidare:

- Lazy-load AI-modulen bakom en dynamic import när användaren öppnar AI-panelen.
- Undvik att initiera SQLite-migrationer i `app/_layout.tsx` — flytta till `useEffect` efter första frame.

### 3.11 Socket.IO payload-komprimering

Slå på `perMessageDeflate: { threshold: 1024 }` på serverns `Server`-instans. Stora `note:updated`-events komprimeras.

### 3.12 Mongo connection pool tuning

`mongoose.connect` saknar `maxPoolSize`. Sätt `maxPoolSize: 20, minPoolSize: 2, maxIdleTimeMS: 60_000`. Förhindrar både cold-start-latens och pool-utmattning under burst.

---

## 4. Kodkvalitet och refaktor

### 4.1 Aktivera `strict: true` i alla `tsconfig.json`

Backend saknar `strict` i `tsconfig.json`. 61 `any`-användningar i backend, 571 i web. Rulla ut stegvis:

1. Sätt `"strict": true, "noImplicitAny": false` först.
2. Fixa explicita typer fil för fil.
3. Slå på `"noImplicitAny": true` när count är 0.

Kandidater med högst ROI:

- `noter-app/apps/backend/src/graphql/schema.ts` — 16 `any`.
- `noter-app/apps/web/stores/useStore.ts` — 75 `any`.
- `noter-app/apps/web/components/NoteEditor.tsx` — 105 `any`.
- `noter-app/apps/web/components/AISidebar.tsx` — 102 `any`.

### 4.2 Duplicerad decrypt-logik i `services/api.ts`

`decryptNotes`, `getNote`, `createNote`, `updateNote` innehåller identisk dekrypterings-IIFE-stil. Bryt ut:

```ts
const decryptNoteDoc = (note: any): Note => ({
  ...note,
  title: note.locked ? 'Låst anteckning' : safeDecrypt(note.title),
  content: note.locked ? '' : safeDecrypt(note.content),
  tags: note.tags?.map(safeDecrypt) ?? [],
  icon: note.icon ? safeDecryptOrUndefined(note.icon) : undefined,
  // ...
});
```

Samma för tasks. Sparar ~250 rader och eliminerar risken att en patch blir gjord på ett ställe men inte ett annat.

### 4.3 Eliminera `require('bson')` arv

`bson` finns som direktberoende i `backend/package.json` men behövs inte — mongoose drar in rätt version själv. Ta bort.

### 4.4 Ersätt kvarvarande `console.*` i mobile/electron

Git-grep i mobilappen:

```bash
rg -n "console\.(log|debug|info|warn|error)" noter-app/apps/mobile/app noter-app/apps/mobile/components
```

Inför en `logger.ts` per app (wrapper kring winston-node i backend, egen pipe i mobil/web) med miljökänsliga nivåer. Produktions-byggen ska inte innehålla `console.log`.

### 4.5 `NoteEditor.tsx` är för stor

105 `any`-användningar i en fil indikerar att komponenten gör för mycket. Dela upp:

- `NoteEditor/Toolbar.tsx`
- `NoteEditor/LinkEditor.tsx`
- `NoteEditor/TableEditor.tsx`
- `NoteEditor/hooks/useEditorState.ts`

### 4.6 Standardisera felhantering

Skapa `class ApiError extends Error { status: number; code: string }` i `@repo/shared`, använd i både backend (`errorMiddleware`) och klienten (`handleResponse`). Idag kastas både strängar och generiska `Error` med ad-hoc `err.status`.

### 4.7 Använd Mongoose lean() för GET-listor

`Note.find(...).sort(...)` returnerar fulla Mongoose-dokument med alla hooks. För read-only endpoints:

```ts
const notes = await Note.find(filter).sort(...).lean().exec();
```

`lean()` ger råa JS-objekt, ~30–50 % snabbare för stora listor.

---

## 5. Tillförlitlighet och operations

### 5.1 Strukturerad logging

Winston är redan konfigurerad för fil-output. Lägg till en transport för JSON till stdout och dra in via journald/Docker. Strukturera alla `logger.info/error` med konsekventa fält (`requestId`, `userId`, `route`, `durationMs`).

### 5.2 Request-ID + per-request logger

```ts
import { randomUUID } from 'crypto';
app.use((req, _res, next) => {
  (req as any).requestId = req.headers['x-request-id'] || randomUUID();
  (req as any).log = logger.child({ requestId: (req as any).requestId });
  next();
});
```

Skicka tillbaka `X-Request-Id` i svaret. Sätt också i klient-logs — dramatiskt lättare debug.

### 5.3 Sentry (eller motsvarande) i backend + klient

Finns på roadmappen sedan tidigare men är inte klart. Lägg till `@sentry/node` (backend), `@sentry/nextjs` (web), `sentry-expo` (mobile). Maskera `Authorization`-header och hela `req.body` för att inte läcka krypterad payload.

### 5.4 Hälsoendpoints

`/api/health` returnerar bara `ok`. Gör om till:

```ts
app.get('/api/health', async (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const redisOk = await cache.ping().catch(() => false);
  const ok = mongoOk && redisOk;
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    time: new Date().toISOString(),
    mongo: mongoOk, redis: redisOk,
  });
});
```

Lägg till `/api/ready` (samma, men bara efter warmup klar) för k8s readiness probes.

### 5.5 Graceful shutdown

Lyssna på `SIGTERM`/`SIGINT`, stäng `server.close()`, `io.close()`, `mongoose.disconnect()`, `redisClient.quit()` i kontrollerad ordning med 10s timeout. Idag vid SIGTERM dödas processer mitt i requests.

### 5.6 Backup-strategi för MongoDB

- Aktivera point-in-time backups (MongoDB Atlas eller `mongodump` via cron).
- Kryptera backups med separat nyckel.
- Testa återställningen månadsvis — orestat backup är inte backup.

### 5.7 Observability

- Prometheus metrics: `prom-client`. Expose på `/metrics`, skydda bakom basic auth eller IP-allowlist.
- Centrala mätvärden: request-latens per route, active websockets, redis miss-rate, mongo connection pool utilization.

### 5.8 Feature flags

För högriskändringar (CSFLE, token-cookies, CSP) inför feature flags (`@vercel/flags` eller enkel env-based toggle). Rollback blir env-ändring, inte re-deploy.

---

## 6. Testning

### 6.1 Cross-tenant security-suite

Lägg till ett integrationstest som verifierar att user A *inte* kan läsa/skriva user B:s data via varje muterande endpoint. Detta skulle ha upptäckt tidigare `findById`-bugg före commit. Parametrisera för att täcka alla routes med `:id`.

### 6.2 Property-based testing för kryptering

Använd `fast-check`:

```ts
fc.assert(fc.property(fc.string(), (s) => {
  expect(decrypt(encrypt(s))).toBe(s);
}));
```

Kör på både CBC- och GCM-pipeline under migration.

### 6.3 Mutation testing på auth/crypto

`@stryker-mutator` riktad mot `middleware/authMiddleware.ts`, `utils/security.ts`, `routes/auth.ts`, `packages/shared/src/encrypt.ts`. Mutation-score ska vara ≥ 80 %.

### 6.4 E2E med reell backend

Cypress + MongoDB in docker. Idag är web-E2E mest komponent-nivå.

### 6.5 Lockfile-gate

`npm ci --dry-run` i CI — misslyckas vid lockfile-skew. Finns inte idag.

### 6.6 Load test

`k6` eller `autocannon` mot auth, notes list och verify-lock. Svar-P99 ska vara <200 ms för authenticerade read:s.

---

## 7. Mobile-specifikt

### 7.1 Biometrisk unlock med Secure Enclave

Använd `expo-local-authentication` + `expo-secure-store`. Lagra **MDK** wrappat i Secure Enclave/Keychain så att data kan låsas upp utan att återigen mata in lösenordet. Säkrare än att hålla MDK i Redux-state.

### 7.2 SQLite-kryptering

Byt till **SQLCipher** via `expo-sqlite-sqlcipher` eller `op-sqlite`. Hela DB-filen krypteras med en nyckel som bara finns i minnet under öppen session. Kompletterar fält-kryptering med "encryption at rest" mot enhets-stöld.

### 7.3 Certifikat pinning

React Native: `react-native-ssl-pinning` mot prod-backend. Skyddar mot MITM även om enheten har injekterad CA.

### 7.4 App Transport Security

iOS `Info.plist`: `NSAllowsArbitraryLoads: false` utan undantag. Android: `networkSecurityConfig` med `cleartextTrafficPermitted: false` utanför `localhost`.

### 7.5 Jailbreak/root-detektion

`jail-monkey`. Visa varning och blockera biometri-unlock om enheten är rotad.

---

## 8. Electron-specifikt

### 8.1 `sandbox: true` är redan satt — bra

`main.js:232` — `sandbox: true, contextIsolation: true, nodeIntegration: false`. Perfekt.

### 8.2 Säker `openExternal` — redan ok

`isSafeExternalUrl` begränsar till `http/https`. Överväg att lägga till `mailto:` om det stöds.

### 8.3 `safeStorage`-fallback

`main.js:63-65` returnerar `true` när `safeStorage` inte är tillgänglig, *utan* att skriva. Det betyder att settings inte alls persisteras på system utan keyring. Alternativet: kryptera med en lokalt genererad slump-nyckel lagrad i `app.getPath('userData')/key.bin` med `0600`-rättigheter som sista fallback. Logga warning.

### 8.4 Auto-updater signering

Om `electron-updater` används: verifiera att updates är kodsignerade. Oskyddat auto-update är en stor attackvektor.

### 8.5 Isolera preload API

`preload.js` exponerar `window.mlc.*` via `contextBridge`. Granska att `setSetting`/`getSetting` inte exponerar ALL settings, bara de som behövs. Svartlista `token`, `user` etc. från att läsas av renderer om du kan flytta dem till separat kanal.

---

## 9. Dev-experience

### 9.1 Dokumentera lokal miljö-setup med Docker

Ett enda `docker-compose.yml` som startar backend + mongo + redis + mailhog (för auth-flöden). Förbättrar onboarding massivt.

### 9.2 Snabbare test-suite

`validate-critical.mjs` kör *allt* seriellt med npm-workspaces. Parallellisera oberoende steg:

```ts
await Promise.all([
  runStep(backendTests),
  runStep(webTypecheck),
  runStep(sharedTypecheck),
]);
```

Kör kritiska typecheck-steg parallellt; bygg-steg får vara seriella.

### 9.3 Turbo remote cache

`turbo.json` finns redan. Aktivera remote cache (Vercel eller egen Turbo-server) för CI.

### 9.4 Pre-commit med lint-staged

Idag körs allt i pre-push. Lägg till `lint-staged` i pre-commit för att bara lint:a ändrade filer — snabb feedback utan att försena push.

---

## 10. Roadmap & prioritet

| Steg | Tema | Uppskattad effekt | Risk |
|---|---|---|---|
| **P0** | 1.1–1.3 AES-GCM + per-user KDF + MDK/KEK | Fundamental säkerhet | Medel (migrationsbehov) |
| **P0** | 2.1 Mongoose-plugin för `userId`-filter | Förhindrar återfall | Låg |
| **P0** | 1.9 Short-lived access + refresh tokens | Token-stöld | Medel |
| **P1** | 1.4 Metadata-hygien (`serverCreatedAt`, HMAC-clientId) | Mindre läckage | Medel |
| **P1** | 1.10 CSP + httpOnly cookies | XSS-hardening | Låg |
| **P1** | 2.3 Paginering | Skalbarhet | Låg |
| **P2** | 3.1–3.2 Store-split + memoisering | UI-latens | Låg |
| **P2** | 5.1–5.3 Observability (requestId, Sentry, metrics) | Drift | Låg |
| **P2** | 4.1 Strict TypeScript | Kodkvalitet över tid | Låg (men tidskrävande) |
| **P3** | 7.2 SQLCipher + 8.4 signerade uppdateringar | Mobil/desktop hardening | Medel |
| **P3** | 6.1–6.3 Cross-tenant- och mutation-tests | Kvalitetsförsäkring | Låg |

**Rekommenderad sekvens.** Rulla ut P0-paketet tillsammans i en release bakom feature-flagga, med shadow-skrivning (GCM parallellt med CBC) i en vecka, sedan stänga av CBC-skrivning, och efter ytterligare två veckor ta bort CBC-läsning när telemetri visar noll legacy-poster. Sedan tar man P1 i två deploys (tokens separat från CSP för att isolera regressioner) och fortsätter ner i listan.

---

## 11. Icke-åtgärder (avsiktligt lämnade)

För tydlighets skull, följande är medvetet *inte* på listan:

- **Byte av Mongo till PostgreSQL**: rörande men gigantisk förändring utan motsvarande vinst när fält-kryptering redan gör RDBMS-funktioner irrelevanta.
- **Egen AI-backend**: out-of-scope, täcks av separat AI-spår.
- **CRDT-baserad sync**: intressant men osäker ROI; server-side last-write-wins + soft conflicts fungerar för typisk användning.
- **Multi-region deploy**: orimligt utan först stabilisera P0/P1.

---

*Senast uppdaterad: 2026-04-17.*
