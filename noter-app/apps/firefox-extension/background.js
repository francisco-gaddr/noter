const CAPTURE_QUEUE_KEY = 'noter.captureQueue';
const DEFAULT_BASE_URL = 'http://localhost:3000/app';

const pushCapture = async (capture) => {
  const stored = await browser.storage.local.get(CAPTURE_QUEUE_KEY);
  const queue = Array.isArray(stored[CAPTURE_QUEUE_KEY]) ? stored[CAPTURE_QUEUE_KEY] : [];
  queue.unshift(capture);
  await browser.storage.local.set({ [CAPTURE_QUEUE_KEY]: queue.slice(0, 50) });
};

browser.runtime.onInstalled.addListener(async () => {
  await browser.contextMenus.create({
    id: 'noter-save-selection',
    title: 'Spara till Noter',
    contexts: ['selection'],
  });
  const stored = await browser.storage.local.get('noter.baseUrl');
  if (!stored['noter.baseUrl']) {
    await browser.storage.local.set({ 'noter.baseUrl': DEFAULT_BASE_URL });
  }
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'noter-save-selection' || !info.selectionText) return;
  await pushCapture({
    id: String(Date.now()),
    text: info.selectionText,
    sourceUrl: tab?.url || '',
    title: tab?.title || 'Markerad text',
    createdAt: new Date().toISOString(),
  });
  await browser.sidebarAction.open();
});

browser.runtime.onMessage.addListener(async (message) => {
  if (message?.type === 'noter:open-sidebar') {
    await browser.sidebarAction.open();
  }
});
