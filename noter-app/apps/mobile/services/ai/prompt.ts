export const combineSystemPrompts = (mainPrompt?: string, projectPrompt?: string) => {
  const parts = [mainPrompt, projectPrompt].map((p) => (p || '').trim()).filter(Boolean);
  return parts.join('\n\n');
};
