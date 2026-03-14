import fs from 'fs';
import path from 'path';

describe('task editor mobile contracts', () => {
  const filePath = path.join(__dirname, '..', 'app', 'task', '[id].tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  it('keeps single-tap interaction when keyboard is open', () => {
    expect(source).toContain('keyboardShouldPersistTaps="handled"');
  });

  it('enables reminder defaults when due date/time is selected', () => {
    expect(source).toContain('getReminderDefaultsForDueDate');
    expect(source).toContain("setValue('reminderEnabled', reminderDefaults.reminderEnabled)");
    expect(source).toContain("setValue('reminderOffsetMinutes', reminderDefaults.reminderOffsetMinutes)");
  });
});
