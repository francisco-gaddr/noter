import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import McpAuditLog from '../../models/McpAuditLog';
import { McpIntegrationId } from '@repo/shared';
import { getMcpAuditMasterKey } from '../../utils/security';

type PersistedAuditEvent = {
  at: number;
  userId: string;
  service: McpIntegrationId;
  action: 'list_tools' | 'call_tool' | 'call_tool_blocked' | 'error';
  toolName?: string;
  ok: boolean;
  message?: string;
};

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;

type KeyRing = {
  activeKeyId: string;
  keys: Record<string, Buffer>;
};

const toKey = (raw: string) => createHash('sha256').update(raw).digest();

const getKeyRing = (): KeyRing => {
  const rawRing = String(process.env.MCP_AUDIT_MASTER_KEYS || '').trim();
  const keys: Record<string, Buffer> = {};
  if (rawRing) {
    for (const pair of rawRing.split(',')) {
      const item = pair.trim();
      if (!item) continue;
      const sep = item.indexOf(':');
      if (sep <= 0) continue;
      const keyId = item.slice(0, sep).trim();
      const secret = item.slice(sep + 1).trim();
      if (!keyId || !secret) continue;
      keys[keyId] = toKey(secret);
    }
  }
  if (Object.keys(keys).length === 0) {
    keys.default = toKey(getMcpAuditMasterKey());
  }
  const configuredActive = String(process.env.MCP_AUDIT_ACTIVE_KEY_ID || '').trim();
  const activeKeyId = configuredActive && keys[configuredActive] ? configuredActive : Object.keys(keys)[0];
  return { activeKeyId, keys };
};

const encryptPayload = (value: string) => {
  const keyRing = getKeyRing();
  const keyId = keyRing.activeKeyId;
  const key = keyRing.keys[keyId];
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${keyId}.${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
};

const decryptPayload = (payload: string) => {
  const parts = String(payload || '').split('.');
  const keyRing = getKeyRing();
  const tryDecrypt = (key: Buffer, ivRaw: string, tagRaw: string, dataRaw: string) => {
    const iv = Buffer.from(ivRaw, 'base64');
    const tag = Buffer.from(tagRaw, 'base64');
    const data = Buffer.from(dataRaw, 'base64');
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  };
  if (parts.length === 5 && parts[0] === 'v1') {
    const keyId = parts[1];
    const key = keyRing.keys[keyId];
    if (!key) return '';
    try {
      return tryDecrypt(key, parts[2], parts[3], parts[4]);
    } catch {
      return '';
    }
  }
  if (parts.length === 3) {
    for (const key of Object.values(keyRing.keys)) {
      try {
        return tryDecrypt(key, parts[0], parts[1], parts[2]);
      } catch {}
    }
  }
  return '';
};

export const appendMcpAudit = async (event: PersistedAuditEvent) => {
  const payload = encryptPayload(JSON.stringify(event));
  await McpAuditLog.create({
    userId: event.userId,
    createdAt: new Date(event.at || Date.now()),
    payloadEnc: payload,
  });
};

export const listMcpAuditForUser = async (params: { userId: string; limit: number }) => {
  const docs = await McpAuditLog.find({ userId: params.userId })
    .sort({ createdAt: -1 })
    .limit(Math.max(1, Math.min(params.limit, 200)))
    .lean();
  const output: PersistedAuditEvent[] = [];
  for (const doc of docs) {
    try {
      const raw = decryptPayload(String((doc as any).payloadEnc || ''));
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.userId !== params.userId) continue;
      output.push(parsed);
    } catch {}
  }
  return output;
};
