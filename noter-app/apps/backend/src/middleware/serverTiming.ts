import type { Request, Response, NextFunction } from 'express';
import { performance } from 'node:perf_hooks';
import { trace, context as otelContext } from '@opentelemetry/api';

type TimingMark = { name: string; description?: string; dur: number };

const tryExtractTraceId = (): string | undefined => {
  // We pull from the OTel active context — auto-instrumentation (deps:
  // @opentelemetry/auto-instrumentations-node) wraps every incoming HTTP
  // request in a span, so by the time middleware runs there is an active span.
  try {
    const span = trace.getSpan(otelContext.active());
    const sc = span?.spanContext();
    if (!sc) return undefined;
    return sc.traceId;
  } catch {
    return undefined;
  }
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Request {
      timings?: TimingMark[];
      timingStart?: number;
    }
  }
}

const sanitizeName = (name: string): string => name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);

export const serverTimingMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  req.timings = [];
  req.timingStart = performance.now();
  res.on('finish', () => {
    // no-op; the header must be set before headers flushed. We set it in helper below.
  });
  // Always set total at response time via override.
  const origEnd = res.end.bind(res) as (...args: unknown[]) => Response;
  (res as unknown as { end: (...args: unknown[]) => Response }).end = function patchedEnd(...args: unknown[]) {
    try {
      if (!res.headersSent) {
        const total = performance.now() - (req.timingStart || performance.now());
        const segments: string[] = [];
        for (const m of req.timings || []) {
          const dur = Number(m.dur.toFixed(2));
          let seg = `${sanitizeName(m.name)};dur=${dur}`;
          if (m.description) seg += `;desc="${m.description.replace(/"/g, '').slice(0, 40)}"`;
          segments.push(seg);
        }
        segments.push(`total;dur=${total.toFixed(2)}`);
        const traceId = tryExtractTraceId();
        if (traceId) {
          // `trace` segment carries the W3C trace-id so frontends can stitch
          // a request to OTel collector traces (via Jaeger/Tempo/Honeycomb).
          segments.push(`trace;desc="${traceId}"`);
          // Echo as a dedicated header too — Server-Timing is the right place
          // for it but some observability tooling reads the X-Trace-Id header.
          res.setHeader('X-Trace-Id', traceId);
        }
        res.setHeader('Server-Timing', segments.join(', '));
      }
    } catch {
      // never block the response
    }
    return origEnd(...(args as Parameters<typeof origEnd>));
  };
  next();
};

export const recordTiming = (req: Request, name: string, durMs: number, description?: string): void => {
  if (!req.timings) req.timings = [];
  req.timings.push({ name, description, dur: durMs });
};

export const timeSection = async <T>(
  req: Request,
  name: string,
  fn: () => Promise<T> | T,
  description?: string,
): Promise<T> => {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    recordTiming(req, name, performance.now() - start, description);
  }
};
