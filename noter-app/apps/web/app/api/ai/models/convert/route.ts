import { NextRequest } from 'next/server';

const resolveApiBaseUrl = (req: NextRequest) => {
  const explicit = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL;
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }
  const origin = new URL(req.url).origin;
  return `${origin.replace(/\/$/, '')}/api`;
};

const proxyJson = async (req: NextRequest, targetUrl: string, init?: RequestInit) => {
  const response = await fetch(targetUrl, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
  });
  const bodyText = await response.text();
  return new Response(bodyText, {
    status: response.status,
    headers: { 'Content-Type': 'application/json' },
  });
};

export async function POST(req: NextRequest) {
  try {
    const apiBaseUrl = resolveApiBaseUrl(req);
    const body = await req.text();
    return proxyJson(req, `${apiBaseUrl}/ai/models/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || 'Convert proxy failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function GET(req: NextRequest) {
  try {
    const apiBaseUrl = resolveApiBaseUrl(req);
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');
    const targetUrl = `${apiBaseUrl}/ai/models/convert${jobId ? `?jobId=${encodeURIComponent(jobId)}` : ''}`;
    return proxyJson(req, targetUrl);
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || 'Convert proxy failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
