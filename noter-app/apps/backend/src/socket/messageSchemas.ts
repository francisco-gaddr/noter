import { z } from 'zod';

/**
 * Schemas for every Socket.IO event the server accepts FROM the client.
 *
 * Why: Socket.IO doesn't validate payloads — any client can send an
 * `{ noteId: { $where: '…' } }` and we'd hand it to mongoose. Defining
 * the shape here AND wiring `validateSocketEvent` (below) into the
 * io.on('connection') path closes that hole.
 *
 * Adding an event: extend SOCKET_SCHEMAS with the event name + schema.
 * Unknown events are rejected by default.
 */

const objectIdLike = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const userIdLike = z.string().min(1).max(128).regex(/^[A-Za-z0-9_:.\-@]+$/);

const userInfo = z.object({
  _id: userIdLike,
  username: z.string().max(64).optional(),
}).passthrough(); // tolerate extra fields, but redact-via-pick if needed elsewhere

export const SOCKET_SCHEMAS = {
  'note:join': z.object({
    noteId: objectIdLike,
    user: userInfo.optional(),
  }),
  'note:leave': z.object({
    noteId: objectIdLike,
    user: userInfo.optional(),
  }),
  'note:cursor': z.object({
    noteId: objectIdLike,
    position: z.number().int().nonnegative().max(1_000_000),
  }).optional(),
  'task:join': z.object({
    taskId: objectIdLike,
  }),
} as const satisfies Record<string, z.ZodTypeAny>;

export type SocketEventName = keyof typeof SOCKET_SCHEMAS;

export type ValidationResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; issues?: Array<{ path: string; message: string }> };

/**
 * Pure validator usable from tests and from the runtime io wrapper.
 *
 * Unknown event name → ok: false. Validation failures include the zod
 * issues array so the audit log can record what was rejected.
 */
export const validateSocketEvent = (event: string, payload: unknown): ValidationResult => {
  const schema = (SOCKET_SCHEMAS as Record<string, z.ZodTypeAny>)[event];
  if (!schema) return { ok: false, error: `unknown event: ${event}` };
  const result = schema.safeParse(payload);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    error: 'validation failed',
    issues: result.error.issues.map((i) => ({
      path: i.path.map((p) => String(p)).join('.'),
      message: i.message,
    })),
  };
};

// Test-only exposed list of known event names.
export const _KNOWN_EVENTS = Object.keys(SOCKET_SCHEMAS) as SocketEventName[];
