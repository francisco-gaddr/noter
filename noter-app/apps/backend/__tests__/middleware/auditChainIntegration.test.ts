// Must be set BEFORE importing auditLog (it reads the key at module load).
process.env.AUDIT_HMAC_KEY = 'test-audit-key';

import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { auditLog, auditSealedFields, auditLogCollectionName } from '../../src/middleware/auditLog';
import { verifyAuditChain } from '../../src/utils/auditChain';

const KEY = 'test-audit-key';
let mongo: MongoMemoryServer;
let app: express.Express;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use(express.json());
  app.use('/api/x', (req, _res, next) => { (req as any).user = { userId: 'u1' }; next(); }, auditLog());
  app.post('/api/x/:id', (_req, res) => res.json({ ok: true }));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const coll = () => mongoose.connection.db!.collection(auditLogCollectionName());
const readChain = () => coll().find({}).sort({ seq: 1 }).toArray();
const flush = () => new Promise((r) => setTimeout(r, 200)); // audit writes are fire-and-forget on 'finish'

describe('audit-log tamper-evident chain (end to end)', () => {
  it('chains audited mutations (verifiable) and detects a DB-level tamper', async () => {
    for (const id of ['1', '2', '3']) await request(app).post(`/api/x/${id}`).send({ n: id });
    await flush();

    const entries = await readChain();
    expect(entries.length).toBe(3);
    // seq is monotonic, each links to the previous hash.
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(entries[0].prevHash).toBe('');
    expect(entries[1].prevHash).toBe(entries[0].hash);
    // The whole chain verifies with the operator key.
    expect(verifyAuditChain(KEY, entries as any, (e) => auditSealedFields(e))).toEqual({ ok: true, brokenAt: -1 });
    // A different key cannot validate it (the seal is keyed).
    expect(verifyAuditChain('wrong-key', entries as any, (e) => auditSealedFields(e)).ok).toBe(false);

    // Tamper: silently change a recorded field directly in the DB (what a DB-access attacker does).
    await coll().updateOne({ _id: entries[1]._id }, { $set: { status: 999 } });
    const tampered = await readChain();
    const v = verifyAuditChain(KEY, tampered as any, (e) => auditSealedFields(e));
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(1);
    expect(v.reason).toBe('modified');
  });
});
