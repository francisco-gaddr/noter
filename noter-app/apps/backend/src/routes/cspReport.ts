import express from 'express';
import logger from '../utils/logger';

const router = express.Router();

// Reports come in either the legacy `application/csp-report` or the
// newer `application/reports+json` Reporting API format. We accept both.
const cspReportBody = express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '32kb' });

const MAX_LOG_LEN = 500;
const sanitize = (v: unknown): string => {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? '');
  return s.slice(0, MAX_LOG_LEN);
};

// Simple in-memory dedupe — high-volume CSP violations from a single misbehaving
// page would otherwise flood our logs. Same (effectiveDirective, blockedURI,
// sourceFile) triplet is suppressed for 5 minutes per ip.
const seen = new Map<string, number>();
const DEDUPE_MS = 5 * 60 * 1000;
const isFresh = (key: string): boolean => {
  const now = Date.now();
  const last = seen.get(key);
  if (last !== undefined && now - last < DEDUPE_MS) return false;
  seen.set(key, now);
  if (seen.size > 256) {
    for (const [k, t] of seen) {
      if (now - t > DEDUPE_MS) seen.delete(k);
    }
  }
  return true;
};

router.post('/', cspReportBody, (req, res) => {
  // Reports API delivers an array under top-level body; legacy delivers
  // { 'csp-report': {…} }
  const body: any = req.body;
  const reports: any[] = Array.isArray(body)
    ? body
    : body?.['csp-report']
      ? [body['csp-report']]
      : body?.body
        ? [body.body]
        : [];

  const ip = (req.ip || 'unknown').slice(0, 64);

  for (const r of reports) {
    const directive = sanitize(r?.['effective-directive'] || r?.effectiveDirective || r?.violatedDirective || 'unknown');
    const blockedURI = sanitize(r?.['blocked-uri'] || r?.blockedURL || r?.blockedURI || 'unknown');
    const sourceFile = sanitize(r?.['source-file'] || r?.sourceFile || '');
    const key = `${ip}|${directive}|${blockedURI}|${sourceFile}`;
    if (!isFresh(key)) continue;

    logger.warn('csp.violation', {
      ip,
      directive,
      blockedURI,
      sourceFile,
      documentURI: sanitize(r?.['document-uri'] || r?.documentURL || r?.documentURI || ''),
      lineNumber: typeof r?.lineNumber === 'number' ? r.lineNumber : undefined,
      columnNumber: typeof r?.columnNumber === 'number' ? r.columnNumber : undefined,
      disposition: sanitize(r?.disposition || ''),
      userAgent: sanitize(req.headers['user-agent'] || ''),
    });
  }

  // 204: success, no body. Browsers don't read the response anyway.
  res.status(204).end();
});

export default router;
