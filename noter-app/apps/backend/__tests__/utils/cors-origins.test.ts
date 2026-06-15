import { getAllowedOrigins } from '../../src/utils/security';

describe('getAllowedOrigins (CORS allowlist)', () => {
  const prev = process.env.CORS_ORIGINS;
  afterEach(() => {
    if (prev === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = prev;
  });

  it('always allows the public web origin', () => {
    delete process.env.CORS_ORIGINS;
    expect(getAllowedOrigins()).toContain('https://daylited.com');
  });

  it('always allows the Electron desktop renderer origin (app://noter)', () => {
    // Regression guard: the desktop app fetches the API from the custom app://
    // scheme. Dropping this makes the desktop app fail every request with
    // "Failed to fetch" on login. Keep it in the allowlist.
    delete process.env.CORS_ORIGINS;
    expect(getAllowedOrigins()).toContain('app://noter');
  });

  it('merges CORS_ORIGINS env entries with the defaults', () => {
    process.env.CORS_ORIGINS = 'https://extra.example.com, https://two.example.com';
    const origins = getAllowedOrigins();
    expect(origins).toContain('https://extra.example.com');
    expect(origins).toContain('https://two.example.com');
    expect(origins).toContain('https://daylited.com'); // defaults still present
    expect(origins).toContain('app://noter');
  });

  it('has no duplicate entries', () => {
    process.env.CORS_ORIGINS = 'https://daylited.com'; // duplicates a default
    const origins = getAllowedOrigins();
    expect(new Set(origins).size).toBe(origins.length);
  });
});
