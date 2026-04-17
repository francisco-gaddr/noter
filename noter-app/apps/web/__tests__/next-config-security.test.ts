describe('web next config security headers', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const env = process.env as Record<string, string | undefined>;

  afterEach(() => {
    env.NODE_ENV = originalNodeEnv;
    jest.resetModules();
  });

  it('publishes strict security headers in production', async () => {
    env.NODE_ENV = 'production';
    const { default: nextConfig } = await import('../next.config.js');
    const headers = await nextConfig.headers();
    const rootHeaders = headers.find((entry: { source: string }) => entry.source === '/:path*')?.headers ?? [];
    const byKey = Object.fromEntries(rootHeaders.map((entry: { key: string; value: string }) => [entry.key, entry.value]));

    expect(byKey['Content-Security-Policy']).toContain("default-src 'self'");
    expect(byKey['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(byKey['Content-Security-Policy']).not.toContain('http:');
    expect(byKey['Content-Security-Policy']).not.toContain("'unsafe-eval'");
    expect(byKey['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains; preload');
    expect(byKey['Permissions-Policy']).toContain('camera=()');
    expect(byKey['Cross-Origin-Opener-Policy']).toBe('same-origin');
  });

  it('allows development websocket/http connect sources locally', async () => {
    env.NODE_ENV = 'development';
    const { default: nextConfig } = await import('../next.config.js');
    const headers = await nextConfig.headers();
    const rootHeaders = headers.find((entry: { source: string }) => entry.source === '/:path*')?.headers ?? [];
    const byKey = Object.fromEntries(rootHeaders.map((entry: { key: string; value: string }) => [entry.key, entry.value]));

    expect(byKey['Content-Security-Policy']).toContain('http:');
    expect(byKey['Content-Security-Policy']).toContain('ws:');
    expect(byKey['Content-Security-Policy']).toContain("'unsafe-eval'");
    expect(byKey['Strict-Transport-Security']).toBeUndefined();
  });
});
