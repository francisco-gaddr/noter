import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import calendarRoutes from '../src/routes/calendar';
import { caldavRouter } from '../src/caldav/server';
import CalendarFeed from '../src/models/CalendarFeed';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

// Production mounts /dav BEFORE express.json (CalDAV bodies are XML/text); mirror that.
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

describe('CalDAV bridge', () => {
  let mongoServer: MongoMemoryServer;
  let username = '';
  let password = '';
  let collectionUrl = ''; // path-absolute /api/dav/<user>/cal/tasks/

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
    // Mint a CalDAV credential for the all-tasks scope, seeding two items.
    const res = await request(app)
      .post('/api/calendar/dav')
      .set(...AUTH)
      .send({ listId: null, displayName: 'Mina uppgifter', items: seedItems });
    expect(res.status).toBe(200);
    username = res.body.username;
    password = res.body.password;
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

  it('rejects a request with no credentials (401 + WWW-Authenticate)', async () => {
    const res = await (request(app) as any).propfind('/api/dav/').set('Depth', '0');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('Basic');
  });

  it('rejects a wrong password (401)', async () => {
    const res = await (request(app) as any).propfind(`/api/dav/${username}/`).auth(username, 'wrong-pass').set('Depth', '0');
    expect(res.status).toBe(401);
  });

  it('PROPFIND principal returns current-user-principal + calendar-home-set', async () => {
    const res = await (request(app) as any).propfind(`/api/dav/${username}/`).auth(username, password).set('Depth', '0');
    expect(res.status).toBe(207);
    expect(res.text).toContain('current-user-principal');
    expect(res.text).toContain('calendar-home-set');
    expect(res.text).toContain(`/api/dav/${username}/cal/`);
  });

  it('PROPFIND collection Depth:1 lists VTODO resources with etags', async () => {
    const res = await (request(app) as any).propfind(collectionUrl).auth(username, password).set('Depth', '1');
    expect(res.status).toBe(207);
    expect(res.text).toContain('VTODO'); // supported-calendar-component-set
    expect(res.text).toContain('task-1.ics');
    expect(res.text).toContain('task-2.ics');
    expect(res.text).toContain('getetag');
  });

  it('REPORT calendar-query returns VTODO calendar-data', async () => {
    const body =
      '<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
      '<d:prop><d:getetag/><c:calendar-data/></d:prop>' +
      '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter>' +
      '</c:calendar-query>';
    const res = await (request(app) as any).report(collectionUrl).auth(username, password).type('application/xml').send(body);
    expect(res.status).toBe(207);
    expect(res.text).toContain('BEGIN:VTODO');
    expect(res.text).toContain('UID:task-1');
    expect(res.text).toContain('SUMMARY:Köp mjölk');
    expect(res.text).toContain('PRIORITY:1');
  });

  it('GET a single resource returns its VTODO + ETag', async () => {
    const res = await request(app).get(`${collectionUrl}task-1.ics`).auth(username, password);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.headers['etag']).toBeTruthy();
    expect(res.text).toContain('BEGIN:VTODO');
    expect(res.text).toContain('UID:task-1');
  });

  it('PUT marking complete enqueues an upsert mutation', async () => {
    const vtodo =
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:task-1\r\nSUMMARY:Köp mjölk\r\n' +
      'STATUS:COMPLETED\r\nPERCENT-COMPLETE:100\r\nEND:VTODO\r\nEND:VCALENDAR\r\n';
    const put = await request(app).put(`${collectionUrl}task-1.ics`).auth(username, password).type('text/calendar').send(vtodo);
    expect([200, 204]).toContain(put.status);

    const drain = await request(app).get('/api/calendar/mutations').set(...AUTH);
    expect(drain.status).toBe(200);
    const m = drain.body.mutations.find((x: any) => x.uid === 'task-1');
    expect(m).toBeTruthy();
    expect(m.op).toBe('upsert');
    expect(m.data.completed).toBe(true);
  });

  it('DELETE enqueues a delete mutation; ack clears the queue', async () => {
    const del = await request(app).delete(`${collectionUrl}task-2.ics`).auth(username, password);
    expect(del.status).toBe(204);

    let drain = await request(app).get('/api/calendar/mutations').set(...AUTH);
    const m = drain.body.mutations.find((x: any) => x.uid === 'task-2');
    expect(m.op).toBe('delete');

    const ack = await request(app).post('/api/calendar/mutations/ack').set(...AUTH).send({ ids: [m.id] });
    expect(ack.status).toBe(200);
    drain = await request(app).get('/api/calendar/mutations').set(...AUTH);
    expect(drain.body.mutations.find((x: any) => x.uid === 'task-2')).toBeFalsy();
  });

  it('a credential cannot access another user\'s principal tree (403)', async () => {
    const res = await (request(app) as any)
      .propfind('/api/dav/noter-deadbeefdeadbeef/')
      .auth(username, password)
      .set('Depth', '0');
    expect(res.status).toBe(403);
  });

  it('revoking the credential immediately denies CalDAV access (401)', async () => {
    await request(app).delete('/api/calendar/dav').set(...AUTH).send({ listId: null });
    const res = await (request(app) as any).propfind(`/api/dav/${username}/`).auth(username, password).set('Depth', '0');
    expect(res.status).toBe(401);
  });

  it('allows multiple DAV-disabled feeds (davUser:null) to coexist (partial-unique index)', async () => {
    // Ensure the schema indexes (incl. the partial-unique davUser) are built.
    await CalendarFeed.syncIndexes();
    await CalendarFeed.deleteMany({});
    // Two plain ICS subscriptions for different scopes — both leave davUser null.
    const a = await request(app).post('/api/calendar/subscription').set(...AUTH).send({ listId: null });
    const b = await request(app).post('/api/calendar/subscription').set(...AUTH).send({ listId: 'list-zzz' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const count = await CalendarFeed.countDocuments({ davUser: null });
    expect(count).toBe(2); // would be impossible under a sparse-unique index
  });

  it('operator kill-switch: CALENDAR_CALDAV_ENABLED=0 darkens /dav and blocks minting', async () => {
    const prev = process.env.CALENDAR_CALDAV_ENABLED;
    process.env.CALENDAR_CALDAV_ENABLED = '0';
    try {
      // The protocol channel goes fully dark (no auth prompt, just 404).
      const opt = await request(app).options('/api/dav/');
      expect(opt.status).toBe(404);
      const pf = await (request(app) as any).propfind(`/api/dav/${username}/`).auth(username, password).set('Depth', '0');
      expect(pf.status).toBe(404);
      // Minting a new credential is refused.
      const mint = await request(app).post('/api/calendar/dav').set(...AUTH).send({ listId: null });
      expect(mint.status).toBe(403);
    } finally {
      process.env.CALENDAR_CALDAV_ENABLED = prev;
    }
  });

  it('operator kill-switch: CALENDAR_ICS_ENABLED=0 stops serving + creating ICS feeds', async () => {
    const prev = process.env.CALENDAR_ICS_ENABLED;
    // Need a token to probe the public GET; create the sub while enabled.
    const sub = await request(app).post('/api/calendar/subscription').set(...AUTH).send({ listId: null });
    const token = sub.body.token;
    process.env.CALENDAR_ICS_ENABLED = '0';
    try {
      const ics = await request(app).get(`/api/calendar/${token}.ics`);
      expect(ics.status).toBe(404);
      const create = await request(app).post('/api/calendar/subscription').set(...AUTH).send({ listId: 'x' });
      expect(create.status).toBe(403);
    } finally {
      process.env.CALENDAR_ICS_ENABLED = prev;
    }
  });

  it('per-list credential only sees its own list scope', async () => {
    // Mint a per-list credential with its own items; it must be isolated from "all".
    const listRes = await request(app)
      .post('/api/calendar/dav')
      .set(...AUTH)
      .send({ listId: 'list-abc', items: [{ uid: 'L1', title: 'Endast lista', start: '2026-07-03T00:00:00.000Z', allDay: true, completed: false }] });
    const lu = listRes.body.username;
    const lp = listRes.body.password;
    const res = await (request(app) as any).propfind(`/api/dav/${lu}/cal/tasks/`).auth(lu, lp).set('Depth', '1');
    expect(res.text).toContain('L1.ics');
    expect(res.text).not.toContain('task-1.ics'); // the all-scope items must not leak in
  });
});
