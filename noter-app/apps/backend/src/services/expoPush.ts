/**
 * Expo push notifications — send a notice to all of a user's registered devices.
 *
 * Uses the Expo Push API directly (no extra dependency). Expo accepts up to 100
 * messages per request; we chunk accordingly. Invalid/expired tokens reported by
 * Expo (DeviceNotRegistered) are pruned so we stop pushing to dead devices.
 */
import PushToken from '../models/PushToken';
import logger from '../utils/logger';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

const isExpoToken = (t: string): boolean => /^ExponentPushToken\[.+\]$/.test(t) || /^ExpoPushToken\[.+\]$/.test(t);

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/** Send a push to every device the user has registered. Best-effort. */
export const sendPushToUser = async (userId: string, message: PushMessage): Promise<number> => {
  let docs: { token: string }[];
  try {
    docs = await PushToken.find({ userId }).select('token').lean();
  } catch (err) {
    logger.warn('expoPush.lookup-failed', { error: (err as Error)?.message });
    return 0;
  }
  const tokens = docs.map((d) => d.token).filter(isExpoToken);
  if (tokens.length === 0) return 0;

  let sent = 0;
  const deadTokens: string[] = [];
  for (const group of chunk(tokens, 100)) {
    const messages = group.map((to) => ({ to, title: message.title, body: message.body, data: message.data || {}, sound: 'default' as const }));
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(messages),
      });
      const json: any = await res.json().catch(() => null);
      const tickets: any[] = Array.isArray(json?.data) ? json.data : [];
      tickets.forEach((ticket, i) => {
        if (ticket?.status === 'ok') sent += 1;
        else if (ticket?.details?.error === 'DeviceNotRegistered') deadTokens.push(group[i]);
      });
    } catch (err) {
      logger.warn('expoPush.send-failed', { error: (err as Error)?.message });
    }
  }

  if (deadTokens.length) {
    await PushToken.deleteMany({ token: { $in: deadTokens } }).catch(() => undefined);
  }
  return sent;
};
