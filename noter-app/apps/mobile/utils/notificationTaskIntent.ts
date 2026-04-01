export const extractTaskIdFromNotificationResponse = (response: any): string | null => {
  const taskId = response?.notification?.request?.content?.data?.taskId;
  if (typeof taskId !== 'string') return null;
  const trimmed = taskId.trim();
  return trimmed.length > 0 ? trimmed : null;
};

type GateState = {
  isInitialized: boolean;
  hasToken: boolean;
  securityLocked: boolean;
};

export class NotificationTaskIntentQueue {
  private pendingTaskId: string | null = null;

  setPending(taskId: string | null) {
    this.pendingTaskId = taskId;
  }

  getPending() {
    return this.pendingTaskId;
  }

  consumeIfReady(state: GateState): string | null {
    if (!this.pendingTaskId) return null;
    if (!state.isInitialized || !state.hasToken || state.securityLocked) return null;
    const taskId = this.pendingTaskId;
    this.pendingTaskId = null;
    return taskId;
  }
}
