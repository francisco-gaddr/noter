import path from 'path';

const rawBasePath = String(process.env.WEB_BASE_PATH || process.env.NEXT_PUBLIC_WEB_BASE_PATH || '').trim();
const basePath = rawBasePath ? `/${rawBasePath.replace(/^\/+|\/+$/g, '')}` : '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  assetPrefix: basePath || undefined,
  outputFileTracingRoot: path.join(process.cwd(), '..', '..'),
  trailingSlash: true,
  
  env: {
    NEXT_PUBLIC_BUILD_TIMESTAMP: new Date().toISOString(),
    NEXT_PUBLIC_BUILD_ID: process.env.BUILD_ID || 'development-' + Math.floor(Math.random() * 10000),
  },

  serverExternalPackages: ['node-llama-cpp'],

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
