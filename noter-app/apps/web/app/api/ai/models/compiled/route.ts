import { NextRequest } from 'next/server';

const getBaseUrl = (origin?: string | null) =>
  (process.env.NEXT_PUBLIC_MLC_MODELS_BASE_URL || process.env.MLC_MODELS_BASE_URL || (origin ? `${origin}/mlc-models` : 'https://daylited.com/mlc-models')).replace(/\/$/, '');

const normalizeQuant = (value?: string | null) => (value || 'Q4_K_M').toUpperCase();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const modelId = searchParams.get('modelId');
    const platformRaw = searchParams.get('platform');
    const quant = normalizeQuant(searchParams.get('quant'));

    if (!modelId) {
      return new Response(JSON.stringify({ error: 'modelId required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const platform = platformRaw === 'android' ? 'android' : 'iphone';
    const baseUrl = getBaseUrl(new URL(req.url).origin);
    const encodedModel = encodeURIComponent(modelId);
    const filename = `${quant}.zip`;
    const url = `${baseUrl}/${platform}/${encodedModel}/${filename}`;

    return new Response(JSON.stringify({ url, filename }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
