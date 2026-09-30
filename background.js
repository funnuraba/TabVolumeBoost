const OFFSCREEN_URL = 'offscreen.html';
let creatingOffscreen = null;
let closingOffscreen = null;
let pendingStarts = 0;

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (closingOffscreen) await closingOffscreen;
  if (await hasOffscreen()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA'],
      justification: 'Process and play audio from user-selected tabs'
    }).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

async function toOffscreen(type, data = {}) {
  return chrome.runtime.sendMessage({ target: 'offscreen', type, ...data });
}

async function closeIfIdle() {
  if (closingOffscreen) return closingOffscreen;
  closingOffscreen = (async () => {
    if (pendingStarts || !(await hasOffscreen())) return;
    try {
      const reply = await toOffscreen('GET_COUNT');
      if (reply?.count === 0 && pendingStarts === 0) {
        await chrome.offscreen.closeDocument();
      }
    } catch {
      // The document may already have closed while a tab was stopping.
    }
  })().finally(() => { closingOffscreen = null; });
  return closingOffscreen;
}

async function handle(message) {
  if (message.type === 'OFFSCREEN_IDLE') {
    await closeIfIdle();
    return { ok: true };
  }

  const tabId = message.tabId;
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error('対象のタブが無効です。');

  switch (message.type) {
    case 'GET_STATE': {
      if (!(await hasOffscreen())) return { ok: true, active: false, volume: 100 };
      return toOffscreen('GET_STATE', { tabId });
    }
    case 'START': {
      const volume = message.volume;
      if (!Number.isFinite(volume) || volume < 0) {
        throw new Error('音量は0%以上の数値で指定してください。');
      }
      // Request the stream while the popup's user gesture is still available.
      pendingStarts++;
      try {
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
        await ensureOffscreen();
        return await toOffscreen('START', { tabId, streamId, volume });
      } finally {
        pendingStarts--;
        await closeIfIdle();
      }
    }
    case 'SET_VOLUME': {
      const volume = message.volume;
      if (!Number.isFinite(volume) || volume < 0) {
        throw new Error('音量は0%以上の数値で指定してください。');
      }
      if (!(await hasOffscreen())) throw new Error('このタブでは開始されていません。');
      return toOffscreen('SET_VOLUME', { tabId, volume });
    }
    case 'STOP': {
      if (!(await hasOffscreen())) return { ok: true };
      const reply = await toOffscreen('STOP', { tabId });
      await closeIfIdle();
      return reply;
    }
    default:
      throw new Error('不明な操作です。');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'background' || sender.id !== chrome.runtime.id) return;
  handle(message).then(sendResponse, error => {
    sendResponse({ ok: false, error: error.message || String(error) });
  });
  return true;
});

chrome.tabs.onRemoved.addListener(async tabId => {
  if (!(await hasOffscreen())) return;
  try {
    await toOffscreen('STOP', { tabId });
    await closeIfIdle();
  } catch {
    // Tab or offscreen document was already closed.
  }
});
