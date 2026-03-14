import express, { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { validate } from '../middleware/validate';
import { AuthRequest } from '../middleware/authMiddleware';
import AIConversationSync from '../models/AIConversationSync';
import AIMessageSync from '../models/AIMessageSync';
import AIProjectSync from '../models/AIProjectSync';
import { isEncryptedPayload } from '../utils/encryption';

const router = express.Router();

const encryptedRequired = Joi.string().custom((value, helpers) => (
  isEncryptedPayload(value) ? value : helpers.error('any.invalid')
));
const encryptedOrEmpty = Joi.alternatives().try(Joi.string().valid(''), encryptedRequired);

const encryptedConversationSchema = Joi.object({
  id: Joi.string().required(),
  titleEnc: encryptedRequired.required(),
  modelEnc: encryptedOrEmpty.optional(),
  projectIdEnc: encryptedOrEmpty.optional(),
  iconEnc: encryptedOrEmpty.optional(),
  iconColorEnc: encryptedOrEmpty.optional(),
  createdAtEnc: encryptedRequired.required(),
  updatedAtEnc: encryptedRequired.required(),
  updatedAt: Joi.string().isoDate().required(),
});

const encryptedMessageSchema = Joi.object({
  id: Joi.string().required(),
  conversationId: Joi.string().required(),
  roleEnc: encryptedRequired.required(),
  contentEnc: encryptedRequired.required(),
  toolCallsEnc: encryptedOrEmpty.optional(),
  toolCallIdEnc: encryptedOrEmpty.optional(),
  createdAtEnc: encryptedRequired.required(),
  createdAt: Joi.string().isoDate().required(),
});

const encryptedProjectSchema = Joi.object({
  id: Joi.string().required(),
  nameEnc: encryptedRequired.required(),
  systemPromptEnc: encryptedOrEmpty.optional(),
  iconEnc: encryptedOrEmpty.optional(),
  iconColorEnc: encryptedOrEmpty.optional(),
  createdAtEnc: encryptedRequired.required(),
  updatedAtEnc: encryptedRequired.required(),
  updatedAt: Joi.string().isoDate().required(),
});

const pushSchema = Joi.object({
  conversations: Joi.array().items(encryptedConversationSchema).default([]),
  messages: Joi.array().items(encryptedMessageSchema).default([]),
  projects: Joi.array().items(encryptedProjectSchema).default([]),
  deletedConversationIds: Joi.array().items(Joi.string()).default([]),
  deletedProjectIds: Joi.array().items(Joi.string()).default([]),
});

router.get('/pull', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const [projects, conversations, messages] = await Promise.all([
      AIProjectSync.find({ userId }).sort({ updatedAt: -1 }).lean(),
      AIConversationSync.find({ userId }).sort({ updatedAt: -1 }).lean(),
      AIMessageSync.find({ userId }).sort({ createdAt: 1 }).lean(),
    ]);

    res.json({
      projects: projects.map((p) => ({
        id: p.projectId,
        nameEnc: p.nameEnc,
        systemPromptEnc: p.systemPromptEnc || '',
        iconEnc: p.iconEnc || '',
        iconColorEnc: p.iconColorEnc || '',
        createdAtEnc: p.createdAtEnc,
        updatedAtEnc: p.updatedAtEnc,
        updatedAt: p.updatedAt.toISOString(),
      })),
      conversations: conversations.map((c) => ({
        id: c.conversationId,
        titleEnc: c.titleEnc,
        modelEnc: c.modelEnc || '',
        projectIdEnc: c.projectIdEnc || '',
        iconEnc: c.iconEnc || '',
        iconColorEnc: c.iconColorEnc || '',
        createdAtEnc: c.createdAtEnc,
        updatedAtEnc: c.updatedAtEnc,
        updatedAt: c.updatedAt.toISOString(),
      })),
      messages: messages.map((m) => ({
        id: m.messageId,
        conversationId: m.conversationId,
        roleEnc: m.roleEnc,
        contentEnc: m.contentEnc,
        toolCallsEnc: m.toolCallsEnc || '',
        toolCallIdEnc: m.toolCallIdEnc || '',
        createdAtEnc: m.createdAtEnc,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/push', validate(pushSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthRequest).user!.userId;
    const {
      conversations = [],
      messages = [],
      projects = [],
      deletedConversationIds = [],
      deletedProjectIds = [],
    } = req.body || {};

    if (projects.length > 0) {
      await AIProjectSync.bulkWrite(projects.map((item: any) => ({
        updateOne: {
          filter: { userId, projectId: item.id },
          update: {
            $set: {
              userId,
              projectId: item.id,
              nameEnc: item.nameEnc,
              systemPromptEnc: item.systemPromptEnc || '',
              iconEnc: item.iconEnc || '',
              iconColorEnc: item.iconColorEnc || '',
              createdAtEnc: item.createdAtEnc,
              updatedAtEnc: item.updatedAtEnc,
              updatedAt: new Date(item.updatedAt),
            },
          },
          upsert: true,
        },
      })));
    }

    if (conversations.length > 0) {
      await AIConversationSync.bulkWrite(conversations.map((item: any) => ({
        updateOne: {
          filter: { userId, conversationId: item.id },
          update: {
            $set: {
              userId,
              conversationId: item.id,
              titleEnc: item.titleEnc,
              modelEnc: item.modelEnc || '',
              projectIdEnc: item.projectIdEnc || '',
              iconEnc: item.iconEnc || '',
              iconColorEnc: item.iconColorEnc || '',
              createdAtEnc: item.createdAtEnc,
              updatedAtEnc: item.updatedAtEnc,
              updatedAt: new Date(item.updatedAt),
            },
          },
          upsert: true,
        },
      })));
    }

    if (messages.length > 0) {
      await AIMessageSync.bulkWrite(messages.map((item: any) => ({
        updateOne: {
          filter: { userId, messageId: item.id },
          update: {
            $set: {
              userId,
              messageId: item.id,
              conversationId: item.conversationId,
              roleEnc: item.roleEnc,
              contentEnc: item.contentEnc,
              toolCallsEnc: item.toolCallsEnc || '',
              toolCallIdEnc: item.toolCallIdEnc || '',
              createdAtEnc: item.createdAtEnc,
              createdAt: new Date(item.createdAt),
            },
          },
          upsert: true,
        },
      })));
    }

    if (deletedConversationIds.length > 0) {
      await AIConversationSync.deleteMany({ userId, conversationId: { $in: deletedConversationIds } });
      await AIMessageSync.deleteMany({ userId, conversationId: { $in: deletedConversationIds } });
    }
    if (deletedProjectIds.length > 0) {
      await AIProjectSync.deleteMany({ userId, projectId: { $in: deletedProjectIds } });
    }

    const io = req.app.get('io');
    io.to(`user:${userId}`).emit('ai:sync-updated', {
      at: new Date().toISOString(),
      projects: projects.length,
      conversations: conversations.length,
      messages: messages.length,
      deletedConversationIds,
      deletedProjectIds,
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
