import { NextRequest } from 'next/server';
import { ChatMessage } from '@repo/ai';

let providerPromise: Promise<any> | null = null;

const getProvider = async () => {
  if (!providerPromise) {
    providerPromise = import('../../../lib/ai/provider').then((mod) => new mod.NodeLlamaProvider());
  }
  return providerPromise;
};

export async function POST(req: NextRequest) {
  try {
    const provider = await getProvider();
    const body = await req.json();
    const { messages, modelPath, gpuLayers } = body;

    if (!modelPath) {
      return new Response(JSON.stringify({ error: 'Model path required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Ensure model is loaded before streaming
    try {
        await provider.loadModel(modelPath, { gpuLayers: typeof gpuLayers === 'number' ? gpuLayers : undefined });
    } catch (e: any) {
        return new Response(JSON.stringify({ error: `Failed to load model: ${e.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await provider.streamResponse(messages as ChatMessage[], {}, (token) => {
            controller.enqueue(encoder.encode(token));
          });
          controller.close();
        } catch (error) {
          console.error("Streaming error:", error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error: any) {
    console.error('AI API Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
