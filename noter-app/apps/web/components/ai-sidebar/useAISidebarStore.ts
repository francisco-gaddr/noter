'use client';

import { useStore } from '../../stores/useStore';

export const useAISidebarStore = () => {
  const user = useStore((state) => state.user);
  const token = useStore((state) => state.token);
  const notes = useStore((state) => state.notes);
  const tasks = useStore((state) => state.tasks);

  return {
    user,
    token,
    notes,
    tasks,
  };
};
