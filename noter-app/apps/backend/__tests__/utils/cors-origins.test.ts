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

  it('allows the Tauri desktop origins (migration target)', () => {
    delete process.env.CORS_ORIGINS;
    const origins = getAllowedOrigins();
    expect(origins).toContain('tauri://localhost');
    expect(origins).toContain('http://tauri.localhost');
  });

  it('SECURITY: does NOT trust dev-localhost origins in production', () => {
    // security.ts reads NODE_ENV at MODULE LOAD, so re-import under a production env.
    const prevEnv = process.env.NODE_ENV;
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGINS;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const prodMod = require('../../src/utils/security');
    const origins: string[] = prodMod.getAllowedOrigins();
    expect(origins).not.toContain('http://localhost:3000');
    expect(origins).not.toContain('http://127.0.0.1:3000');
    // first-party origins still allowed
    expect(origins).toContain('https://daylited.com');
    expect(origins).toContain('app://noter');
    process.env.NODE_ENV = prevEnv;
    jest.resetModules();
  });
});
