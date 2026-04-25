import { NextRequest } from 'next/server';
import { authenticateAiRequest, buildBackendProxyHeaders, resolveBackendApiBaseUrl } from '../../_lib/security';

export async function GET(req: NextRequest) {
  try {
    authenticateAiRequest(req);
    const { searchParams } = new URL(req.url);
    const modelId = searchParams.get('modelId');

    if (!modelId) {
      return new Response(JSON.stringify({ error: 'modelId required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const apiBaseUrl = resolveBackendApiBaseUrl(req);
    const response = await fetch(`${apiBaseUrl}/ai/models/compiled?${searchParams.toString()}`, {
      headers: buildBackendProxyHeaders(req),
      cache: 'no-store',
    });
    const bodyText = await response.text();
    return new Response(bodyText, {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || 'Compiled proxy failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
