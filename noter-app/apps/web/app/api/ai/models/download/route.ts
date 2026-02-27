import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
// @ts-ignore
import { Readable } from 'stream';

const MODELS_DIR = path.join(process.cwd(), 'models');

if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

export async function POST(req: NextRequest) {
  try {
    const { url, filename } = await req.json();

    if (!url || !filename) {
      return new Response(JSON.stringify({ error: 'url and filename required' }), { status: 400 });
    }

    const filePath = path.join(MODELS_DIR, filename);

    if (fs.existsSync(filePath)) {
        return new Response(JSON.stringify({ message: 'File already exists', path: filePath }), { status: 200 });
    }

    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error('Download failed');

    // We don't have easy progress tracking with pipeline, but the file will be written.
    // To support progress, we'd need a separate status endpoint or more complex stream handling.
    // For now, we wait for finish.
    const fileStream = fs.createWriteStream(filePath);
    // @ts-ignore
    await pipeline(Readable.fromWeb(response.body), fileStream);

    return new Response(JSON.stringify({ message: 'Download complete', path: filePath }), { status: 200 });

  } catch (error: any) {
    console.error('Download error:', error);
    // Ensure we don't leave partial files if possible, though pipeline might handle it.
    return new Response(JSON.stringify({ error: error.message || 'Unknown download error' }), { status: 500 });
  }
}

export async function GET() {
    try {
        const files = fs.readdirSync(MODELS_DIR).map(file => {
            const stats = fs.statSync(path.join(MODELS_DIR, file));
            return {
                name: file,
                size: stats.size,
                path: path.join(MODELS_DIR, file),
                createdAt: stats.birthtime
            };
        });
        return new Response(JSON.stringify(files), { headers: { 'Content-Type': 'application/json' } });
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const { filename } = await req.json();
        if (!filename) {
            return new Response(JSON.stringify({ error: 'Filename required' }), { status: 400 });
        }
        const filePath = path.join(MODELS_DIR, filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return new Response(JSON.stringify({ message: 'Deleted' }), { status: 200 });
        } else {
            return new Response(JSON.stringify({ error: 'File not found' }), { status: 404 });
        }
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}
