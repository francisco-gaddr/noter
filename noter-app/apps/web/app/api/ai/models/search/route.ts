import { NextRequest } from 'next/server';
import { HuggingFaceService } from '@repo/ai';

const hf = new HuggingFaceService();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');
    
    if (!query) {
      return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });
    }

    const models = await hf.searchModels(query);
    return new Response(JSON.stringify(models), { headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
