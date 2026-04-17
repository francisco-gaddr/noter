import { createOpaqueToken, createTokenFamilyId, durationToMs, getRequestFingerprint, hashToken } from '../src/utils/authSessions';

describe('auth session helpers', () => {
  it('hashes tokens deterministically', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('def'));
  });

  it('creates opaque refresh tokens and family ids', () => {
    expect(createOpaqueToken()).toHaveLength(96);
    expect(createTokenFamilyId()).toHaveLength(32);
  });

  it('parses duration strings into milliseconds', () => {
    expect(durationToMs('15m')).toBe(15 * 60 * 1000);
    expect(durationToMs('30d')).toBe(30 * 24 * 60 * 60 * 1000);
    expect(durationToMs(90)).toBe(90 * 1000);
  });

  it('builds request fingerprints from user-agent and forwarded ip', () => {
    const fingerprint = getRequestFingerprint({
      headers: {
        'user-agent': 'unit-test',
        'x-forwarded-for': '203.0.113.10, 10.0.0.1',
      },
      ip: '10.0.0.5',
    } as any);
    expect(fingerprint.userAgentHash).toBe(hashToken('unit-test'));
    expect(fingerprint.ipHash).toBe(hashToken('203.0.113.10'));
  });
});
