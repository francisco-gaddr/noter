/**
 * AI lock-security helpers — re-exported from the shared canonical module so the chat
 * tool guards, the agent tool guards (web/mobile/backend) and the memory layer all use
 * ONE implementation of "is this note readable (not locked / unlocked)?".
 *
 * The hard security invariant lives in @repo/shared/locks: the AI must never read or
 * decrypt a locked note/project. Keep importing from here — it forwards to shared.
 */
export {
  type SecurityNote,
  parseLockedFlag,
  hasLockSignal,
  buildSecurityNoteMap,
  findBlockingLockedAncestor,
  isReadableWithLocks,
  maskLockedNote,
  maskLockedHierarchy,
  filterReadableNotes,
  // AI/index ALWAYS use the empty unlock set — a UI folder-unlock is NEVER extended to the
  // AI or the search index. Use these, never the store's unlockedProtectedNoteIds.
  AI_INDEX_NO_UNLOCK,
  filterReadableForAI,
  isReadableForAI,
} from '@repo/shared';
