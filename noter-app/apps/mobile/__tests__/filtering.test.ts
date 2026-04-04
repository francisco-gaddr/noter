import { normalizeNoteType, normalizeId } from '@repo/shared';

// This test verifies the shared logic as consumed by the mobile app
describe('Shared Logic in Mobile Context', () => {
  describe('normalizeNoteType', () => {
    it('should normalize project variations correctly', () => {
      expect(normalizeNoteType('project')).toBe('project');
      expect(normalizeNoteType('folder')).toBe('project');
      expect(normalizeNoteType('projectfolder')).toBe('project');
      expect(normalizeNoteType('"project"')).toBe('project');
    });

    it('should normalize task list variations correctly', () => {
      expect(normalizeNoteType('task_list')).toBe('task_list');
      expect(normalizeNoteType('tasklist')).toBe('task_list');
    });

    it('should handle unknown types', () => {
      expect(normalizeNoteType('unknown')).toBe('unknown');
    });

    it('should default to note for empty/null', () => {
      expect(normalizeNoteType(null)).toBe('note');
      expect(normalizeNoteType(undefined)).toBe('note');
      expect(normalizeNoteType('')).toBe('note');
    });
  });

  describe('normalizeId', () => {
    it('should clean up IDs', () => {
      expect(normalizeId(' 123 ')).toBe('123');
      expect(normalizeId('"123"')).toBe('123');
    });
  });
});
