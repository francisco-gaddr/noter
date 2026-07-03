import request from 'supertest';
import express from 'express';

/**
 * Regression guard for the validate-critical backend flake (auth/status assertions
 * failing only under full-suite load). Root cause: supertest's `request(app)` builds a
 * NEW ephemeral http.Server per request; at scale these recycle ephemeral ports and
 * cross-wire responses (a request lands on the wrong app) or hang up. jest.setup.js
 * fixes it by handing supertest ONE cached, already-listening server per app.
 *
 * This test fails loudly if that patch is ever removed/broken — without it the flake
 * silently returns. It asserts that many requests to the same app all hit the SAME
 * server port (i.e. no per-request server churn) and never cross-wire to another app.
 */
describe('test harness: supertest server reuse (flake guard)', () => {
  it('reuses one persistent server per app instead of a new one per request', async () => {
    const app = express();
    app.get('/port', (_req, res) => res.status(200).json({ port: (res.socket?.localPort) ?? 0 }));

    const ports = new Set<number>();
    for (let i = 0; i < 25; i += 1) {
      const res = await request(app).get('/port');
      expect(res.status).toBe(200);
      ports.add(res.body.port);
    }
    // A fresh ephemeral server per request would yield ~25 distinct ports. The patch
    // keeps exactly one server alive, so every request shares a single local port.
    // (This single, sequential assertion is the whole guard: it deterministically proves
    // there is no per-request server churn — the precise condition that lets ephemeral
    // ports recycle and cross-wire responses under load.)
    expect(ports.size).toBe(1);
  });

  it('keeps distinct apps on distinct servers (no shared/cross-wired listener)', async () => {
    const appA = express();
    appA.get('/x', (_req, res) => res.status(200).json({ who: 'A' }));
    const appB = express();
    appB.get('/x', (_req, res) => res.status(200).json({ who: 'B' }));

    const a = await request(appA).get('/x');
    const b = await request(appB).get('/x');
    expect(a.body.who).toBe('A');
    expect(b.body.who).toBe('B');
    // Each app must own its own persistent server (different ports) — never the same
    // listener, which would route one app's requests to the other.
    expect(a.body.who).not.toBe(b.body.who);
  });
});
