import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import calendarRoutes from '../src/routes/calendar';
import { caldavRouter } from '../src/caldav/server';
import CalendarFeed from '../src/models/CalendarFeed';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const app = express();
app.set('io', { to: () => ({ emit: () => undefined }) });
app.use('/api/dav', caldavRouter); // primary mount (rides the public /api/* edge route)
app.use(express.json());
app.use('/api/calendar', calendarRoutes);

const AUTH = ['Authorization', 'Bearer demo-token'] as const;

const seedItems = [
  { uid: 'task-1', title: 'Köp mjölk', start: '2026-07-01T13:30:00.000Z', allDay: false, completed: false, priority: 1, description: 'från ICA' },
  { uid: 'task-2', title: 'Ring tandläkaren', start: '2026-07-02T00:00:00.000Z', allDay: true, completed: false },
];

/** Create an all-tasks share + a CalDAV credential for it; return the access bits. */
const mintShareWithDav = async (over?: { name?: string; listIds?: string[]; items?: any[] }) => {
  const share = await request(app).post('/api/calendar/shares').set(...AUTH).send({
    name: over?.name ?? 'Mina uppgifter', listIds: over?.listIds ?? [], items: over?.items ?? seedItems,
  });
  expect(share.status).toBe(200);
  const dav = await request(app).post(`/api/calendar/shares/${share.body.shareId}/dav`).set(...AUTH).send({});
  expect(dav.status).toBe(200);
  return { shareId: share.body.shareId, icsUrl: share.body.icsUrl, username: dav.body.username, password: dav.body.password };
};

describe('CalDAV bridge (shares)', () => {
  let mongoServer: MongoMemoryServer;
  let shareId = '';
  let username = '';
  let password = '';
  let collectionUrl = '';

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await CalendarFeed.deleteMany({});
    const m = await mintShareWithDav();
    shareId = m.shareId; username = m.username; password = m.password;
    expect(username).toMatch(/^noter-[0-9a-f]{16}$/);
    expect(password).toHaveLength(32);
    collectionUrl = `/api/dav/${username}/cal/tasks/`;
  });

  it('OPTIONS advertises CalDAV capabilities without auth', async () => {
    const res = await request(app).options('/api/dav/');
    expect(res.status).toBe(204);
    expect(res.headers['dav']).toContain('calendar-access');
    expect(res.headers['allow']).toContain('PROPFIND');
  });

  it('rejects no credentials (401 + WWW-Authenticate, no charset)', async () => {
    const res = await (request(app) as any).propfind('/api/dav/').set('Depth', '0');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="Noter"');
  });

  it('rejects a wrong password (401)', async () => {
    const res = await (request(app) as any).propfind(`/api/dav/${username}/`).auth(username, 'wrong').set('Depth', '0');
    expect(res.status).toBe(401);
  });

  it('PROPFIND principal returns current-user-principal + calendar-home-set', async () => {
    const res = await (request(app) as any).propfind(`/api/dav/${username}/`).auth(username, password).set('Depth', '0');
    expect(res.status).toBe(207);
    expect(res.text).toContain('current-user-principal');
    expect(res.text).toContain('calendar-home-set');
    expect(res.text).toContain(`/api/dav/${username}/cal/`);
  });

  it('PROPFIND collection Depth:1 lists VTODO resources', async () => {
    const res = await (request(app) as any).propfind(collectionUrl).auth(username, password).set('Depth', '1');
    expect(res.status).toBe(207);
    expect(res.text).toContain('VTODO');
    expect(res.text).toContain('task-1.ics');
    expect(res.text).toContain('task-2.ics');
  });

  it('REPORT calendar-query returns VTODO data', async () => {
    const body =
      '<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
      '<d:prop><d:getetag/><c:calendar-data/></d:prop>' +
      '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter></c:calendar-query>';
    const res = await (request(app) as any).report(collectionUrl).auth(username, password).type('application/xml').send(body);
    expect(res.status).toBe(207);
    expect(res.text).toContain('BEGIN:VTODO');
    expect(res.text).toContain('UID:task-1');
    expect(res.text).toContain('PRIORITY:1');
  });

  it('GET a resource returns its VTODO + ETag', async () => {
    const res = await request(app).get(`${collectionUrl}task-1.ics`).auth(username, password);
    expect(res.status).toBe(200);
    expect(res.headers['etag']).toBeTruthy();
    expect(res.text).toContain('UID:task-1');
  });

  it('PUT marking complete enqueues an upsert mutation', async () => {
    const vtodo =
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:task-1\r\nSUMMARY:Köp mjölk\r\n' +
      'STATUS:COMPLETED\r\nPERCENT-COMPLETE:100\r\nEND:VTODO\r\nEND:VCALENDAR\r\n';
    const put = await request(app).put(`${collectionUrl}task-1.ics`).auth(username, password).type('text/calendar').send(vtodo);
    expect([200, 204]).toContain(put.status);
    const drain = await request(app).get('/api/calendar/mutations').set(...AUTH);
    const m = drain.body.mutations.find((x: any) => x.uid === 'task-1');
    expect(m.op).toBe('upsert');
    expect(m.data.completed).toBe(true);
    expect(m.shareId).toBe(shareId);
  });

  it('DELETE enqueues a delete mutation; ack clears it', async () => {
    const del = await request(app).delete(`${collectionUrl}task-2.ics`).auth(username, password);
    expect(del.status).toBe(204);
    let drain = await request(app).get('/api/calendar/mutations').set(...AUTH);
    const m = drain.body.mutations.find((x: any) => x.uid === 'task-2');
    expect(m.op).toBe('delete');
    await request(app).post('/api/calendar/mutations/ack').set(...AUTH).send({ ids: [m.id] });
    drain = await request(app).get('/api/calendar/mutations').set(...AUTH);
    expect(drain.body.mutations.find((x: any) => x.uid === 'task-2')).toBeFalsy();
  });

  it("a credential cannot access another user's tree (403)", async () => {
    const res = await (request(app) as any).propfind('/api/dav/noter-deadbeefdeadbeef/').auth(username, password).set('Depth', '0');
    expect(res.status).toBe(403);
  });

  it('revoking the credential immediately denies access (401)', async () => {
    await request(app).delete(`/api/calendar/shares/${shareId}/dav`).set(...AUTH);
    const res = await (request(app) as any).propfind(`/api/dav/${username}/`).auth(username, password).set('Depth', '0');
    expect(res.status).toBe(401);
  });

  it('GET /shares lists the user shares', async () => {
    const res = await request(app).get('/api/calendar/shares').set(...AUTH);
    expect(res.status).toBe(200);
    const s = res.body.shares.find((x: any) => x.shareId === shareId);
    expect(s.name).toBe('Mina uppgifter');
    expect(s.icsUrl).toContain('.ics');
    expect(s.dav.username).toBe(username);
  });

  it('allows multiple DAV-disabled shares to coexist (partial-unique index)', async () => {
    await CalendarFeed.syncIndexes();
    await CalendarFeed.deleteMany({});
    const a = await request(app).post('/api/calendar/shares').set(...AUTH).send({ name: 'A', listIds: [] });
    const b = await request(app).post('/api/calendar/shares').set(...AUTH).send({ name: 'B', listIds: ['list-zzz'] });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await CalendarFeed.countDocuments({ davUser: null })).toBe(2);
  });

  it('kill-switch CALENDAR_CALDAV_ENABLED=0 darkens /dav + blocks minting', async () => {
    const prev = process.env.CALENDAR_CALDAV_ENABLED;
    process.env.CALENDAR_CALDAV_ENABLED = '0';
    try {
      expect((await request(app).options('/api/dav/')).status).toBe(404);
      const mint = await request(app).post(`/api/calendar/shares/${shareId}/dav`).set(...AUTH).send({});
      expect(mint.status).toBe(403);
    } finally { process.env.CALENDAR_CALDAV_ENABLED = prev; }
  });

  it('kill-switch CALENDAR_ICS_ENABLED=0 stops serving the ICS feed', async () => {
    const prev = process.env.CALENDAR_ICS_ENABLED;
    const share = await request(app).post('/api/calendar/shares').set(...AUTH).send({ name: 'x', listIds: [] });
    const token = String(share.body.icsUrl).match(/\/calendar\/(.+)\.ics$/)![1];
    process.env.CALENDAR_ICS_ENABLED = '0';
    try {
      expect((await request(app).get(`/api/calendar/${token}.ics`)).status).toBe(404);
    } finally { process.env.CALENDAR_ICS_ENABLED = prev; }
  });

  it('a share scoped to listIds only exposes those lists (union isolation)', async () => {
    // The all-share above has task-1/task-2; a list-scoped share has only its own items.
    const m = await mintShareWithDav({ name: 'Lista', listIds: ['list-abc'], items: [{ uid: 'L1', title: 'Endast lista', start: '2026-07-03T00:00:00.000Z', allDay: true, completed: false }] });
    const res = await (request(app) as any).propfind(`/api/dav/${m.username}/cal/tasks/`).auth(m.username, m.password).set('Depth', '1');
    expect(res.text).toContain('L1.ics');
    expect(res.text).not.toContain('task-1.ics');
  });

  // The user's hard requirement: tasks with NO date/time must sync both ways too.
  // An undated projection item: empty start, no due date.
  const undatedItems = [
    { uid: 'no-date-1', title: 'Uppgift utan deadline', start: '', allDay: true, completed: false },
    { uid: 'dated-1', title: 'Med deadline', start: '2026-07-05T00:00:00.000Z', allDay: true, completed: false },
  ];

  it('serves an undated task as a VTODO with NO DUE line, alongside dated ones', async () => {
    const m = await mintShareWithDav({ name: 'Allt', listIds: [], items: undatedItems });
    const col = `/api/dav/${m.username}/cal/tasks/`;

    // Both appear as resources (undated is NOT dropped).
    const propfind = await (request(app) as any).propfind(col).auth(m.username, m.password).set('Depth', '1');
    expect(propfind.status).toBe(207);
    expect(propfind.text).toContain('no-date-1.ics');
    expect(propfind.text).toContain('dated-1.ics');

    // The undated VTODO carries a UID + SUMMARY but no DUE property.
    const get = await request(app).get(`${col}no-date-1.ics`).auth(m.username, m.password);
    expect(get.status).toBe(200);
    expect(get.text).toContain('UID:no-date-1');
    expect(get.text).toContain('SUMMARY:Uppgift utan deadline');
    expect(get.text).not.toContain('DUE');

    // The dated one DOES carry a DUE.
    const getDated = await request(app).get(`${col}dated-1.ics`).auth(m.username, m.password);
    expect(getDated.text).toContain('DUE');
  });

  it('accepts an external add of a brand-new UNDATED task (PUT without DUE) → upsert mutation', async () => {
    const m = await mintShareWithDav({ name: 'Allt', listIds: [], items: undatedItems });
    const col = `/api/dav/${m.username}/cal/tasks/`;
    const vtodo =
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:new-undated\r\n' +
      'SUMMARY:Ny utan datum\r\nSTATUS:NEEDS-ACTION\r\nEND:VTODO\r\nEND:VCALENDAR\r\n';
    const put = await request(app).put(`${col}new-undated.ics`).auth(m.username, m.password).type('text/calendar').send(vtodo);
    expect([200, 201, 204]).toContain(put.status);
    const drain = await request(app).get('/api/calendar/mutations').set(...AUTH);
    const mut = drain.body.mutations.find((x: any) => x.uid === 'new-undated');
    expect(mut.op).toBe('upsert');
    expect(mut.data.summary).toBe('Ny utan datum');
    expect(mut.data.due == null || mut.data.due === undefined).toBe(true); // stays undated
  });

  it('accepts adding a due date to a previously undated task (PUT with DUE) → upsert carries the due', async () => {
    const m = await mintShareWithDav({ name: 'Allt', listIds: [], items: undatedItems });
    const col = `/api/dav/${m.username}/cal/tasks/`;
    const vtodo =
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:no-date-1\r\n' +
      'SUMMARY:Uppgift utan deadline\r\nDUE;VALUE=DATE:20260710\r\nSTATUS:NEEDS-ACTION\r\nEND:VTODO\r\nEND:VCALENDAR\r\n';
    const put = await request(app).put(`${col}no-date-1.ics`).auth(m.username, m.password).type('text/calendar').send(vtodo);
    expect([200, 204]).toContain(put.status);
    const drain = await request(app).get('/api/calendar/mutations').set(...AUTH);
    const mut = drain.body.mutations.find((x: any) => x.uid === 'no-date-1');
    expect(mut.op).toBe('upsert');
    expect(String(mut.data.due)).toContain('2026-07-10');
  });
});
