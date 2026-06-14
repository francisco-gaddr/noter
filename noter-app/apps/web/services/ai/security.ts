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
} from '@repo/shared';
