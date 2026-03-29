export type WhatsNewEntry = {
  version: string;
  build: string;
  date: string;
  highlights: string[];
};

export const WHATS_NEW_ENTRIES: WhatsNewEntry[] = [
  {
    version: '1.0.11',
    build: '2026.03.29.3',
    date: '2026-03-29',
    highlights: [
      'Mobil AI: Lokal modellpipeline stöder nu verklig native konvertering när device-capabilities finns och faller annars tillbaka säkert',
      'Mobil AI: Chattlistor, senaste aktivitet och projektkopplingar i lokal lagring hanteras nu stabilt trots krypterade tids- och projektfält',
      'Mobil AI: OpenRouter och Gemini får robustare historikmappning för systempromptar, tool-resultat och felmeddelanden',
      'Tester: Nya regressioner täcker lokal AI-konvertering, AI-databassortering, projekt-cleanup och både lokal/API-baserad chattstabilitet',
    ],
  },
  {
    version: '1.0.10',
    build: '2026.03.29.2',
    date: '2026-03-29',
    highlights: [
      'Mobil AI: Native runtime skiljer nu korrekt mellan Expo Go och saknade native moduler i EAS APK-builds',
      'Mobil AI: Modellinstallation verifierar filsystem och zip-stöd bättre så felmeddelanden pekar på riktig rotorsak',
      'Mobil säkerhet: Låsta anteckningar dekrypteras korrekt efter rätt lösenord utan att rå ciphertext visas i editor eller listvyer',
      'Tester: Nya regressionstester täcker AI-native runtime, model manager i bakgrunden och säker fallback vid note-dekryptering',
    ],
  },
  {
    version: '1.0.9',
    build: '2026.03.29.1',
    date: '2026-03-29',
    highlights: [
      'Mobil: EAS APK-readiness hårdnad med tydligare build-gates, dependency-kontroller och utökad valideringsmatris',
      'Mobil: Expo Go- och startupflödet är robustare och fastnar inte lika lätt på splash eller blockerande init',
      'Mobil: Taskflöden känns snabbare genom optimistiska uppdateringar utan global loading-flicker vid checkbox och ny task',
      'Kryptering: Kritiska tester täcker nu tydligare notes/tasks i transit, lokal lagring och build-ready-regressioner',
      'Process: Agentfiler och promptregler uppdaterade för releasebevis, EAS cloud-buildstatus och prestandaregressioner',
    ],
  },
  {
    version: '1.0.8',
    build: '2026.03.23.3',
    date: '2026-03-23',
    highlights: [
      'Mobil: Åtgärdad visning så anteckningars innehåll avkrypteras läsbart efter upplåsning',
      'Mobil: Förbättrad fallback för rubriker och innehåll så krypterad råtext inte visas i UI',
      'Mobil: Uppgifter med blandad legacy/plaintext data visas nu med korrekt rubrik och beskrivning',
      'Electron: Build-script återhämtar sig från låst output-mapp genom automatisk fallback till ny output-katalog',
    ],
  },
  {
    version: '1.0.7',
    build: '2026.03.23.2',
    date: '2026-03-23',
    highlights: [
      'Mobil: Automatisk migrering re-krypterar äldre lokala anteckningar och uppgifter till aktiv nyckel',
      'Kryptering: Dekryptering klassar nu källa (aktiv, legacy, plaintext) för säkrare och tydligare fallback',
      'Säkerhet: Legacy/plaintext-fält i lokal SQLite normaliseras tillbaka till krypterat format',
      'Stabilitet: Innehåll visas korrekt efter nyckelrotation utan tomma listor eller saknade titlar',
    ],
  },
  {
    version: '1.0.6',
    build: '2026.03.23.1',
    date: '2026-03-23',
    highlights: [
      'Mobil: Åtgärdad avkryptering så anteckningar, projektmappar, uppgifter och uppgiftslistor visas korrekt igen',
      'Kryptering: Förbättrad bakåtkompatibilitet för äldre lokalt krypterad data vid nyckelrotation',
      'Kryptering: Robust hantering av plaintext-värden i blandade datamängder för att undvika tomma fält',
      'Säkerhet: Behåller stark runtime-nyckel men återställer läsbarhet för historisk data',
    ],
  },
  {
    version: '1.0.5',
    build: '2026.03.16.3',
    date: '2026-03-16',
    highlights: [
      'Electron: Projektmappar filtreras nu strikt bort från anteckningslistan och visas i projektdropdown',
      'Mobil: Projektväljaren har justerad bottenpadding till en rimlig nivå (48px)',
      'Mobil: Projektfiltrering av anteckningar följer hela parent-kedjan och visar nu rätt anteckningar i vald mapp',
      'Mobil: Fel lösenord för låst projekt visas som diskret inline-text istället för popup',
      'Persistens: Åtgärdad race condition så sparad sortering/filtrering för uppgifter inte skrivs över vid uppstart',
      'Process: Projektprompt uppdaterad med strikt krav att What’s New måste synas i både mobil och Electron/web'
    ],
  },
  {
    version: '1.0.4',
    build: '2026.03.16.2',
    date: '2026-03-16',
    highlights: [
      'Electron: Fixat problem där projektmappar felaktigt visades bland anteckningar (strikare typfiltrering)',
      'Mobil: Ökat avstånd (padding) i botten av projektväljaren för bättre scrollning',
      'Mobil: Åtgärdat problem där anteckningar inte visades när en specifik projektmapp var vald',
      'Mobil: Sparar nu filtrering och sortering för både uppgifter och anteckningar mellan sessioner',
      'Mobil: Förbättrad och snyggare felhantering vid felaktigt lösenord för låsta mappar',
      'Process: Uppdaterad What\'s New och versionshistorik'
    ],
  },
  {
    version: '1.0.3',
    build: '2026.03.16.1',
    date: '2026-03-16',
    highlights: [
      'Electron: Fixad bugg där projektmappar visades felaktigt i anteckningslistan',
      'Mobil: Ökad padding i botten av projektväljaren för bättre åtkomst',
      'Mobil: Fixad bugg där anteckningar inte visades vid val av specifikt projekt',
      'Mobil: Spara och återställ senaste vy-läge (lista/träd) mellan sessioner',
      'Mobil: Bättre felhantering vid felaktigt lösenord för låsta mappar',
      'Process: Uppdaterad What\'s New och projektregler'
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
