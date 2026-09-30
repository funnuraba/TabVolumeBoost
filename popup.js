const title = document.getElementById('tab-title');
const slider = document.getElementById('volume');
const numberInput = document.getElementById('volume-number');
const value = document.getElementById('volume-value');
const toggle = document.getElementById('toggle');
const status = document.getElementById('status');

let tabId = null;
let active = false;
let busy = false;

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

function readVolume() {
  const text = numberInput.value.trim();
  const volume = Number(text);
  if (!text || !Number.isFinite(volume) || volume < 0) {
    throw new Error('音量は0%以上の数値で指定してください。');
  }
  return volume;
}

function updateDisplay() {
  value.textContent = numberInput.value ? `${numberInput.value}%` : '—';
}

function render() {
  updateDisplay();
  slider.disabled = busy || tabId === null;
  numberInput.disabled = busy || tabId === null;
  toggle.disabled = busy || tabId === null;
  toggle.textContent = busy ? '処理中…' : active ? 'このタブで停止' : 'このタブで開始';
}

async function request(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ target: 'background', type, tabId, ...extra });
  if (!response?.ok) throw new Error(response?.error || '操作に失敗しました。');
  return response;
}

slider.addEventListener('input', () => {
  // Let the browser keep its native pointer drag. Reassigning disabled or
  // messaging the service worker during input can interrupt the gesture.
  numberInput.value = slider.value;
  updateDisplay();
});

numberInput.addEventListener('input', () => {
  const volume = Number(numberInput.value);
  if (numberInput.value && Number.isFinite(volume) && volume >= 0) {
    slider.value = String(Math.min(volume, 500));
  }
  updateDisplay();
});

async function applyVolume() {
  if (!active) return;
  try {
    await request('SET_VOLUME', { volume: readVolume() });
    setStatus('このタブだけに適用中');
  } catch (error) {
    setStatus(error.message, true);
  }
}

slider.addEventListener('change', applyVolume);
numberInput.addEventListener('change', applyVolume);

toggle.addEventListener('click', async () => {
  busy = true;
  render();
  try {
    if (active) {
      await request('STOP');
      active = false;
      setStatus('停止しました。');
    } else {
      await request('START', { volume: readVolume() });
      active = true;
      setStatus('このタブだけに適用中');
    }
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    busy = false;
    render();
  }
});

async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!Number.isInteger(tab?.id)) throw new Error('対象のタブを取得できません。');
    tabId = tab.id;
    title.textContent = tab.title || '現在のタブ';
    title.title = tab.title || '';
    const state = await request('GET_STATE');
    active = state.active;
    numberInput.value = String(state.volume);
    slider.value = String(Math.min(state.volume, 500));
    setStatus(active ? 'このタブだけに適用中' : '開始すると音量を調整できます。');
  } catch (error) {
    setStatus(error.message, true);
  }
  render();
}

init();
