import { signPayload, verifyWebhookSignature } from '../../src/utils/webhookSign';

describe('signPayload', () => {
  it('produces a header with t= and v1= components', () => {
    const sig = signPayload('secret', '{"hello":"world"}', { timestamp: 1700000000 });
    expect(sig).toMatch(/^t=1700000000,v1=[a-f0-9]+$/);
  });

  it('rejects missing secret', () => {
    expect(() => signPayload('', 'body')).toThrow(/secret required/);
  });

  it('rejects non-string body', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => signPayload('s', { object: true } as any)).toThrow(/string/);
  });

  it('different bodies → different signatures', () => {
    const s1 = signPayload('s', '{"a":1}', { timestamp: 1 });
    const s2 = signPayload('s', '{"a":2}', { timestamp: 1 });
    expect(s1).not.toBe(s2);
  });
});

describe('verifyWebhookSignature', () => {
  const SECRET = 'super-secret';
  const BODY = '{"event":"note.created","id":"n1"}';

  it('accepts a freshly-signed payload', () => {
    const sig = signPayload(SECRET, BODY);
    expect(verifyWebhookSignature(SECRET, BODY, sig).ok).toBe(true);
  });

  it('rejects when signature is missing', () => {
    const r = verifyWebhookSignature(SECRET, BODY, undefined);
    expect(r).toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects malformed header', () => {
    const r = verifyWebhookSignature(SECRET, BODY, 'not-a-header');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('malformed');
  });

  it('rejects stale timestamps (replay attack)', () => {
    const ts = 1700000000;
    const sig = signPayload(SECRET, BODY, { timestamp: ts });
    // Pretend "now" is 10 minutes ahead of the signed time → outside tolerance
    const r = verifyWebhookSignature(SECRET, BODY, sig, { now: () => ts + 600 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('stale');
  });

  it('rejects future timestamps outside tolerance (clock-skew attack)', () => {
    const sig = signPayload(SECRET, BODY, { timestamp: 2000000000 });
    const r = verifyWebhookSignature(SECRET, BODY, sig, { now: () => 1000000000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('stale');
  });

  it('rejects when body has been tampered with', () => {
    const sig = signPayload(SECRET, BODY);
    const r = verifyWebhookSignature(SECRET, '{"event":"tampered"}', sig);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid-signature');
  });

  it('rejects when signed with a different secret', () => {
    const sig = signPayload('other-secret', BODY);
    const r = verifyWebhookSignature(SECRET, BODY, sig);
    expect(r.ok).toBe(false);
  });

  it('accepts array-form header (first entry only)', () => {
    const sig = signPayload(SECRET, BODY);
    expect(verifyWebhookSignature(SECRET, BODY, [sig, 'other']).ok).toBe(true);
  });

  it('returns the verified timestamp on success', () => {
    const ts = 1700000123;
    const sig = signPayload(SECRET, BODY, { timestamp: ts });
    // Override `now` so the verification is within tolerance even though
    // ts is from 2023 and wall-clock is later.
    const r = verifyWebhookSignature(SECRET, BODY, sig, { now: () => ts + 10 });
    if (r.ok) expect(r.timestamp).toBe(ts);
    else throw new Error(`expected ok, got: ${r.reason}`);
  });
});
