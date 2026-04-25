import { NextRequest } from 'next/server';
import { authenticateAiRequest, buildBackendProxyHeaders, resolveBackendApiBaseUrl } from '../../_lib/security';

const proxyJson = async (req: NextRequest, targetUrl: string, init?: RequestInit) => {
  const response = await fetch(targetUrl, {
    cache: 'no-store',
    ...init,
    headers: {
      ...buildBackendProxyHeaders(req),
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
    authenticateAiRequest(req);
    const apiBaseUrl = resolveBackendApiBaseUrl(req);
    const body = await req.text();
    return proxyJson(req, `${apiBaseUrl}/ai/models/convert`, {
      method: 'POST',
      headers: { ...buildBackendProxyHeaders(req), 'Content-Type': 'application/json' },
      body,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || 'Convert proxy failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function GET(req: NextRequest) {
  try {
    authenticateAiRequest(req);
    const apiBaseUrl = resolveBackendApiBaseUrl(req);
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');
    const targetUrl = `${apiBaseUrl}/ai/models/convert${jobId ? `?jobId=${encodeURIComponent(jobId)}` : ''}`;
    return proxyJson(req, targetUrl);
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || 'Convert proxy failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
