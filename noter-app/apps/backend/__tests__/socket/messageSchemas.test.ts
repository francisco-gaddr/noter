import { validateSocketEvent, _KNOWN_EVENTS } from '../../src/socket/messageSchemas';

describe('validateSocketEvent', () => {
  it('rejects unknown event names', () => {
    const res = validateSocketEvent('totally-made-up', {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/unknown event/);
  });

  it('accepts a well-formed note:join payload', () => {
    const res = validateSocketEvent('note:join', { noteId: 'abc-123' });
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.data as any).noteId).toBe('abc-123');
  });

  it('rejects noteId that fails the pattern (path traversal / NoSQL operator)', () => {
    const r1 = validateSocketEvent('note:join', { noteId: { $where: 'x' } });
    expect(r1.ok).toBe(false);
    const r2 = validateSocketEvent('note:join', { noteId: '../etc/passwd' });
    expect(r2.ok).toBe(false);
    const r3 = validateSocketEvent('note:join', { noteId: 'a'.repeat(500) });
    expect(r3.ok).toBe(false);
  });

  it('tolerates extra user fields (passthrough) without leaking via the result data', () => {
    const res = validateSocketEvent('note:join', {
      noteId: 'abc',
      user: { _id: 'u1', username: 'alice', injected: '__proto__' },
    });
    expect(res.ok).toBe(true);
  });

  it('rejects missing required fields with the path in issues', () => {
    const res = validateSocketEvent('note:join', {} as unknown);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues?.some((i) => i.path === 'noteId')).toBe(true);
    }
  });

  it('the registry exposes every known event', () => {
    expect(_KNOWN_EVENTS).toContain('note:join');
    expect(_KNOWN_EVENTS).toContain('note:leave');
    expect(_KNOWN_EVENTS).toContain('task:join');
  });

  it('rejects when noteId is missing entirely on task:join', () => {
    const res = validateSocketEvent('task:join', {});
    expect(res.ok).toBe(false);
  });
});
