import express, { Response, NextFunction } from 'express';
import Joi from 'joi';
import { AuthRequest } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import { createApiKey, listApiKeys, revokeApiKey } from '../middleware/apiKeyAuth';
import { UnauthorizedError, NotFoundError } from '../utils/httpErrors';

/**
 * User-facing API-key management so external apps can integrate. The secret is
 * returned exactly once (on POST); only its SHA-256 hash is stored. Keys are
 * scoped to the authenticated user.
 */
const router = express.Router();

const KNOWN_SCOPES = ['notes:read', 'notes:write', 'tasks:read', 'tasks:write'];

const createSchema = Joi.object({
  scopes: Joi.array().items(Joi.string().valid(...KNOWN_SCOPES)).max(8).default([]),
});

// POST /api/keys/api-keys — mint a new key (token shown once).
router.post('/api-keys', validate(createSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedError('Not authenticated');
    const created = await createApiKey(userId, req.body.scopes || []);
    res.status(201).json(created); // { token, kid, scopes } — token is not retrievable again
  } catch (error) {
    next(error);
  }
});

// GET /api/keys/api-keys — list this user's keys (no secrets).
router.get('/api-keys', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedError('Not authenticated');
    res.json({ keys: await listApiKeys(userId) });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/keys/api-keys/:kid — revoke a key.
router.delete('/api-keys/:kid', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedError('Not authenticated');
    const ok = await revokeApiKey(String(req.params.kid), userId);
    if (!ok) throw new NotFoundError('API key not found', { code: 'API_KEY_NOT_FOUND' });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
