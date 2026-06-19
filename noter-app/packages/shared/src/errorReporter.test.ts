import { parseDsn, scrubValue, parseStackFrames, createErrorReporter, type SentryEvent } from './errorReporter';

const DSN = 'https://abc123def@glitchtip.noter.local/7';

describe('parseDsn', () => {
  it('parses a standard DSN into the envelope ingest URL', () => {
    const p = parseDsn(DSN);
    expect(p).not.toBeNull();
    expect(p!.publicKey).toBe('abc123def');
    expect(p!.envelopeUrl).toBe('https://glitchtip.noter.local/api/7/envelope/?sentry_key=abc123def&sentry_version=7');
  });
  it('handles a DSN with a path prefix and a secret half', () => {
    const p = parseDsn('https://pub:secret@host.example/path/9');
    expect(p!.envelopeUrl).toBe('https://host.example/path/api/9/envelope/?sentry_key=pub&sentry_version=7');
  });
  it('returns null for empty/garbage/non-numeric-project DSNs', () => {
    expect(parseDsn('')).toBeNull();
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn('not a dsn')).toBeNull();
    expect(parseDsn('https://pub@host/notanumber')).toBeNull();
  });
});

describe('scrubValue', () => {
  it('redacts sensitive keys but keeps benign ones', () => {
    const out = scrubValue({ route: '/api/x', password: 'hunter2', authToken: 'jwt...', note_content: 'secret diary', count: 3 }) as any;
    expect(out.route).toBe('/api/x');
    expect(out.count).toBe(3);
    expect(out.password).toBe('[redacted]');
    expect(out.authToken).toBe('[redacted]'); // contains 'auth' and 'token'
    expect(out.note_content).toBe('[redacted]'); // contains 'content'
  });
  it('truncates very long strings and caps array length', () => {
    expect((scrubValue('x'.repeat(5000)) as string).endsWith('…[truncated]')).toBe(true);
    expect((scrubValue(new Array(200).fill(1)) as unknown[]).length).toBe(50);
  });
});

describe('parseStackFrames', () => {
  it('parses V8 frames oldest-first and flags in_app vs node_modules', () => {
    const stack = [
      'Error: boom',
      '    at handler (/srv/app/routes/notes.ts:12:5)',
      '    at /srv/app/node_modules/express/lib/router.js:99:1',
    ].join('\n');
    const frames = parseStackFrames(stack);
    expect(frames.length).toBe(2);
    // reversed → the express (node_modules) frame is first, the app handler last (the crash point)
    expect(frames[0].in_app).toBe(false);
    expect(frames[1].filename).toBe('/srv/app/routes/notes.ts');
    expect(frames[1].lineno).toBe(12);
    expect(frames[1].in_app).toBe(true);
  });
  it('never throws on empty/odd input', () => {
    expect(parseStackFrames(undefined)).toEqual([]);
    expect(parseStackFrames('no frames here')).toEqual([]);
  });
});

describe('createErrorReporter', () => {
  it('is a no-op when the DSN is missing/invalid', async () => {
    const r = createErrorReporter({ dsn: '' });
    expect(r.enabled).toBe(false);
    expect(await r.captureException(new Error('x'))).toBeNull();
  });

  it('POSTs a well-formed Sentry envelope and scrubs context', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (url: string, init: any) => {
      calls.push({ url: String(url), body: String(init.body) });
      return { ok: true, status: 200, headers: { get: () => null } };
    }) as unknown as typeof fetch;

    const r = createErrorReporter({ dsn: DSN, environment: 'production', release: 'abc', platform: 'node', fetchImpl });
    expect(r.enabled).toBe(true);
    const id = await r.captureException(new Error('kaboom'), { requestId: 'req-1', userId: 'u1', extra: { password: 'leak', route: '/api/x' } });

    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/7/envelope/?sentry_key=abc123def');

    // Envelope = header line + item header line + event line.
    const [header, itemHeader, eventLine] = calls[0].body.split('\n');
    expect(JSON.parse(header).dsn).toBe(DSN);
    expect(JSON.parse(itemHeader)).toEqual({ type: 'event' });
    const event: SentryEvent = JSON.parse(eventLine);
    expect(event.environment).toBe('production');
    expect(event.exception!.values[0].type).toBe('Error');
    expect(event.exception!.values[0].value).toBe('kaboom');
    expect(event.tags!.request_id).toBe('req-1');
    expect(event.user!.id).toBe('u1');
    expect((event.extra as any).password).toBe('[redacted]'); // PII never leaves
    expect((event.extra as any).route).toBe('/api/x');
  });

  it('honours beforeSend returning null (drops the event)', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, headers: { get: () => null } })) as unknown as typeof fetch;
    const r = createErrorReporter({ dsn: DSN, fetchImpl, beforeSend: () => null });
    expect(await r.captureMessage('hi')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never throws when the network fails', async () => {
    const fetchImpl = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    const r = createErrorReporter({ dsn: DSN, fetchImpl });
    await expect(r.captureException(new Error('x'))).resolves.toBeNull();
  });
});
