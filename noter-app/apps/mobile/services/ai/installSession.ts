import AsyncStorage from '@react-native-async-storage/async-storage';
import { HFFile, HFModel } from '@repo/ai';

const STORAGE_KEY = 'ai_model_install_sessions_v1';

export type PersistedModelInstallSession = {
  key: string;
  model: HFModel;
  file: HFFile;
  preferLocalConversion: boolean;
  strictLocalConversion: boolean;
  stage: string;
  progress: number;
  platform: 'iphone' | 'android';
  jobId?: string;
  outputUrl?: string;
  updatedAt: string;
};

const readSessions = async (): Promise<Record<string, PersistedModelInstallSession>> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeSessions = async (sessions: Record<string, PersistedModelInstallSession>) => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
};

export const getModelInstallSessionKey = (modelId: string, quantization?: string) =>
  `${modelId}::${(quantization || 'Q4_K_M').toUpperCase()}`;

export const upsertModelInstallSession = async (session: PersistedModelInstallSession) => {
  const sessions = await readSessions();
  sessions[session.key] = session;
  await writeSessions(sessions);
};

export const patchModelInstallSession = async (
  key: string,
  patch: Partial<Omit<PersistedModelInstallSession, 'key'>>
) => {
  const sessions = await readSessions();
  const current = sessions[key];
  if (!current) return;
  sessions[key] = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeSessions(sessions);
};

export const removeModelInstallSession = async (key: string) => {
  const sessions = await readSessions();
  if (!(key in sessions)) return;
  delete sessions[key];
  await writeSessions(sessions);
};

export const listModelInstallSessions = async () => Object.values(await readSessions());
