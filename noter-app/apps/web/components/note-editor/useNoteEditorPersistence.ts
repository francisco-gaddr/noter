'use client';

import { useEffect, useMemo } from 'react';
import { debounce } from 'lodash';
import { Note } from '@repo/shared';

export const useNoteEditorPersistence = (
  updateNote: (id: string, dataOrTitle?: string | Partial<Note>, content?: string, locked?: boolean, password?: string, icon?: string, type?: string, iconColor?: string) => Promise<void>
) => {
  const saveNote = useMemo(
    () =>
      debounce((id: string, title: string, content: string, icon?: string, iconColor?: string) => {
        if (id) {
          void updateNote(id, { title, content, icon, iconColor });
        }
      }, 2000),
    [updateNote]
  );

  const saveTitle = useMemo(
    () =>
      debounce((id: string, title: string, content: string) => {
        void updateNote(id, title, content);
      }, 500),
    [updateNote]
  );

  useEffect(() => () => {
    saveNote.cancel();
    saveTitle.cancel();
  }, [saveNote, saveTitle]);

  return {
    saveNote,
    saveTitle,
  };
};
