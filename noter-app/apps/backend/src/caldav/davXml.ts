/**
 * Minimal WebDAV / CalDAV XML helpers. We hand-build multistatus (207) bodies rather
 * than pull a heavy server framework, because our model is narrow: a fixed principal →
 * one calendar-home → one read-rendered VTODO collection, served from the client-pushed
 * projection. Namespaces follow RFC 4791 (CalDAV) + calendarserver.org extensions
 * (getctag / sync-token) that Tasks.org and Apple Reminders rely on.
 */

export const XML_DECL = '<?xml version="1.0" encoding="utf-8"?>';

export const NS =
  'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" ' +
  'xmlns:cs="http://calendarserver.org/ns/" xmlns:ical="http://apple.com/ns/ical/"';

export const xmlEscape = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A single `<d:response>` for an href: `found` are ready prop XML strings; `notFound` are tag names. */
export interface PropResponse {
  href: string;
  found: string[];      // e.g. ['<d:displayname>Tasks</d:displayname>']
  notFound?: string[];  // e.g. ['<c:calendar-color/>']
}

const propstat = (props: string[], status: string): string =>
  props.length
    ? `<d:propstat><d:prop>${props.join('')}</d:prop><d:status>HTTP/1.1 ${status}</d:status></d:propstat>`
    : '';

export const responseXml = (r: PropResponse): string =>
  `<d:response><d:href>${xmlEscape(r.href)}</d:href>` +
  propstat(r.found, '200 OK') +
  propstat(r.notFound || [], '404 Not Found') +
  `</d:response>`;

export const multistatus = (responses: string[]): string =>
  `${XML_DECL}\n<d:multistatus ${NS}>${responses.join('')}</d:multistatus>`;

/**
 * Extract the set of requested property local-names from a PROPFIND/REPORT body.
 * Returns null when the body asks for <d:allprop> (or is empty), meaning "give the
 * standard set". Robust to namespace prefixes (we key on local-name only).
 */
export const requestedProps = (body: string): Set<string> | null => {
  const xml = String(body || '');
  if (!xml.trim()) return null;
  if (/<[^>]*\ballprop\b/i.test(xml)) return null;
  const propBlock = /<[^>]*\bprop\b[^>]*>([\s\S]*?)<\/[^>]*\bprop\b[^>]*>/i.exec(xml);
  const scope = propBlock ? propBlock[1] : xml;
  const names = new Set<string>();
  const re = /<(?:[a-zA-Z0-9]+:)?([a-zA-Z0-9-]+)\b[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope))) {
    const name = m[1].toLowerCase();
    if (name === 'prop') continue;
    names.add(name);
  }
  return names.size ? names : null;
};

/** Pull href values out of a calendar-multiget REPORT body. */
export const hrefsFromBody = (body: string): string[] => {
  const out: string[] = [];
  const re = /<(?:[a-zA-Z0-9]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?href>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(body || '')))) {
    const v = m[1].trim();
    if (v) out.push(v);
  }
  return out;
};

/** Detect the REPORT type from the root element. */
export const reportType = (body: string): 'calendar-query' | 'calendar-multiget' | 'sync-collection' | 'unknown' => {
  const xml = String(body || '');
  if (/<[^>]*\bcalendar-multiget\b/i.test(xml)) return 'calendar-multiget';
  if (/<[^>]*\bcalendar-query\b/i.test(xml)) return 'calendar-query';
  if (/<[^>]*\bsync-collection\b/i.test(xml)) return 'sync-collection';
  return 'unknown';
};
