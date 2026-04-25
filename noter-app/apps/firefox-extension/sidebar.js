const BASE_URL_KEY = 'noter.baseUrl';
const CAPTURE_QUEUE_KEY = 'noter.captureQueue';
const DEFAULT_BASE_URL = 'http://localhost:3000/app';

const frame = document.getElementById('noter-frame');
const baseUrlInput = document.getElementById('base-url');
const captureList = document.getElementById('capture-list');

const normalizeBaseUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, '');
};

const currentViewSuffix = (view) => {
  const normalized = String(view || 'notes');
  const separator = DEFAULT_BASE_URL.includes('?') ? '&' : '?';
  return `${separator}extensionView=${encodeURIComponent(normalized)}`;
};

const renderCaptureQueue = async () => {
  const stored = await browser.storage.local.get(CAPTURE_QUEUE_KEY);
  const queue = Array.isArray(stored[CAPTURE_QUEUE_KEY]) ? stored[CAPTURE_QUEUE_KEY] : [];
  captureList.innerHTML = '';
  if (queue.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'capture-item';
    empty.textContent = 'Ingen sparad markerad text just nu.';
    captureList.appendChild(empty);
    return;
  }
  queue.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'capture-item';
    li.innerHTML = `<strong>${item.title || 'Fangst'}</strong><small>${item.sourceUrl || ''}</small><div>${String(item.text || '').slice(0, 240)}</div>`;
    captureList.appendChild(li);
  });
};

const loadFrame = async (view) => {
  const stored = await browser.storage.local.get(BASE_URL_KEY);
  const baseUrl = normalizeBaseUrl(stored[BASE_URL_KEY]);
  baseUrlInput.value = baseUrl;
  frame.src = `${baseUrl}${currentViewSuffix(view)}`;
  document.querySelectorAll('.nav-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
};

document.getElementById('save-settings').addEventListener('click', async () => {
  const nextBaseUrl = normalizeBaseUrl(baseUrlInput.value);
  await browser.storage.local.set({ [BASE_URL_KEY]: nextBaseUrl });
  await loadFrame(document.querySelector('.nav-button.active')?.dataset.view || 'notes');
});

document.getElementById('open-app').addEventListener('click', async () => {
  const stored = await browser.storage.local.get(BASE_URL_KEY);
  const baseUrl = normalizeBaseUrl(stored[BASE_URL_KEY]);
  await browser.tabs.create({ url: baseUrl });
});

document.getElementById('clear-captures').addEventListener('click', async () => {
  await browser.storage.local.set({ [CAPTURE_QUEUE_KEY]: [] });
  await renderCaptureQueue();
});

document.querySelectorAll('.nav-button').forEach((button) => {
  button.addEventListener('click', async () => {
    await loadFrame(button.dataset.view || 'notes');
  });
});

browser.storage.onChanged.addListener((changes) => {
  if (changes[CAPTURE_QUEUE_KEY]) {
    renderCaptureQueue().catch(() => {});
  }
});

renderCaptureQueue().catch(() => {});
loadFrame('notes').catch(() => {});
