import { MD3Theme } from 'react-native-paper';

export type PriorityLevel = 'low' | 'medium' | 'high' | string | undefined;

export const getPriorityColor = (theme: MD3Theme, priority: PriorityLevel) => {
  if (priority === 'high') return '#f59e0b';
  if (priority === 'low') return theme.colors.primary;
  if (priority === 'medium') return '#22c55e';
  return theme.colors.primary;
};
