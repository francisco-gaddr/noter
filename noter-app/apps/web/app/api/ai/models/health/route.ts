import { NextRequest } from 'next/server';
import { authenticateAiRequest, buildBackendProxyHeaders, resolveBackendApiBaseUrl } from '../../_lib/security';

export async function GET(req: NextRequest) {
  try {
    authenticateAiRequest(req);
    const apiBaseUrl = resolveBackendApiBaseUrl(req);
    const response = await fetch(`${apiBaseUrl}/ai/models/health`, {
      headers: buildBackendProxyHeaders(req),
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
