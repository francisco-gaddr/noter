export const combineSystemPrompts = (mainPrompt?: string, projectPrompt?: string) => {
  const parts = [mainPrompt, projectPrompt].map((p) => (p || '').trim()).filter(Boolean);
  return parts.join('\n\n');
};

export const buildToolUseNotice = (enabled: boolean) => {
  if (!enabled) {
    return 'Tool-use är avstängt. Svara som vanlig chatt utan JSON-tool-calls och utan att försöka köra verktyg.';
  }
  return 'Tool-use är aktiverat. Assistenten kan utföra säkra verktygsanrop för att läsa, skapa, uppdatera och verifiera anteckningar, uppgifter och projekt.';
};
