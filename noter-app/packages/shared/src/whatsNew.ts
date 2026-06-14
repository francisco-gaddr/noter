/**
 * Per-release security classification. Lets every version carry an explicit
 * security/crypto posture so the changelog doubles as a security ledger:
 *   - 'security-critical' — fixes an exploitable vuln or hardens a trust boundary
 *   - 'security-hardening' — strengthens crypto/at-rest/transport without a known exploit
 *   - 'feature' — functional change, no security delta
 *   - 'maintenance' — refactor/cleanup/deps
 */
export type SecurityClass = 'security-critical' | 'security-hardening' | 'feature' | 'maintenance';

export type WhatsNewEntry = {
  version: string;
  build: string;
  date: string;
  highlights: string[];
  /** Security classification for this release (see SecurityClass). */
  security?: SecurityClass;
};

export const WHATS_NEW_ENTRIES: WhatsNewEntry[] = [
  {
    version: '1.3.0',
    build: '2026.06.14.2',
    date: '2026-06-14',
    security: 'security-hardening',
    highlights: [
      'Säkerhet: all WebSocket-trafik körs nu alltid över WSS (TLS) i produktion — klienterna tvingar upp publika anslutningar; LAN/localhost behåller sitt läge för lokal utveckling',
      'Säkerhet: inloggningstoken (JWT) och cachat användarobjekt krypteras nu även i webbappens lagring; på mobilen krypteras även val av AI-leverantör/modell och egen serveradress lokalt (nycklar låg redan i säker lagring)',
      'Graf: utforskaren ritar nu en riktig riktad graf med synliga kanter, pilar (flödesriktning) och färgförklaring — i både mobil och Electron',
      'Semantisk sök: vektor- + textsökning (RRF) med krypterat index på enheten; låsta anteckningar indexeras aldrig',
      'Admin & orkestrering: ny hopfällbar sektion med mätbar produktivitets- och AI-agentstatistik (paritet mobil/Electron)',
      'Realtid: innehåll som AI-agenten skapar dyker upp direkt i alla appar via websockets — ingen omladdning behövs',
      'Mobil: tool-use-korten visar alltid innehåll, länk-fältet döljs inte längre av tangentbordet, och delegering till AI vid skapande förifyller dina senaste val',
      'Ärlighet: lokal på-enheten-modell ger nu ett tydligt besked när motorn inte är inbyggd i bygget (i stället för ett påhittat svar) och hänvisar till din egen Hermes-server',
    ],
  },
  {
    version: '1.2.0',
    build: '2026.06.14.1',
    date: '2026-06-14',
    security: 'security-hardening',
    highlights: [
      'AI-chatt (mobil): stabilare — modellinställningarna scrollar, modellval per provider via dropdown, rate limits visas i realtid, tangentbordet täcker inte längre inputfältet, systemprompt sparas automatiskt krypterat',
      'AI-chatt: fler modeller per leverantör + egna (custom) API-providers/Hermes-agenter går att lägga till och sparas krypterat lokalt',
      'AI-chatt: bilagor (text + bild till vision-modeller) och egna Hermes-agenter på Mac/Pi (Ollama) med streaming',
      'Drift: backenden auto-deployas till Pi vid varje push (hälsokoll + ntfy-larm); rate limit-felet "Too many requests" åtgärdat',
      'Data: tomma anteckningar/uppgifter döljs, projektmappar visas aldrig bland anteckningar, bulk-rensa klara uppgifter',
      'Stabilitet: SQLite-lås ("database is locked") åtgärdat, kontrastfel i mörkt läge fixat + skyddat, kortare headers ger mer innehållsyta',
    ],
  },
  {
    version: '1.1.0',
    build: '2026.06.13.1',
    date: '2026-06-13',
    security: 'security-critical',
    highlights: [
      'Säkerhet: åtgärdade IDOR i backend — note/task kunde läsas/ändras/raderas av fel användare via gissat id; alla /:id-rutter scopar nu på userId (CWE-639/862)',
      'Kryptering: v3-lager (AES-256-GCM + Argon2id) med per-användarnyckel, återställningskoder och säker fallback så inget innehåll tappas',
      'AI: välj källa i mobilappen — lokala modeller, API-leverantörer (OpenRouter/Groq/Gemini) eller egen Hermes-agent på Mac/Pi med streaming',
      'AI: svar streamas alltid, verktygskörningar och resonemang visas i tydliga kort; förbrukning per modell/tjänst (anrop + tokens)',
      'Prestanda: notes/tasks laddas offline-först och dekrypteras i bakgrunden i bitar så stora listor inte fryser appen',
      'Säkerhet centraliserad: all kryptering ligger i @repo/shared med versionsstämpel och säkerhetsklassificering per release',
    ],
  },
  {
    version: '1.0.2',
    build: '2026.03.15.2',
    date: '2026-03-15',
    highlights: [
      'Electron: robustare klassning gör att projektmappar konsekvent hamnar i projektdropdown och inte bland anteckningar',
      'Mobile: projektmodal har extra luft i botten så sista projektvalet inte ligger för nära kanten',
      'Mobile: projektfiltrering för anteckningar normaliserar parentId/activeProjectId bättre och visar anteckningar i valt projekt igen',
      'Mobile: valt projekt sparas och återställs mellan appstarter',
      'Persistens: senaste sortering/filtrering för notes/tasks verifieras och bibehålls i både Electron och mobile',
    ],
  },
  {
    version: '1.0.1',
    build: '2026.03.15.1',
    date: '2026-03-15',
    highlights: [
      'Electron: projektmappar klassas strikt och visas i projektdropdown istället för i anteckningslistan',
      'Electron: stabilare filtrering så anteckningar med barnnoder inte felklassas som projekt',
      'Mobil: låst projekt öppnar unlock-dialog med autofokus i lösenordsfältet',
      'Mobil: projektfiltrering visar åter anteckningar i valt projekt även vid inkonsekvent parentId-format',
      "Process: 'What’s New' är nu obligatorisk att uppdatera vid varje leverans",
    ],
  },
  {
    version: '1.0.0',
    build: '2026.03.12.1',
    date: '2026-03-12',
    highlights: [
      'AI säkerhetsguardrails blockerar tool access till låsta anteckningar och låsta projektmappar',
      'Projektmappar kan låsas med lösenord i både mobilappen och Electron-appen',
      'AI tool use visar tydlig entitiesRead-lista för vilka entiteter som lästes',
      'OpenRouter/Gemini-inställningar och AI-sync med localOnly är verifierade i båda apparna',
      'Ny MCP-sektion i AI-inställningar med krypterad lokal lagring och prioritet över .env-värden',
      "Ny 'What's New' i inställningar med releasehistorik i mobilappen och Electron-appen",
    ],
  },
  {
    version: '0.9.3',
    build: '2026.03.05.2',
    date: '2026-03-05',
    highlights: [
      'Förbättrad AI-verktygsanvändning med tydligare status under körning',
      'Stabilare hantering av låsning/upplåsning för känsliga anteckningar',
      'Bättre felmeddelanden för modellnedladdning och konvertering i mobilappen',
    ],
  },
  {
    version: '0.9.0',
    build: '2026.02.20.4',
    date: '2026-02-20',
    highlights: [
      'Grund för AI-projekt och lokala AI-chattar i både mobilappen och Electron-appen',
      'Första versionen av krypterad AI-sync mellan klient och server',
      'Utökad modellhantering med nedladdning och aktivering av lokala modeller',
    ],
  },
];
