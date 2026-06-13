import { applyUsage, emptyRecord, usageKey, PROVIDER_LIMITS } from '../services/ai/usageTracker';

describe('usageTracker.applyUsage (pure reducer)', () => {
  it('counts the first call and its tokens', () => {
    const r = applyUsage(undefined, 120, '2026-06-13', '2026-06');
    expect(r).toEqual({
      day: '2026-06-13',
      month: '2026-06',
      callsDay: 1,
      tokensDay: 120,
      callsMonth: 1,
      tokensMonth: 120,
    });
  });

  it('accumulates within the same day', () => {
    let r = applyUsage(undefined, 100, '2026-06-13', '2026-06');
    r = applyUsage(r, 50, '2026-06-13', '2026-06');
    expect(r.callsDay).toBe(2);
    expect(r.tokensDay).toBe(150);
    expect(r.callsMonth).toBe(2);
  });

  it('resets the day bucket but keeps the month bucket when the day rolls over', () => {
    const prev = { day: '2026-06-13', month: '2026-06', callsDay: 5, tokensDay: 500, callsMonth: 5, tokensMonth: 500 };
    const r = applyUsage(prev, 30, '2026-06-14', '2026-06');
    expect(r.callsDay).toBe(1);
    expect(r.tokensDay).toBe(30);
    expect(r.callsMonth).toBe(6); // month continues
    expect(r.tokensMonth).toBe(530);
  });

  it('resets both buckets when the month rolls over', () => {
    const prev = { day: '2026-06-30', month: '2026-06', callsDay: 5, tokensDay: 500, callsMonth: 40, tokensMonth: 4000 };
    const r = applyUsage(prev, 10, '2026-07-01', '2026-07');
    expect(r.callsDay).toBe(1);
    expect(r.callsMonth).toBe(1);
    expect(r.tokensMonth).toBe(10);
  });

  it('treats missing/negative token counts as zero', () => {
    const r = applyUsage(undefined, NaN as unknown as number, '2026-06-13', '2026-06');
    expect(r.tokensDay).toBe(0);
    expect(r.callsDay).toBe(1); // still counts the call
    const r2 = applyUsage(r, -5, '2026-06-13', '2026-06');
    expect(r2.tokensDay).toBe(0);
    expect(r2.callsDay).toBe(2);
  });
});

describe('usageTracker helpers', () => {
  it('keys by provider + model', () => {
    expect(usageKey('groq', 'llama-3.3-70b-versatile')).toBe('groq::llama-3.3-70b-versatile');
  });

  it('exposes a limit for every provider', () => {
    expect(PROVIDER_LIMITS.groq.callsPerDay).toBeGreaterThan(0);
    expect(PROVIDER_LIMITS.gemini.callsPerDay).toBeGreaterThan(0);
    expect(PROVIDER_LIMITS.openrouter).toBeDefined();
  });

  it('emptyRecord starts at zero', () => {
    expect(emptyRecord('2026-06-13', '2026-06').callsDay).toBe(0);
  });
});
