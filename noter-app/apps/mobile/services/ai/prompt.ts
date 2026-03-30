import { AiToolAccessMode, buildToolUseNotice as buildSharedToolUseNotice, getAiPromptPresetPrompt, AiPromptPreset } from '@repo/shared';

export const combineSystemPrompts = (mainPrompt?: string, projectPrompt?: string) => {
  const parts = [mainPrompt, projectPrompt].map((p) => (p || '').trim()).filter(Boolean);
  return parts.join('\n\n');
};

export const buildToolUseNotice = (enabled: boolean, accessMode: AiToolAccessMode = 'full') =>
  buildSharedToolUseNotice(enabled, accessMode);

export const buildPromptPresetNotice = (preset: AiPromptPreset) => getAiPromptPresetPrompt(preset);
