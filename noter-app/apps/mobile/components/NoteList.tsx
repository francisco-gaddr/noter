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
  // Mapping fix: 'list' (Listvy) must render the compact LIST, 'tree' (Kortvy) the
  // CARDS. It used to be inverted, so picking "Listvy" showed cards and vice versa.
  const variant = viewMode === 'tree' ? 'cards' : 'compact';
  return (
    <NoteTree
      notes={notes}
      onRefresh={onRefresh}
      refreshing={refreshing}
      onReorder={onReorder}
      variant={variant}
      sortBy={sortBy}
      sortOrder={sortOrder}
      onDelete={onDelete}
      scrollEnabled={scrollEnabled}
    />
  );
}
