import { extractTaskIdFromNotificationResponse, NotificationTaskIntentQueue } from '../utils/notificationTaskIntent';

describe('notification task intent', () => {
  it('extracts task id from notification response', () => {
    const response = {
      notification: {
        request: {
          content: {
            data: {
              taskId: 'task-1',
            },
          },
        },
      },
    };
    expect(extractTaskIdFromNotificationResponse(response)).toBe('task-1');
  });

  it('queues and releases task id only when unlocked and authenticated', () => {
    const queue = new NotificationTaskIntentQueue();
    queue.setPending('task-99');

    expect(queue.consumeIfReady({ isInitialized: true, hasToken: true, securityLocked: true })).toBeNull();
    expect(queue.getPending()).toBe('task-99');

    expect(queue.consumeIfReady({ isInitialized: false, hasToken: true, securityLocked: false })).toBeNull();
    expect(queue.getPending()).toBe('task-99');

    expect(queue.consumeIfReady({ isInitialized: true, hasToken: false, securityLocked: false })).toBeNull();
    expect(queue.getPending()).toBe('task-99');

    expect(queue.consumeIfReady({ isInitialized: true, hasToken: true, securityLocked: false })).toBe('task-99');
    expect(queue.getPending()).toBeNull();
  });
});
