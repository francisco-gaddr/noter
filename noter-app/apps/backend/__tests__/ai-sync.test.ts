import request from 'supertest';
import express from 'express';
import bodyParser from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { authMiddleware } from '../src/middleware/authMiddleware';
import aiSyncRoutes from '../src/routes/aiSync';
import AIConversationSync from '../src/models/AIConversationSync';
import AIMessageSync from '../src/models/AIMessageSync';
import AIProjectSync from '../src/models/AIProjectSync';
import { decrypt, decryptV3, encrypt, encryptV3 } from '@repo/shared';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
jest.setTimeout(30_000);

const app = express();
app.use(bodyParser.json());
const emitMock = jest.fn();
const toMock = jest.fn(() => ({ emit: emitMock }));
app.set('io', { to: toMock });
app.use('/api/ai/sync', authMiddleware, aiSyncRoutes);

describe('AI sync routes', () => {
  let mongoServer: MongoMemoryServer;
  const originalAiSyncMaxRecords = process.env.AI_SYNC_MAX_RECORDS_PER_USER;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    if (originalAiSyncMaxRecords === undefined) {
      delete process.env.AI_SYNC_MAX_RECORDS_PER_USER;
    } else {
      process.env.AI_SYNC_MAX_RECORDS_PER_USER = originalAiSyncMaxRecords;
    }
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await AIConversationSync.deleteMany({});
    await AIMessageSync.deleteMany({});
    await AIProjectSync.deleteMany({});
    delete process.env.AI_SYNC_MAX_RECORDS_PER_USER;
    toMock.mockClear();
    emitMock.mockReset();
  });

  it('pushes and pulls encrypted ai entities', async () => {
    const raw = {
      projectName: 'Projekt Krypterat',
      prompt: 'System hemlighet',
      chatTitle: 'Konversation Krypterad',
      messageContent: 'Meddelande hemligt',
      createdAt: '2026-03-12T10:00:00.000Z',
      updatedAt: '2026-03-12T10:01:00.000Z',
      messageAt: '2026-03-12T10:02:00.000Z',
    };
    const pushRes = await request(app)
      .post('/api/ai/sync/push')
      .set('Authorization', 'Bearer demo-token')
      .send({
        projects: [{
          id: 'p1',
          nameEnc: encrypt(raw.projectName),
          systemPromptEnc: encrypt(raw.prompt),
          iconEnc: '',
          iconColorEnc: '',
          createdAtEnc: encrypt(raw.createdAt),
          updatedAtEnc: encrypt(raw.updatedAt),
          updatedAt: raw.updatedAt,
        }],
        conversations: [{
          id: 'c1',
          titleEnc: encrypt(raw.chatTitle),
          modelEnc: encrypt('gpt'),
          projectIdEnc: encrypt('p1'),
          iconEnc: '',
          iconColorEnc: '',
          createdAtEnc: encrypt(raw.createdAt),
          updatedAtEnc: encrypt(raw.updatedAt),
          updatedAt: raw.updatedAt,
        }],
        messages: [{
          id: 'm1',
          conversationId: 'c1',
          roleEnc: encrypt('user'),
          contentEnc: encrypt(raw.messageContent),
          createdAtEnc: encrypt(raw.messageAt),
          createdAt: raw.messageAt,
        }],
      });

    expect(pushRes.status).toBe(200);
    expect(pushRes.body.ok).toBe(true);

    const pullRes = await request(app)
      .get('/api/ai/sync/pull')
      .set('Authorization', 'Bearer demo-token');

    expect(pullRes.status).toBe(200);
    expect(pullRes.body.projects).toHaveLength(1);
    expect(pullRes.body.conversations).toHaveLength(1);
    expect(pullRes.body.messages).toHaveLength(1);
    expect(decrypt(pullRes.body.projects[0].nameEnc)).toBe(raw.projectName);
    expect(decrypt(pullRes.body.conversations[0].titleEnc)).toBe(raw.chatTitle);
    expect(decrypt(pullRes.body.messages[0].contentEnc)).toBe(raw.messageContent);

    const storedConversation = await AIConversationSync.findOne({ userId: 'demo-user-id', conversationId: 'c1' }).lean();
    const storedMessage = await AIMessageSync.findOne({ userId: 'demo-user-id', messageId: 'm1' }).lean();
    expect(storedConversation?.titleEnc).not.toContain(raw.chatTitle);
    expect(storedMessage?.contentEnc).not.toContain(raw.messageContent);
  });

  it('accepts and returns v3 encrypted ai sync payloads', async () => {
    const raw = {
      projectName: 'Projekt V3',
      prompt: 'Prompt V3',
      chatTitle: 'Konversation V3',
      messageContent: 'Meddelande V3',
      createdAt: '2026-03-12T10:00:00.000Z',
      updatedAt: '2026-03-12T10:01:00.000Z',
      messageAt: '2026-03-12T10:02:00.000Z',
    };
    const pushRes = await request(app)
      .post('/api/ai/sync/push')
      .set('Authorization', 'Bearer demo-token')
      .send({
        projects: [{
          id: 'p-v3',
          nameEnc: await encryptV3(raw.projectName),
          systemPromptEnc: await encryptV3(raw.prompt),
          iconEnc: '',
          iconColorEnc: '',
          createdAtEnc: await encryptV3(raw.createdAt),
          updatedAtEnc: await encryptV3(raw.updatedAt),
          updatedAt: raw.updatedAt,
        }],
        conversations: [{
          id: 'c-v3',
          titleEnc: await encryptV3(raw.chatTitle),
          modelEnc: await encryptV3('gpt'),
          projectIdEnc: await encryptV3('p-v3'),
          iconEnc: '',
          iconColorEnc: '',
          createdAtEnc: await encryptV3(raw.createdAt),
          updatedAtEnc: await encryptV3(raw.updatedAt),
          updatedAt: raw.updatedAt,
        }],
        messages: [{
          id: 'm-v3',
          conversationId: 'c-v3',
          roleEnc: await encryptV3('user'),
          contentEnc: await encryptV3(raw.messageContent),
          createdAtEnc: await encryptV3(raw.messageAt),
          createdAt: raw.messageAt,
        }],
      });

    expect(pushRes.status).toBe(200);
    expect(pushRes.body.ok).toBe(true);

    const pullRes = await request(app)
      .get('/api/ai/sync/pull')
      .set('Authorization', 'Bearer demo-token');

    expect(pullRes.status).toBe(200);
    await expect(decryptV3(pullRes.body.projects[0].nameEnc)).resolves.toBe(raw.projectName);
    await expect(decryptV3(pullRes.body.conversations[0].titleEnc)).resolves.toBe(raw.chatTitle);
    await expect(decryptV3(pullRes.body.messages[0].contentEnc)).resolves.toBe(raw.messageContent);
  });

  it('emits scoped ai sync event after push', async () => {
    const pushRes = await request(app)
      .post('/api/ai/sync/push')
      .set('Authorization', 'Bearer demo-token')
      .send({
        projects: [],
        conversations: [{
          id: 'c2',
          titleEnc: encrypt('enc-title-2'),
          modelEnc: '',
          projectIdEnc: '',
          iconEnc: '',
          iconColorEnc: '',
          createdAtEnc: encrypt('2026-03-12T10:01:00.000Z'),
          updatedAtEnc: encrypt('2026-03-12T10:01:00.000Z'),
          updatedAt: '2026-03-12T10:01:00.000Z',
        }],
        messages: [],
      });
    expect(pushRes.status).toBe(200);
    expect(toMock).toHaveBeenCalledWith('user:demo-user-id');
    expect(emitMock).toHaveBeenCalledWith(
      'ai:sync-updated',
      expect.objectContaining({
        conversations: 1,
      })
    );
  });

  it('rejects plaintext ai sync payload fields', async () => {
    const res = await request(app)
      .post('/api/ai/sync/push')
      .set('Authorization', 'Bearer demo-token')
      .send({
        projects: [{
          id: 'p1',
          nameEnc: 'not-encrypted',
          systemPromptEnc: '',
          iconEnc: '',
          iconColorEnc: '',
          createdAtEnc: '2026-03-12T10:00:00.000Z',
          updatedAtEnc: '2026-03-12T10:00:00.000Z',
          updatedAt: '2026-03-12T10:00:00.000Z',
        }],
      });

    expect(res.status).toBe(400);
  });

  it('rejects pushes that would exceed the ai sync message quota', async () => {
    process.env.AI_SYNC_MAX_RECORDS_PER_USER = '2';
    await AIMessageSync.create([
      {
        userId: 'demo-user-id',
        conversationId: 'c-existing',
        messageId: 'm-existing-1',
        roleEnc: encrypt('user'),
        contentEnc: encrypt('one'),
        toolCallsEnc: '',
        toolCallIdEnc: '',
        createdAtEnc: encrypt('2026-03-12T10:00:00.000Z'),
        createdAt: new Date('2026-03-12T10:00:00.000Z'),
      },
      {
        userId: 'demo-user-id',
        conversationId: 'c-existing',
        messageId: 'm-existing-2',
        roleEnc: encrypt('assistant'),
        contentEnc: encrypt('two'),
        toolCallsEnc: '',
        toolCallIdEnc: '',
        createdAtEnc: encrypt('2026-03-12T10:01:00.000Z'),
        createdAt: new Date('2026-03-12T10:01:00.000Z'),
      },
    ]);

    const res = await request(app)
      .post('/api/ai/sync/push')
      .set('Authorization', 'Bearer demo-token')
      .send({
        messages: [{
          id: 'm-new',
          conversationId: 'c-existing',
          roleEnc: encrypt('user'),
          contentEnc: encrypt('three'),
          createdAtEnc: encrypt('2026-03-12T10:02:00.000Z'),
          createdAt: '2026-03-12T10:02:00.000Z',
        }],
      });

    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/quota exceeded/i);
  });

  it('allows updating an existing ai sync message at quota limit', async () => {
    process.env.AI_SYNC_MAX_RECORDS_PER_USER = '1';
    await AIMessageSync.create({
      userId: 'demo-user-id',
      conversationId: 'c-existing',
      messageId: 'm-existing',
      roleEnc: encrypt('user'),
      contentEnc: encrypt('before'),
      toolCallsEnc: '',
      toolCallIdEnc: '',
      createdAtEnc: encrypt('2026-03-12T10:00:00.000Z'),
      createdAt: new Date('2026-03-12T10:00:00.000Z'),
    });

    const res = await request(app)
      .post('/api/ai/sync/push')
      .set('Authorization', 'Bearer demo-token')
      .send({
        messages: [{
          id: 'm-existing',
          conversationId: 'c-existing',
          roleEnc: encrypt('assistant'),
          contentEnc: encrypt('after'),
          createdAtEnc: encrypt('2026-03-12T10:00:00.000Z'),
          createdAt: '2026-03-12T10:00:00.000Z',
        }],
      });

    expect(res.status).toBe(200);
    const stored = await AIMessageSync.findOne({ userId: 'demo-user-id', messageId: 'm-existing' }).lean();
    expect(stored).not.toBeNull();
    expect(decrypt(stored?.contentEnc || '')).toBe('after');
  });
});
