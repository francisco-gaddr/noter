import { getReminderDefaultsForDueDate } from '../services/tasks/reminderDefaults';

describe('mobile task reminder defaults', () => {
  it('enables reminder with due-time offset when no reminder offset exists', () => {
    const result = getReminderDefaultsForDueDate([]);
    expect(result.reminderEnabled).toBe(true);
    expect(result.reminderOffsetMinutes).toEqual([0]);
  });

  it('preserves selected reminder offsets when user already has a choice', () => {
    const result = getReminderDefaultsForDueDate([10]);
    expect(result.reminderEnabled).toBe(true);
    expect(result.reminderOffsetMinutes).toEqual([10]);
  });
});
