import { NextRequest } from 'next/server';
import { NodeLlamaProvider } from '../../../lib/ai/provider';
import { ChatMessage } from '@repo/ai';

const provider = new NodeLlamaProvider();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages, modelPath } = body;

    if (!modelPath) {
      return new Response(JSON.stringify({ error: 'Model path required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    await provider.loadModel(modelPath);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          await provider.streamResponse(messages as ChatMessage[], {}, (token) => {
            controller.enqueue(new TextEncoder().encode(token));
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
