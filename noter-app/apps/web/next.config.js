/** @type {import('next').NextConfig} */

// The same web app ships two ways:
//  - SSR on the Raspberry Pi (dynamic API routes, security headers) — default.
//  - A static export bundled into the Electron desktop app — when ELECTRON_EXPORT=1.
// Next 16 removed `next export`; a static export is produced by `output: 'export'`
// during `next build`. Static export can't serve the dynamic /api routes or set
// HTTP headers, so we drop those only in export mode (the desktop app uses the
// native mlc bridge + the remote backend, not the Next API routes).
const isElectronExport = process.env.ELECTRON_EXPORT === '1';

const nextConfig = {
  // Hosted at daylited.com/app, and the Electron custom protocol serves /app too.
  basePath: '/app',
  assetPrefix: '/app',
  // Trailing slash is needed for subpath + static-export directory routing.
  trailingSlash: true,

  ...(isElectronExport
    ? {
        output: 'export',
        // No Next image optimizer in a static export.
        images: { unoptimized: true },
      }
    : {}),

  env: {
    NEXT_PUBLIC_BUILD_TIMESTAMP: new Date().toISOString(),
    NEXT_PUBLIC_BUILD_ID: process.env.BUILD_ID || 'development-' + Math.floor(Math.random() * 10000),
  },

  serverExternalPackages: ['node-llama-cpp'],

  // React Compiler (React 19, GA): auto-memoizes components app-wide, so a streaming AI
  // chat re-renders only the changing message instead of the whole (non-virtualized) thread,
  // and the note/task lists re-render far less. The compiler conservatively BAILS OUT of any
  // component it can't safely optimize, so it's a low-risk, build-time-only optimization.
  // Applies to BOTH the SSR build and the Electron static export. (serverActions are kept
  // inside this block but only for the server build — a static export can't serve them.)
  experimental: {
    reactCompiler: true,
    ...(isElectronExport ? {} : { serverActions: { bodySizeLimit: '10gb' } }),
  },

  // Custom headers + redirects require a server — omit them from the static export so
  // `next build` doesn't reject `output: 'export'`.
  ...(isElectronExport
    ? {}
    : {
        // CalDAV/CardDAV auto-discovery (RFC 6764). The public edge routes everything
        // outside /api to this web app, so the well-known bootstrap that Apple
        // Reminders/Calendar require lands here. Redirect it (301) to the CalDAV
        // context path, which is served by the backend under /api/dav. Without this,
        // macOS/iOS abort account setup before ever trying the explicit server URL
        // (Android/DAVx5 skips well-known and works regardless). basePath:false so it
        // matches the bare host path, not /app/.well-known.
        async redirects() {
          return [
            { source: '/.well-known/caldav', destination: '/api/dav/', basePath: false, statusCode: 301 },
            { source: '/.well-known/carddav', destination: '/api/dav/', basePath: false, statusCode: 301 },
          ];
        },
        async headers() {
          const csp = [
            "default-src 'self' https: data: 'unsafe-inline' 'unsafe-eval'",
            "connect-src 'self' https: http: wss: ws:",
            "img-src 'self' https: data: blob:",
            "style-src 'self' 'unsafe-inline' https:",
            "font-src 'self' https: data:",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "frame-ancestors 'self'",
          ].join('; ');

          return [
            {
              source: '/:path*',
              headers: [
                { key: 'Content-Security-Policy', value: csp },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
