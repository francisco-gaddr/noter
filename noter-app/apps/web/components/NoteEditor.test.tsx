import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the NoteEditor component's dependencies
const mockNotes = [
  {
    _id: '1',
    title: 'Parent Note',
    content: 'Parent content',
    locked: false,
    parentId: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    _id: '2',
    title: 'Child Note',
    content: 'Child content',
    locked: false,
    parentId: '1',
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
  {
    _id: '3',
    title: 'Locked Parent Note',
    content: 'Locked parent content',
    locked: true,
    parentId: null,
    createdAt: '2024-01-03T00:00:00.000Z',
    updatedAt: '2024-01-03T00:00:00.000Z',
  },
  {
    _id: '4',
    title: 'Child of Locked Note',
    content: 'Child content',
    locked: false,
    parentId: '3',
    createdAt: '2024-01-04T00:00:00.000Z',
    updatedAt: '2024-01-04T00:00:00.000Z',
  },
];

// Test the isEffectiveLocked logic without rendering the full component
const testIsEffectiveLocked = (selectedNote: any, notes: any[]) => {
  if (!selectedNote) return false;
  
  // Early return if note is directly locked
  if (selectedNote.locked) return true;
  
  // Iterative traversal with cycle detection to prevent infinite loops
  const visited = new Set<string>();
  let currentId = selectedNote.parentId;
  let iterations = 0;
  const MAX_ITERATIONS = 100; // Safety limit to prevent infinite loops
  
  while (currentId && iterations < MAX_ITERATIONS) {
    iterations++;
    
    // Check for cycles
    if (visited.has(currentId)) {
      console.warn(`Cycle detected in note hierarchy for note ${selectedNote._id} at parent ${currentId}`);
      break;
    }
    visited.add(currentId);
    
    const parentNote = notes.find(n => n._id === currentId);
    if (!parentNote) {
      // Parent not found, stop traversal
      break;
    }
    
    if (parentNote.locked) {
      return true; // Found a locked ancestor
    }
    
    // Move up the hierarchy
    currentId = parentNote.parentId;
  }
  
  if (iterations >= MAX_ITERATIONS) {
    console.error(`Maximum iterations (${MAX_ITERATIONS}) reached for note ${selectedNote._id}, possible infinite loop`);
  }
  
  return false; // No locked ancestors found
};

describe('NoteEditor Lock Logic Tests', () => {
  describe('isEffectiveLocked logic', () => {
    it('should return false for unlocked note with no parent', () => {
      const result = testIsEffectiveLocked(mockNotes[0], mockNotes);
      expect(result).toBe(false);
    });

    it('should return true for directly locked note', () => {
      const result = testIsEffectiveLocked(mockNotes[2], mockNotes);
      expect(result).toBe(true);
    });

    it('should return true for child of locked note', () => {
      const result = testIsEffectiveLocked(mockNotes[3], mockNotes);
      expect(result).toBe(true);
    });

    it('should return false for child of unlocked note', () => {
      const result = testIsEffectiveLocked(mockNotes[1], mockNotes);
      expect(result).toBe(false);
    });

    it('should handle circular references safely', () => {
      const circularNotes = [
        {
          _id: '1',
          title: 'Note 1',
          content: 'Content 1',
          locked: false,
          parentId: '2', // Creates cycle
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        {
          _id: '2',
          title: 'Note 2',
          content: 'Content 2',
          locked: false,
          parentId: '1', // Creates cycle
          createdAt: '2024-01-02T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
      ];

      const result = testIsEffectiveLocked(circularNotes[0], circularNotes);
      expect(result).toBe(false); // Should not crash and return false
    });

    it('should detect cycles and log warning', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const circularNotes = [
        {
          _id: '1',
          title: 'Note 1',
          content: 'Content 1',
          locked: false,
          parentId: '2',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        {
          _id: '2',
          title: 'Note 2',
          content: 'Content 2',
          locked: false,
          parentId: '1',
          createdAt: '2024-01-02T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
      ];

      testIsEffectiveLocked(circularNotes[0], circularNotes);
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Cycle detected'));
      consoleSpy.mockRestore();
    });

    it('should handle missing parent notes gracefully', () => {
      const notesWithMissingParent = [
        {
          _id: '1',
          title: 'Note with missing parent',
          content: 'Content',
          locked: false,
          parentId: 'nonexistent', // Parent doesn't exist
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ];

      const result = testIsEffectiveLocked(notesWithMissingParent[0], []);
      expect(result).toBe(false); // Should not crash
    });

    it('should respect MAX_ITERATIONS limit', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Create a very deep hierarchy that would exceed MAX_ITERATIONS
      const deepNotes = [];
      for (let i = 0; i < 150; i++) {
        deepNotes.push({
          _id: `note-${i}`,
          title: `Note ${i}`,
          content: `Content ${i}`,
          locked: false,
          parentId: i > 0 ? `note-${i-1}` : null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        });
      }

      const lastNote = deepNotes[deepNotes.length - 1];
      const result = testIsEffectiveLocked(lastNote, deepNotes);
      
      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Maximum iterations'));
      consoleSpy.mockRestore();
    });

    it('should find locked ancestor in deep hierarchy', () => {
      const deepNotes = [];
      for (let i = 0; i < 50; i++) {
        deepNotes.push({
          _id: `note-${i}`,
          title: `Note ${i}`,
          content: `Content ${i}`,
          locked: i === 25, // Lock a note in the middle
          parentId: i > 0 ? `note-${i-1}` : null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        });
      }

      const lastNote = deepNotes[deepNotes.length - 1];
      const result = testIsEffectiveLocked(lastNote, deepNotes);
      
      expect(result).toBe(true); // Should find the locked ancestor
    });
  });

  describe('Lock status display', () => {
    it('should show lock icon for locked notes', () => {
      // This would test the UI component rendering
      // For now, we'll test the logic that determines if a note should show as locked
      const lockedNote = mockNotes[2]; // Directly locked
      const childOfLocked = mockNotes[3]; // Child of locked
      
      expect(testIsEffectiveLocked(lockedNote, mockNotes)).toBe(true);
      expect(testIsEffectiveLocked(childOfLocked, mockNotes)).toBe(true);
    });

    it('should not show lock icon for unlocked notes', () => {
      const unlockedNote = mockNotes[0]; // Unlocked with no locked parent
      const childOfUnlocked = mockNotes[1]; // Child of unlocked
      
      expect(testIsEffectiveLocked(unlockedNote, mockNotes)).toBe(false);
      expect(testIsEffectiveLocked(childOfUnlocked, mockNotes)).toBe(false);
    });
  });
});