/**
 * Sync an AI-task delegation to the always-on backend (so the Pi can run it) and
 * register this device's Expo push token (so the backend can notify us).
 *
 * Only called when the user opts a task into backend execution — otherwise the
 * delegation stays purely on-device (encrypted local map).
 */
import * as SecureStore from 'expo-secure-store';
import { serializeAiDelegation, type AiTaskDelegation } from '@repo/shared';
import { API_URL } from '@/services/api';

const authToken = async (): Promise<string> => (await SecureStore.getItemAsync('token').catch(() => null)) || '';

const graphqlUrl = (): string => {
  const base = (API_URL || '').replace(/\/+$/, '');
  if (base.endsWith('/graphql')) return base;
  if (base.endsWith('/api')) return `${base}/graphql`;
  return `${base}/api/graphql`;
};

/** Push the delegation JSON onto the synced task (server-encrypted, server-readable). */
export const syncDelegationToBackend = async (taskId: string, delegation: AiTaskDelegation): Promise<boolean> => {
  try {
    const token = await authToken();
    const res = await fetch(graphqlUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        query: 'mutation($id:String!,$input:TaskInput!){updateTask(id:$id,input:$input){_id}}',
        variables: { id: taskId, input: { aiAgent: serializeAiDelegation(delegation) } },
      }),
    });
    const json = await res.json().catch(() => null);
    return !json?.errors?.length;
  } catch {
    return false;
  }
};

/** Clear the backend delegation (when the user turns off backend execution). */
export const clearBackendDelegation = async (taskId: string): Promise<void> => {
  try {
    const token = await authToken();
    await fetch(graphqlUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        query: 'mutation($id:String!,$input:TaskInput!){updateTask(id:$id,input:$input){_id}}',
        variables: { id: taskId, input: { aiAgent: '' } },
      }),
    });
  } catch {
    /* best-effort */
  }
};

/** Register this device's Expo push token with the backend (idempotent). */
export const registerPushToken = async (): Promise<void> => {
  try {
    const Notifications = require('expo-notifications');
    const { status } = await Notifications.getPermissionsAsync();
    let granted = status === 'granted';
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.status === 'granted';
    }
    if (!granted) return;
    const tokenResp = await Notifications.getExpoPushTokenAsync();
    const expoToken = tokenResp?.data;
    if (!expoToken) return;
    const token = await authToken();
    if (!token) return;
    await fetch(`${(API_URL || '').replace(/\/+$/, '').replace(/\/graphql$/, '')}/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ token: expoToken, platform: require('react-native').Platform.OS }),
    });
  } catch {
    /* best-effort — local notifications still work without a push token */
  }
};
