/**
 * Chat history windowing — the standard chat-app pattern (Slack/WhatsApp): render only the most
 * RECENT messages and reveal older ones on demand ("load earlier"). This keeps the DOM small for long
 * conversations while preserving the scroll-to-bottom anchor and the streaming last message exactly
 * (the newest messages are always mounted). Far safer than scroll-virtualizing a streaming list.
 */
export const MESSAGE_WINDOW = 60;

/**
 * Given the total message count and how many we currently allow visible, return where the visible
 * slice starts and how many older messages are hidden. Pure + exported so the windowing is unit-tested.
 */
export const computeMessageWindow = (
  total: number,
  visibleCount: number,
): { startIndex: number; hiddenCount: number } => {
  const shown = Math.min(Math.max(total, 0), Math.max(visibleCount, 0));
  const startIndex = Math.max(0, total - shown);
  return { startIndex, hiddenCount: startIndex };
};
