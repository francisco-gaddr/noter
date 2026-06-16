import express, { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { isNeo4jEnabled, neo4jStatus, relayToNeo4j, type RelayStatement } from '../config/neo4j';

/**
 * Selective Neo4j sync relay (opt-in, Doc/nextcloud-ingestion.md + ADR 0011).
 *
 *   GET  /api/neo4j/status   AUTH — { enabled, database } so the client can show availability.
 *   POST /api/neo4j/sync     AUTH — { statements:[{text,params}] } built on-device by the shared
 *                                   neo4jSync module (lock-safe selection + parameterized Cypher).
 *                                   The relay enforces the authenticated userId on every statement
 *                                   and forwards only allowlisted statement shapes.
 *
 * Mounted behind authMiddleware. When NEO4J_ENABLED!=1 every route is a 404 no-op.
 */
const router = express.Router();

const ensureEnabled = (_req: Request, res: Response, next: NextFunction): void => {
  if (!isNeo4jEnabled()) { res.status(404).json({ error: 'Neo4j-sync är inte aktiverad' }); return; }
  next();
};

router.get('/status', (_req: Request, res: Response) => {
  res.json(neo4jStatus());
});

router.post('/sync', ensureEnabled, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const body = req.body || {};
    const statements: RelayStatement[] = Array.isArray(body.statements) ? body.statements : [];
    if (statements.length > 5000) {
      res.status(413).json({ error: 'För många statements' });
      return;
    }
    const result = await relayToNeo4j(userId, statements);
    if (!result.ok) { res.status(502).json(result); return; }
    res.json(result);
  } catch (e) {
    next(e);
  }
});

export default router;
