export type WhatsNewEntry = {
  version: string;
  build: string;
  date: string;
  highlights: string[];
};

export const WHATS_NEW_ENTRIES: WhatsNewEntry[] = [
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
