import path from 'path';

const rawBasePath = String(process.env.WEB_BASE_PATH || process.env.NEXT_PUBLIC_WEB_BASE_PATH || '').trim();
const basePath = rawBasePath ? `/${rawBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const isProduction = process.env.NODE_ENV === 'production';
const isElectronStandalone = process.env.ELECTRON_STANDALONE === '1';

const csp = [
  "default-src 'self'",
  [
    "connect-src 'self'",
    'https:',
    'wss:',
    ...(isProduction ? [] : ['http:', 'ws:']),
  ].join(' '),
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline' https:",
  [
    "script-src 'self'",
    "'unsafe-inline'",
    ...(isProduction ? [] : ["'unsafe-eval'"]),
  ].join(' '),
  "font-src 'self' data: https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  ...(isProduction
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  assetPrefix: basePath || undefined,
  ...(isElectronStandalone ? { output: 'standalone' } : {}),
  outputFileTracingRoot: path.join(process.cwd(), '..', '..'),
  trailingSlash: true,
  
  env: {
    NEXT_PUBLIC_BUILD_TIMESTAMP: new Date().toISOString(),
    NEXT_PUBLIC_BUILD_ID: process.env.BUILD_ID || 'development-' + Math.floor(Math.random() * 10000),
  },

  serverExternalPackages: ['node-llama-cpp'],
  transpilePackages: ['@repo/ai', '@repo/shared'],

  experimental: {
    serverActions: {
      bodySizeLimit: '10gb',
    },
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
