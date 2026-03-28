import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // If the app is hosted at daylited.com/app, we need basePath set to /app
  // But locally we might want it at root.
  // We can use an env var, but for this specific fix requested by user, we can hardcode or default it.
  // The user says "https://daylited.com/app/_next/...", so basePath must be /app.
  basePath: '/app',
  assetPrefix: '/app',
  outputFileTracingRoot: path.join(process.cwd(), '..', '..'),
  // Trailing slash is often needed for subpath deployments to handle redirects correctly
  trailingSlash: true,
  
  env: {
    NEXT_PUBLIC_BUILD_TIMESTAMP: new Date().toISOString(),
    NEXT_PUBLIC_BUILD_ID: process.env.BUILD_ID || 'development-' + Math.floor(Math.random() * 10000),
  },

  serverExternalPackages: ['node-llama-cpp'],

  // Increase max body size and response timeout for large AI model downloads
  experimental: {
    serverActions: {
      bodySizeLimit: '10gb',
    },
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
};

export default nextConfig;
