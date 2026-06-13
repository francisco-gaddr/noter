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
