import { NextRequest } from 'next/server';
import { HuggingFaceService } from '@repo/ai';
import { authenticateAiRequest } from '../../_lib/security';

const hf = new HuggingFaceService();

export async function GET(req: NextRequest) {
  try {
    authenticateAiRequest(req);
    const { searchParams } = new URL(req.url);
    const modelId = searchParams.get('modelId');
    
    if (!modelId) {
      return new Response(JSON.stringify({ error: 'modelId required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const files = await hf.getModelFiles(modelId);
    return new Response(JSON.stringify(files), { headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
