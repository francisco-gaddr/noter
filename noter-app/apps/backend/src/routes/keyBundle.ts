import express, { Response, NextFunction } from 'express';
import Joi from 'joi';
import User from '../models/User';
import { AuthRequest } from '../middleware/authMiddleware';
import { validate } from '../middleware/validate';
import { UnauthorizedError, NotFoundError } from '../utils/httpErrors';

/**
 * End-to-end key bundle endpoints. The server stores the user's *wrapped* dataKey
 * (sealed under a password-derived root key the server never sees) and hands it
 * back so any of the user's devices can unwrap it locally. The payload is opaque:
 * the backend cannot read note/task content with it.
 */
const router = express.Router();

// Opaque KDF params: a small map of known numeric cost keys. Bounded tightly so a client can't
// stash arbitrary data; the server never interprets it (the client reproduces the key from it).
const kdfParamsSchema = Joi.object({
  m: Joi.number().integer().min(1).max(4_194_304), // argon memory (KiB), <= 4 GiB
  t: Joi.number().integer().min(1).max(64),        // argon passes
  p: Joi.number().integer().min(1).max(64),        // argon parallelism
  c: Joi.number().integer().min(1).max(50_000_000), // pbkdf2 iterations
}).max(4);

const putSchema = Joi.object({
  wrappedDataKey: Joi.string().max(1024).pattern(/^v3w:/).required(),
  kdfSalt: Joi.string().base64().max(256).required(),
  kdf: Joi.string().valid('argon2id', 'pbkdf2-sha256').required(),
  kdfParams: kdfParamsSchema.optional(),
  keyVersion: Joi.number().integer().min(1).max(1_000_000).required(),
  recoveryWrappedDataKey: Joi.string().max(1024).pattern(/^v3w:/).optional(),
  recoverySalt: Joi.string().base64().max(256).optional(),
  recoveryKdf: Joi.string().valid('argon2id', 'pbkdf2-sha256').optional(),
  recoveryKdfParams: kdfParamsSchema.optional(),
});

// GET /api/keys/bundle — fetch this user's key bundle (404 if not enrolled yet).
router.get('/bundle', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedError('Not authenticated');

    const user = await User.findById(userId).select('keyBundle').lean();
    if (!user?.keyBundle) throw new NotFoundError('No key bundle', { code: 'NO_KEY_BUNDLE' });

    const { wrappedDataKey, kdfSalt, kdf, kdfParams, keyVersion, updatedAt, recoveryWrappedDataKey, recoverySalt, recoveryKdf, recoveryKdfParams } = user.keyBundle;
    res.json({ wrappedDataKey, kdfSalt, kdf, kdfParams, keyVersion, updatedAt, recoveryWrappedDataKey, recoverySalt, recoveryKdf, recoveryKdfParams });
  } catch (error) {
    next(error);
  }
});

// PUT /api/keys/bundle — enrol or rotate. First write wins enrolment; later writes
// (e.g. password change re-wrap) overwrite. Never lets a client wipe the bundle to
// null via this route.
router.put('/bundle', validate(putSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new UnauthorizedError('Not authenticated');

    const { wrappedDataKey, kdfSalt, kdf, kdfParams, keyVersion, recoveryWrappedDataKey, recoverySalt, recoveryKdf, recoveryKdfParams } = req.body;
    const updated = await User.findByIdAndUpdate(
      userId,
      { keyBundle: { wrappedDataKey, kdfSalt, kdf, kdfParams, keyVersion, updatedAt: new Date(), recoveryWrappedDataKey, recoverySalt, recoveryKdf, recoveryKdfParams } },
      { new: true },
    )
      .select('keyBundle')
      .lean();

    if (!updated) throw new NotFoundError('User not found');
    res.json({ ok: true, keyVersion });
  } catch (error) {
    next(error);
  }
});

export default router;
