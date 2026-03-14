export const combineSystemPrompts = (mainPrompt?: string, projectPrompt?: string) => {
  const parts = [mainPrompt, projectPrompt].map((p) => (p || '').trim()).filter(Boolean);
  return parts.join('\n\n');
};

export const buildToolUseNotice = (enabled: boolean) => {
  if (!enabled) return '';
  return 'Tool-use är aktiverat. Assistenten kan utföra säkra verktygsanrop för att läsa/uppdatera dina anteckningar, uppgifter och projekt.';
};
