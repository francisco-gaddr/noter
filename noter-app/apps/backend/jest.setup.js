// Test-process HTTP hygiene — runs once per test file (jest `setupFiles`).
//
// ROOT CAUSE of the intermittent validate-critical backend flake (auth/status
// assertions failing only under full-suite load, passing in isolation):
//
// supertest's `request(app)` builds a BRAND-NEW ephemeral `http.Server` for EVERY
// request (see supertest/lib/test.js: `http.createServer(app)` in the Test ctor),
// listens it on an OS-assigned port, and closes it afterwards. When many of these
// short-lived servers are created and torn down in one process, an ephemeral port
// gets recycled to a *different* server while a socket still targets the old one, so
// a request lands on the WRONG app — surfacing as cross-wired status codes (e.g. a
// 401 from a route that has no 401 path, a 404 where a 207 was expected) or a torn
// connection ("socket hang up"). It only shows up under load and was *worst* with
// `--runInBand` (every suite's servers funnel through one process). Reproduced in
// isolation at ~2-6 wrong responses per 8000 requests; a persistent server per app
// gives 0/8000.
//
// FIX: intercept `http.createServer` for express apps and hand back ONE cached,
// already-listening server per app. supertest then sees a listening server, so it
// neither re-listens nor closes it between requests — every request hits exactly the
// server it expects. Non-express `http.createServer(...)` calls pass through
// untouched. Servers are `unref()`d (and the suites run with `--forceExit`) so they
// never keep a worker alive.
// mongodb-memory-server startup headroom. The 10s default flakes under full-suite load / slow disk
// (the critical matrix runs ~25 backend suites, each spawning its own mongod) as
// "Instance failed to start within 10000ms" — a pure infra timeout that fails validate-critical
// (and blocks pushes) even though every suite passes in isolation. 60s removes the flake without
// changing any test behaviour.
process.env.MONGOMS_STARTUP_TIMEOUT = process.env.MONGOMS_STARTUP_TIMEOUT || '60000';

const http = require('http');

if (!http.createServer.__noterPersistentPatch) {
  const real = http.createServer.bind(http);
  const cache = new WeakMap();

  // An express app is a function that also exposes `.handle` and `.use`. Anything
  // else passed to createServer (plain request listeners, etc.) is left alone.
  const isExpressApp = (fn) =>
    typeof fn === 'function' && typeof fn.handle === 'function' && typeof fn.use === 'function';

  const patched = function createServer(listener, ...rest) {
    if (isExpressApp(listener)) {
      let server = cache.get(listener);
      if (!server) {
        server = real(listener);
        server.listen(0); // port is assigned synchronously, so app.address() is valid right away
        server.unref();
        cache.set(listener, server);
      }
      return server;
    }
    return real(listener, ...rest);
  };
  patched.__noterPersistentPatch = true;
  http.createServer = patched;
}
