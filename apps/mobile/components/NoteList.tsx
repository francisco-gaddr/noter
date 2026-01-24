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
  onDelete?: (note: Note) => void;
  scrollEnabled?: boolean;
}

export default function NoteList({ notes, onRefresh, refreshing, viewMode = 'list', onReorder, sortBy, sortOrder, onDelete, scrollEnabled = true }: NoteListProps) {
  if (viewMode === 'tree') {
    return (
      <NoteTree
        notes={notes}
        onRefresh={onRefresh}
        refreshing={refreshing}
        onReorder={onReorder}
        variant="compact"
        sortBy={sortBy}
        sortOrder={sortOrder}
        onDelete={onDelete}
        scrollEnabled={scrollEnabled}
      />
    );
  }

  return (
    <NoteTree
      notes={notes}
      onRefresh={onRefresh}
      refreshing={refreshing}
      onReorder={onReorder}
      variant="cards"
      sortBy={sortBy}
      sortOrder={sortOrder}
      onDelete={onDelete}
      scrollEnabled={scrollEnabled}
    />
  );
}
