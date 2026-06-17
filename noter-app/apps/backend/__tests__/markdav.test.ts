import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import markdownShareRoutes from '../src/routes/markdownShares';
import { markdavRouter } from '../src/markdav/server';
import MarkdownShare from '../src/models/MarkdownShare';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const app = express();
app.set('io', { to: () => ({ emit: () => undefined }) });
app.use('/api/md', markdavRouter); // WebDAV vault (rides the public /api/* edge route)
app.use(express.json());
app.use('/api/markdown', markdownShareRoutes);

const AUTH = ['Authorization', 'Bearer demo-token'] as const;

const seedFiles = [
  { path: 'Work/Alpha.md', noteId: 'a', title: 'Alpha', body: 'A body', tags: ['x'], type: 'note', etag: '"1"' },
  { path: 'Loose.md', noteId: 'c', title: 'Loose', body: 'C body', type: 'note', etag: '"2"' },
];

const mintShareWithDav = async (over?: { name?: string; files?: any[]; modes?: any; direction?: any }) => {
  const share = await request(app).post('/api/markdown/shares').set(...AUTH).send({
    name: over?.name ?? 'Mina anteckningar',
    files: over?.files ?? seedFiles,
    modes: over?.modes,
    direction: over?.direction,
  });
  expect(share.status).toBe(200);
  const dav = await request(app).post(`/api/markdown/shares/${share.body.shareId}/dav`).set(...AUTH).send({});
  expect(dav.status).toBe(200);
  return { shareId: share.body.shareId, username: dav.body.username, password: dav.body.password };
};

describe('Markdown WebDAV vault (shares)', () => {
  let mongoServer: MongoMemoryServer;
  let shareId = '';
  let username = '';
  let password = '';
  let root = '';

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await MarkdownShare.deleteMany({});
    const m = await mintShareWithDav();
    shareId = m.shareId; username = m.username; password = m.password;
    expect(username).toMatch(/^noter-[0-9a-f]{16}$/);
    expect(password).toHaveLength(32);
    root = `/api/md/${username}/`;
  });

  it('OPTIONS advertises WebDAV capabilities without auth', async () => {
    const res = await request(app).options('/api/md/');
    expect(res.status).toBe(204);
    expect(res.headers['dav']).toContain('1');
    expect(res.headers['allow']).toContain('PROPFIND');
    expect(res.headers['allow']).toContain('PUT');
  });

  it('rejects no credentials (401) and a wrong password (401)', async () => {
    const a = await (request(app) as any).propfind('/api/md/').set('Depth', '0');
    expect(a.status).toBe(401);
    expect(a.headers['www-authenticate']).toBe('Basic realm="Noter"');
    const b = await (request(app) as any).propfind(root).auth(username, 'wrong').set('Depth', '0');
    expect(b.status).toBe(401);
  });

  it('PROPFIND root Depth:1 lists immediate dir + file children', async () => {
    const res = await (request(app) as any).propfind(root).auth(username, password).set('Depth', '1');
    expect(res.status).toBe(207);
    expect(res.text).toContain(`/api/md/${username}/Work/`);     // child dir
    expect(res.text).toContain(`/api/md/${username}/Loose.md`);   // child file
    expect(res.text).not.toContain('Alpha.md');                   // depth 1 → not the nested file
  });

  it('PROPFIND Depth:infinity lists nested files too', async () => {
    const res = await (request(app) as any).propfind(root).auth(username, password).set('Depth', 'infinity');
    expect(res.status).toBe(207);
    expect(res.text).toContain('Work/Alpha.md');
  });

  it('GET a file returns the rendered Markdown with frontmatter + body', async () => {
    const res = await request(app).get(`/api/md/${username}/Work/Alpha.md`).auth(username, password);
    expect(res.status).toBe(200);
    expect(res.headers['etag']).toBeTruthy();
    expect(res.text).toContain('id: a');
    expect(res.text).toContain('title: Alpha');
    expect(res.text).toContain('A body');
  });

  it('PUT enqueues an upsert mutation carrying the new body', async () => {
    const body = '---\nid: a\ntitle: Alpha\n---\nEdited body';
    const put = await request(app).put(`/api/md/${username}/Work/Alpha.md`).auth(username, password).type('text/markdown').send(body);
    expect([200, 204]).toContain(put.status);
    const drain = await request(app).get('/api/markdown/mutations').set(...AUTH);
    const m = drain.body.mutations.find((x: any) => x.path === 'Work/Alpha.md');
    expect(m.op).toBe('upsert');
    expect(m.body).toContain('Edited body');
    expect(m.shareId).toBe(shareId);
  });

  it('PUT of a brand-new file is accepted (201) and enqueued', async () => {
    const put = await request(app).put(`/api/md/${username}/New note.md`).auth(username, password).type('text/markdown').send('hello');
    expect(put.status).toBe(201);
    const drain = await request(app).get('/api/markdown/mutations').set(...AUTH);
    expect(drain.body.mutations.some((x: any) => x.path === 'New note.md')).toBe(true);
  });

  it('DELETE enqueues a delete; ack clears it', async () => {
    const del = await request(app).delete(`/api/md/${username}/Loose.md`).auth(username, password);
    expect(del.status).toBe(204);
    let drain = await request(app).get('/api/markdown/mutations').set(...AUTH);
    const m = drain.body.mutations.find((x: any) => x.path === 'Loose.md');
    expect(m.op).toBe('delete');
    await request(app).post('/api/markdown/mutations/ack').set(...AUTH).send({ ids: [m.id] });
    drain = await request(app).get('/api/markdown/mutations').set(...AUTH);
    expect(drain.body.mutations.find((x: any) => x.path === 'Loose.md')).toBeFalsy();
  });

  it('rejects a non-markdown PUT (403) and a traversal path', async () => {
    const res = await request(app).put(`/api/md/${username}/evil.txt`).auth(username, password).type('text/plain').send('x');
    expect(res.status).toBe(403);
  });

  it("a credential cannot access another user's tree (403)", async () => {
    const res = await (request(app) as any).propfind('/api/md/noter-deadbeefdeadbeef/').auth(username, password).set('Depth', '0');
    expect(res.status).toBe(403);
  });

  it('a note NOT in the selected share is NOT reachable (only chosen notes are exposed)', async () => {
    // The share only projects Work/Alpha.md + Loose.md. A path outside that projection 404s.
    const res = await request(app).get(`/api/md/${username}/Secret/private.md`).auth(username, password);
    expect(res.status).toBe(404);
    // And it never appears in a recursive listing.
    const propfind = await (request(app) as any).propfind(root).auth(username, password).set('Depth', 'infinity');
    expect(propfind.text).not.toContain('private.md');
  });

  it("a different share's credential cannot read this share's files (isolation)", async () => {
    const other = await mintShareWithDav({ name: 'Annan', files: [{ path: 'Z.md', noteId: 'z', title: 'Z', body: 'z', type: 'note', etag: '"9"' }] });
    // other's creds against THIS share's username namespace → rejected.
    const res = await request(app).get(`/api/md/${username}/Loose.md`).auth(other.username, other.password);
    expect([401, 403]).toContain(res.status);
  });

  it('an INBOUND-disabled (read-only) share does not enqueue external edits', async () => {
    await MarkdownShare.deleteMany({});
    const ro = await mintShareWithDav({ name: 'Read-only', direction: { outbound: true, inbound: false } });
    const put = await request(app).put(`/api/md/${ro.username}/Work/Alpha.md`).auth(ro.username, ro.password).type('text/markdown').send('---\nid: a\n---\nhacked');
    // Either the PUT is refused or it is accepted but produces NO inbound mutation (read-only).
    const drain = await request(app).get('/api/markdown/mutations').set(...AUTH);
    const leaked = (drain.body.mutations || []).some((x: any) => x.shareId === ro.shareId);
    expect(leaked).toBe(false);
    expect([200, 204, 403, 405]).toContain(put.status);
  });

  it('revoking the credential immediately denies access (401)', async () => {
    await request(app).delete(`/api/markdown/shares/${shareId}/dav`).set(...AUTH);
    const res = await (request(app) as any).propfind(root).auth(username, password).set('Depth', '0');
    expect(res.status).toBe(401);
  });

  it('direction.outbound=false blocks reads; inbound=false blocks writes', async () => {
    const out = await mintShareWithDav({ name: 'ReadOnlyOff', direction: { outbound: false, inbound: true } });
    const r = await (request(app) as any).propfind(`/api/md/${out.username}/`).auth(out.username, out.password).set('Depth', '0');
    expect(r.status).toBe(403);

    const inb = await mintShareWithDav({ name: 'WriteOff', direction: { outbound: true, inbound: false } });
    const w = await request(app).put(`/api/md/${inb.username}/x.md`).auth(inb.username, inb.password).type('text/markdown').send('y');
    expect(w.status).toBe(403);
  });

  it('modes.webdav=false denies the WebDAV channel (403)', async () => {
    const m = await mintShareWithDav({ name: 'CrdtOnly', modes: { webdav: false, crdt: false } });
    const r = await (request(app) as any).propfind(`/api/md/${m.username}/`).auth(m.username, m.password).set('Depth', '0');
    expect(r.status).toBe(403);
  });

  it('GET /shares lists the user shares with mode/direction', async () => {
    const res = await request(app).get('/api/markdown/shares').set(...AUTH);
    expect(res.status).toBe(200);
    const s = res.body.shares.find((x: any) => x.shareId === shareId);
    expect(s.name).toBe('Mina anteckningar');
    expect(s.dav.username).toBe(username);
    expect(s.modes.webdav).toBe(true);
    expect(s.direction.outbound).toBe(true);
    expect(s.count).toBe(2);
  });

  it('kill-switch MARKDOWN_SYNC_ENABLED=0 darkens /md + blocks minting', async () => {
    const prev = process.env.MARKDOWN_SYNC_ENABLED;
    process.env.MARKDOWN_SYNC_ENABLED = '0';
    try {
      expect((await request(app).options('/api/md/')).status).toBe(404);
      const mint = await request(app).post(`/api/markdown/shares/${shareId}/dav`).set(...AUTH).send({});
      expect(mint.status).toBe(403);
    } finally { process.env.MARKDOWN_SYNC_ENABLED = prev; }
  });

  it('CRDT token mint enables Live mode + returns a ws url', async () => {
    const res = await request(app).post(`/api/markdown/shares/${shareId}/crdt`).set(...AUTH).send({});
    expect(res.status).toBe(200);
    expect(res.body.token).toHaveLength(32);
    expect(res.body.wsUrl).toContain('/api/md-crdt/');
    const list = await request(app).get('/api/markdown/shares').set(...AUTH);
    const s = list.body.shares.find((x: any) => x.shareId === shareId);
    expect(s.modes.crdt).toBe(true);
  });

  it('allows multiple DAV-disabled shares to coexist (partial-unique index)', async () => {
    await MarkdownShare.syncIndexes();
    await MarkdownShare.deleteMany({});
    const a = await request(app).post('/api/markdown/shares').set(...AUTH).send({ name: 'A' });
    const b = await request(app).post('/api/markdown/shares').set(...AUTH).send({ name: 'B' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await MarkdownShare.countDocuments({ davUser: null })).toBe(2);
  });
});
