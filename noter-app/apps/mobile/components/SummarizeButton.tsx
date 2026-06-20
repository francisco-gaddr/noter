import React from 'react';
import { Button } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { buildNoteSummaryPrompt, hasLockSignal, type Note } from '@repo/shared';
import { useStore } from '@/stores/useStore';

/**
 * "Summarize" the current note (parity with web). Builds the shared (token-capped, language-aware)
 * prompt and queues it for the AI tab to run through its EXISTING pipeline — so it uses whatever model
 * + source the user selected there (local on-device, any API, or a custom endpoint). No duplicated
 * model-call code. Hidden for a locked, not-this-session-unlocked note (locked content never sent).
 */
export function SummarizeButton({ noteId }: { noteId: string }) {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const notes = useStore((s) => s.notes);
  const unlocked = useStore((s) => s.unlockedProtectedNoteIds);
  const setPendingAiPrompt = useStore((s) => s.setPendingAiPrompt);

  const note = notes.find((n) => n._id === noteId) as Note | undefined;
  if (!note) return null;
  if (hasLockSignal(note as any) && !(unlocked || []).includes(note._id)) return null;

  const onPress = () => {
    const { system, prompt } = buildNoteSummaryPrompt(note.title || '', note.content || '', { language: i18n.language });
    setPendingAiPrompt(`${system}\n\n${prompt}`);
    router.push('/ai');
  };

  return (
    <Button icon="auto-fix" mode="outlined" compact onPress={onPress} style={{ marginTop: 12, alignSelf: 'flex-start' }}>
      {t('summarize.action')}
    </Button>
  );
}
