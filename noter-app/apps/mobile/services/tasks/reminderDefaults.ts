export const getReminderDefaultsForDueDate = (currentOffsets?: number[]) => {
  const hasOffsets = Array.isArray(currentOffsets) && currentOffsets.length > 0;
  return {
    reminderEnabled: true,
    reminderOffsetMinutes: hasOffsets ? currentOffsets : [0],
  };
};
