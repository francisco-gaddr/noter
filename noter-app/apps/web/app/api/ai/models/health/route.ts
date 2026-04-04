import { NextRequest } from 'next/server';

const resolveApiBaseUrl = (req: NextRequest) => {
  const explicit = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }
  const origin = new URL(req.url).origin;
  return `${origin.replace(/\/$/, '')}/api`;
};

export async function GET(req: NextRequest) {
  try {
    const apiBaseUrl = resolveApiBaseUrl(req);
    const response = await fetch(`${apiBaseUrl}/ai/models/health`, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
    });

    const bodyText = await response.text();
    return new Response(bodyText, {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || 'Health proxy failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
