import express, { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import {
  generateVtodoCalendar,
  generateVtodoResource,
  itemEtag,
  parseVtodo,
  type CalendarFeedItem,
} from '@repo/shared';
import CalendarFeed, { ICalendarFeed } from '../models/CalendarFeed';
import { verifyDavPassword, parseBasicAuth } from './credentials';
import { isCaldavEnabled } from '../config/calendarExposure';
import {
  multistatus,
  responseXml,
  requestedProps,
  hrefsFromBody,
  reportType,
  xmlEscape,
} from './davXml';
import logger from '../utils/logger';

/**
 * CalDAV bridge server. Exposes the user's client-pushed task projection as a
 * read/write VTODO calendar that standard CalDAV clients (Tasks.org on Android,
 * Reminders on macOS/iOS) can subscribe to. Mounted at /dav, BEFORE the app's
 * browser-oriented middleware (CORS / JSON-enforcement / mongo-sanitize) which
 * don't apply to a native CalDAV client and would otherwise mangle XML bodies or
 * short-circuit the OPTIONS handshake.
 *
 * SECURITY MODEL
 * - Auth is HTTP Basic with a per-feed credential (davUser + a hashed secret),
 *   never the account password. Constant-time verify; failed-auth throttle per IP.
 * - A credential maps to EXACTLY ONE feed scope (all-tasks or one task-list), so a
 *   token can only ever read/write that scope. Least privilege; revoke is instant.
 * - The backend can't read/write the E2E-encrypted task. Reads render the opt-in,
 *   lock-aware projection; writes (PUT/DELETE) are recorded as a non-sensitive
 *   mutation intent the client applies with the user's key, then re-pushes.
 */

const DAV_HEADER = '1, 2, 3, calendar-access';
const ALLOW = 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT, PROPPATCH';
const CAL_COLOR = '#7c5cff';

// --- failed-auth throttle (in-memory, per IP) ------------------------------
const authFails = new Map<string, { n: number; until: number }>();
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_MAX = 30;
const ipKey = (req: Request): string => (req.ip || req.socket?.remoteAddress || 'unknown');
const isThrottled = (req: Request): boolean => {
  const rec = authFails.get(ipKey(req));
  return !!rec && rec.until > Date.now() && rec.n >= FAIL_MAX;
};
const noteAuthFail = (req: Request): void => {
  const k = ipKey(req);
  const now = Date.now();
  const rec = authFails.get(k);
  if (!rec || rec.until < now) authFails.set(k, { n: 1, until: now + FAIL_WINDOW_MS });
  else rec.n += 1;
  if (authFails.size > 2048) for (const [key, v] of authFails) if (v.until < now) authFails.delete(key);
};

// --- path parsing ----------------------------------------------------------
interface DavPath {
  kind: 'root' | 'principal' | 'home' | 'collection' | 'resource' | 'unknown';
  user?: string;
  uid?: string;
}
const parseDavPath = (path: string): DavPath => {
  const segs = String(path || '/').split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  if (segs.length === 0) return { kind: 'root' };
  const user = segs[0];
  if (segs.length === 1) return { kind: 'principal', user };
  if (segs[1] !== 'cal') return { kind: 'unknown', user };
  if (segs.length === 2) return { kind: 'home', user };
  if (segs[2] !== 'tasks') return { kind: 'unknown', user };
  if (segs.length === 3) return { kind: 'collection', user };
  if (segs.length === 4) return { kind: 'resource', user, uid: segs[3].replace(/\.ics$/i, '') };
  return { kind: 'unknown', user };
};

// --- hrefs (path-absolute, host-agnostic) ----------------------------------
const principalHref = (user: string) => `/dav/${encodeURIComponent(user)}/`;
const homeHref = (user: string) => `/dav/${encodeURIComponent(user)}/cal/`;
const collectionHref = (user: string) => `/dav/${encodeURIComponent(user)}/cal/tasks/`;
const resourceHref = (user: string, uid: string) =>
  `/dav/${encodeURIComponent(user)}/cal/tasks/${encodeURIComponent(uid)}.ics`;

// --- collection change tokens ----------------------------------------------
const djb2 = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
};
const collectionTag = (feed: ICalendarFeed): string => {
  const items = (feed.items || []) as CalendarFeedItem[];
  const basis = String((feed.updatedAt as Date)?.getTime?.() || 0) + items.map(itemEtag).join('');
  return djb2(basis);
};

// --- prop maps -------------------------------------------------------------
const displayNameFor = (feed: ICalendarFeed): string =>
  feed.davDisplayName || (feed.listId ? 'Noter – Uppgiftslista' : 'Noter – Alla uppgifter');

const principalPropMap = (user: string): Record<string, string> => ({
  resourcetype: '<d:resourcetype><d:principal/><d:collection/></d:resourcetype>',
  'current-user-principal': `<d:current-user-principal><d:href>${principalHref(user)}</d:href></d:current-user-principal>`,
  'principal-url': `<d:principal-URL><d:href>${principalHref(user)}</d:href></d:principal-URL>`,
  'calendar-home-set': `<c:calendar-home-set><d:href>${homeHref(user)}</d:href></c:calendar-home-set>`,
  'calendar-user-address-set': `<c:calendar-user-address-set><d:href>${principalHref(user)}</d:href></c:calendar-user-address-set>`,
  displayname: '<d:displayname>Noter</d:displayname>',
});

const homePropMap = (user: string): Record<string, string> => ({
  resourcetype: '<d:resourcetype><d:collection/></d:resourcetype>',
  'current-user-principal': `<d:current-user-principal><d:href>${principalHref(user)}</d:href></d:current-user-principal>`,
  'calendar-home-set': `<c:calendar-home-set><d:href>${homeHref(user)}</d:href></c:calendar-home-set>`,
  displayname: '<d:displayname>Noter</d:displayname>',
});

const SUPPORTED_REPORTS =
  '<d:supported-report-set>' +
  '<d:supported-report><d:report><c:calendar-query/></d:report></d:supported-report>' +
  '<d:supported-report><d:report><c:calendar-multiget/></d:report></d:supported-report>' +
  '<d:supported-report><d:report><d:sync-collection/></d:report></d:supported-report>' +
  '</d:supported-report-set>';

const PRIVILEGES =
  '<d:current-user-privilege-set>' +
  '<d:privilege><d:read/></d:privilege>' +
  '<d:privilege><d:write/></d:privilege>' +
  '<d:privilege><d:write-content/></d:privilege>' +
  '<d:privilege><d:bind/></d:privilege>' +
  '<d:privilege><d:unbind/></d:privilege>' +
  '</d:current-user-privilege-set>';

const collectionPropMap = (feed: ICalendarFeed, user: string): Record<string, string> => {
  const ctag = collectionTag(feed);
  return {
    resourcetype: '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>',
    displayname: `<d:displayname>${xmlEscape(displayNameFor(feed))}</d:displayname>`,
    'calendar-description': `<c:calendar-description>${xmlEscape(displayNameFor(feed))}</c:calendar-description>`,
    'supported-calendar-component-set': '<c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>',
    'getctag': `<cs:getctag>${ctag}</cs:getctag>`,
    'sync-token': `<d:sync-token>${ctag}</d:sync-token>`,
    'calendar-color': `<ical:calendar-color>${CAL_COLOR}</ical:calendar-color>`,
    'current-user-principal': `<d:current-user-principal><d:href>${principalHref(user)}</d:href></d:current-user-principal>`,
    'current-user-privilege-set': PRIVILEGES,
    'supported-report-set': SUPPORTED_REPORTS,
    'supported-calendar-data': '<c:supported-calendar-data><c:calendar-data content-type="text/calendar" version="2.0"/></c:supported-calendar-data>',
    'owner': `<d:owner><d:href>${principalHref(user)}</d:href></d:owner>`,
  };
};

const resourcePropMap = (item: CalendarFeedItem): Record<string, string> => {
  const body = generateVtodoResource(item);
  return {
    resourcetype: '<d:resourcetype/>',
    getetag: `<d:getetag>${itemEtag(item)}</d:getetag>`,
    getcontenttype: '<d:getcontenttype>text/calendar; charset=utf-8; component=vtodo</d:getcontenttype>',
    'calendar-data': `<c:calendar-data>${xmlEscape(body)}</c:calendar-data>`,
    getcontentlength: `<d:getcontentlength>${Buffer.byteLength(body, 'utf8')}</d:getcontentlength>`,
  };
};

/** Build a <d:response> selecting requested props (or all when requested=null). */
const buildResponse = (href: string, available: Record<string, string>, requested: Set<string> | null): string => {
  const found: string[] = [];
  const notFound: string[] = [];
  if (!requested) {
    for (const k of Object.keys(available)) found.push(available[k]);
  } else {
    for (const name of requested) {
      if (available[name]) found.push(available[name]);
      else notFound.push(`<d:${name}/>`);
    }
  }
  return responseXml({ href, found, notFound });
};

// --- helpers ---------------------------------------------------------------
const sendXml = (res: Response, status: number, body: string): void => {
  res.status(status);
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('DAV', DAV_HEADER);
  res.send(body);
};

const items = (feed: ICalendarFeed): CalendarFeedItem[] => (feed.items || []) as unknown as CalendarFeedItem[];
const findItem = (feed: ICalendarFeed, uid: string): CalendarFeedItem | undefined =>
  items(feed).find((i) => i.uid === uid);

const enqueueMutation = async (
  feed: ICalendarFeed,
  m: { uid: string; op: 'upsert' | 'delete'; data?: any },
): Promise<void> => {
  const mutation = {
    id: randomBytes(8).toString('hex'),
    uid: String(m.uid).slice(0, 200),
    op: m.op,
    listId: feed.listId ?? null,
    data: m.data,
    at: new Date(),
  };
  // Cap the queue so a misbehaving client can't grow it unbounded.
  await CalendarFeed.updateOne(
    { _id: feed._id },
    { $push: { pendingMutations: { $each: [mutation], $slice: -500 } } },
  );
};

// --- method handlers -------------------------------------------------------

const handlePropfind = (req: Request, res: Response, feed: ICalendarFeed, dp: DavPath): void => {
  const user = feed.davUser as string;
  const depth = String(req.headers['depth'] ?? '0');
  const requested = requestedProps(req.body || '');
  const responses: string[] = [];

  if (dp.kind === 'root' || dp.kind === 'principal') {
    responses.push(buildResponse(principalHref(user), principalPropMap(user), requested));
  } else if (dp.kind === 'home') {
    responses.push(buildResponse(homeHref(user), homePropMap(user), requested));
    if (depth !== '0') {
      responses.push(buildResponse(collectionHref(user), collectionPropMap(feed, user), requested));
    }
  } else if (dp.kind === 'collection') {
    responses.push(buildResponse(collectionHref(user), collectionPropMap(feed, user), requested));
    if (depth !== '0') {
      for (const it of items(feed)) {
        if (!it.uid) continue;
        responses.push(buildResponse(resourceHref(user, it.uid), resourcePropMap(it), requested));
      }
    }
  } else if (dp.kind === 'resource') {
    const it = findItem(feed, dp.uid || '');
    if (!it) { sendXml(res, 404, multistatus([])); return; }
    responses.push(buildResponse(resourceHref(user, it.uid), resourcePropMap(it), requested));
  } else {
    sendXml(res, 404, multistatus([]));
    return;
  }
  sendXml(res, 207, multistatus(responses));
};

const handleReport = (req: Request, res: Response, feed: ICalendarFeed, dp: DavPath): void => {
  if (dp.kind !== 'collection' && dp.kind !== 'home') { sendXml(res, 403, multistatus([])); return; }
  const user = feed.davUser as string;
  const body = req.body || '';
  const type = reportType(body);
  const requested = requestedProps(body);
  const responses: string[] = [];

  if (type === 'calendar-multiget') {
    const hrefs = hrefsFromBody(body);
    for (const href of hrefs) {
      const uid = decodeURIComponent((href.split('/').pop() || '').replace(/\.ics$/i, ''));
      const it = findItem(feed, uid);
      if (it) responses.push(buildResponse(resourceHref(user, it.uid), resourcePropMap(it), requested));
      else responses.push(`<d:response><d:href>${xmlEscape(href)}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`);
    }
  } else {
    // calendar-query / sync-collection / unknown → return all VTODOs. If the query
    // explicitly asks for VEVENT (and not VTODO) we have nothing to offer.
    const wantsEventOnly = /VEVENT/i.test(body) && !/VTODO/i.test(body);
    if (!wantsEventOnly) {
      for (const it of items(feed)) {
        if (!it.uid) continue;
        responses.push(buildResponse(resourceHref(user, it.uid), resourcePropMap(it), requested));
      }
    }
  }

  if (type === 'sync-collection') {
    // sync-collection wraps the member responses plus a trailing <d:sync-token>.
    const token = collectionTag(feed);
    const xml = multistatus(responses).replace(
      '</d:multistatus>',
      `<d:sync-token>${token}</d:sync-token></d:multistatus>`,
    );
    sendXml(res, 207, xml);
    return;
  }
  sendXml(res, 207, multistatus(responses));
};

const handleGet = (req: Request, res: Response, feed: ICalendarFeed, dp: DavPath, head: boolean): void => {
  if (dp.kind === 'resource') {
    const it = findItem(feed, dp.uid || '');
    if (!it) { res.status(404).end(); return; }
    const body = generateVtodoResource(it);
    res.status(200);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('ETag', itemEtag(it));
    res.setHeader('DAV', DAV_HEADER);
    if (head) { res.end(); return; }
    res.send(body);
    return;
  }
  if (dp.kind === 'collection') {
    const body = generateVtodoCalendar(items(feed), { calName: displayNameFor(feed) });
    res.status(200);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('DAV', DAV_HEADER);
    if (head) { res.end(); return; }
    res.send(body);
    return;
  }
  res.status(404).end();
};

const handlePut = async (req: Request, res: Response, feed: ICalendarFeed, dp: DavPath): Promise<void> => {
  if (dp.kind !== 'resource') { res.status(403).end(); return; }
  const parsed = parseVtodo(req.body || '');
  const uid = (parsed?.uid || dp.uid || '').trim();
  if (!uid) { res.status(400).end(); return; }
  const existing = findItem(feed, uid);
  await enqueueMutation(feed, {
    uid,
    op: 'upsert',
    data: {
      summary: parsed?.summary ?? undefined,
      description: parsed?.description ?? undefined,
      due: parsed?.due ?? undefined,
      priority: parsed?.priority || undefined,
      completed: parsed?.completed ?? undefined,
    },
  });
  // We optimistically echo a new etag; the client will reconcile on next push.
  const echoItem: CalendarFeedItem = {
    uid,
    title: parsed?.summary || existing?.title || 'Uppgift',
    start: parsed?.due || existing?.start || '',
    allDay: existing?.allDay ?? true,
    completed: parsed?.completed ?? existing?.completed ?? false,
    ...(parsed?.description ? { description: parsed.description } : {}),
    ...(parsed?.priority ? { priority: parsed.priority } : {}),
  };
  res.setHeader('ETag', itemEtag(echoItem));
  res.setHeader('DAV', DAV_HEADER);
  res.status(existing ? 204 : 201).end();
};

const handleDelete = async (req: Request, res: Response, feed: ICalendarFeed, dp: DavPath): Promise<void> => {
  if (dp.kind !== 'resource') { res.status(403).end(); return; }
  const uid = (dp.uid || '').trim();
  if (!uid) { res.status(400).end(); return; }
  await enqueueMutation(feed, { uid, op: 'delete' });
  res.status(204).end();
};

const handleProppatch = (req: Request, res: Response, dp: DavPath): void => {
  // Collections are read-only at the property level (display name/colour are set via
  // the mint API). Respond 207 marking attempted changes as forbidden so clients
  // (Apple Reminders sets calendar-color) don't treat it as a hard error.
  const requested = requestedProps(req.body || '') || new Set<string>();
  const props = [...requested].map((n) => `<d:${n}/>`).join('');
  const href = dp.user ? collectionHref(dp.user) : '/dav/';
  const xml = multistatus([
    `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop>` +
    `<d:status>HTTP/1.1 403 Forbidden</d:status></d:propstat></d:response>`,
  ]);
  sendXml(res, 207, xml);
};

// --- router ----------------------------------------------------------------
export const caldavRouter = express.Router();
// CalDAV bodies are XML / text/calendar — parse as raw text regardless of type.
caldavRouter.use(express.text({ type: () => true, limit: '1mb' }));

caldavRouter.use(async (req: Request, res: Response): Promise<void> => {
  const method = req.method.toUpperCase();

  // Operator kill-switch: when CalDAV is disabled the whole channel goes dark
  // (no discovery, no auth prompt) — existing feeds remain stored for instant re-enable.
  if (!isCaldavEnabled()) { res.status(404).end(); return; }

  // OPTIONS is unauthenticated discovery — advertise capabilities.
  if (method === 'OPTIONS') {
    res.setHeader('DAV', DAV_HEADER);
    res.setHeader('Allow', ALLOW);
    res.setHeader('Accept-Ranges', 'none');
    res.status(204).end();
    return;
  }

  if (isThrottled(req)) {
    res.setHeader('Retry-After', '900');
    res.status(429).end();
    return;
  }

  // Basic auth → resolve the feed for this credential.
  const creds = parseBasicAuth(req.headers['authorization']);
  const requireAuth = (): void => {
    res.setHeader('WWW-Authenticate', 'Basic realm="Noter CalDAV", charset="UTF-8"');
    res.setHeader('DAV', DAV_HEADER);
    res.status(401).end();
  };
  if (!creds || !creds.user || !creds.pass) { requireAuth(); return; }

  let feed: ICalendarFeed | null = null;
  try {
    feed = await CalendarFeed.findOne({ davUser: creds.user }).exec();
  } catch (err) {
    logger.warn('caldav: feed lookup failed', { error: (err as Error)?.message });
    res.status(503).end();
    return;
  }
  if (!feed || !feed.davTokenHash || !verifyDavPassword(creds.pass, feed.davTokenHash)) {
    noteAuthFail(req);
    requireAuth();
    return;
  }

  // Path scope check: the credential may only act on its own principal tree.
  const dp = parseDavPath(req.path);
  if (dp.user && dp.user !== feed.davUser) {
    res.status(403).end();
    return;
  }

  // Lazy last-seen (best-effort, throttled to once/min).
  const lastSeen = (feed.davLastSeenAt as Date | null)?.getTime?.() || 0;
  if (Date.now() - lastSeen > 60_000) {
    void CalendarFeed.updateOne({ _id: feed._id }, { $set: { davLastSeenAt: new Date() } }).catch(() => {});
  }

  try {
    switch (method) {
      case 'PROPFIND': handlePropfind(req, res, feed, dp); return;
      case 'REPORT': handleReport(req, res, feed, dp); return;
      case 'GET': handleGet(req, res, feed, dp, false); return;
      case 'HEAD': handleGet(req, res, feed, dp, true); return;
      case 'PUT': await handlePut(req, res, feed, dp); return;
      case 'DELETE': await handleDelete(req, res, feed, dp); return;
      case 'PROPPATCH': handleProppatch(req, res, dp); return;
      case 'MKCALENDAR':
      case 'MKCOL':
        res.setHeader('Allow', ALLOW);
        res.status(405).end();
        return;
      default:
        res.setHeader('Allow', ALLOW);
        res.status(405).end();
        return;
    }
  } catch (err) {
    logger.error('caldav: handler error', { method, path: req.path, error: (err as Error)?.message });
    res.status(500).end();
  }
});

/**
 * `/.well-known/caldav` bootstrap — clients hit the bare host here first. Redirect
 * to the DAV root so principal discovery proceeds. 301 keeps the credential prompt.
 */
export const wellKnownCaldavHandler = (_req: Request, res: Response): void => {
  if (!isCaldavEnabled()) { res.status(404).end(); return; }
  res.redirect(301, '/dav/');
};
