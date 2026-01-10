import React from 'react';
import { Note } from '@repo/shared';
import NoteTree from './NoteTree';

interface NoteListProps {
  notes: Note[];
  onRefresh?: () => void;
  refreshing?: boolean;
  viewMode?: 'list' | 'tree';
  onReorder?: (data: Note[]) => void;
  sortBy?: 'createdAt' | 'updatedAt' | 'title' | 'custom';
  sortOrder?: 'asc' | 'desc';
}

export default function NoteList({ notes, onRefresh, refreshing, viewMode = 'list', onReorder, sortBy, sortOrder }: NoteListProps) {
  const visibleNotes = notes.filter((n) => (n as any).type !== 'task_list');

  if (viewMode === 'tree') {
    return (
      <NoteTree
        notes={visibleNotes}
        onRefresh={onRefresh}
        refreshing={refreshing}
        onReorder={onReorder}
        variant="compact"
        sortBy={sortBy}
        sortOrder={sortOrder}
      />
    );
  }

  return (
    <NoteTree
      notes={visibleNotes}
      onRefresh={onRefresh}
      refreshing={refreshing}
      onReorder={onReorder}
      variant="cards"
      sortBy={sortBy}
      sortOrder={sortOrder}
    />
  );
}
