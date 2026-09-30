const sessions = new Map();
const starting = new Set();
let audioContext = null;

function notifyIdle() {
  if (sessions.size === 0 && starting.size === 0) {
    chrome.runtime.sendMessage({ target: 'background', type: 'OFFSCREEN_IDLE' }).catch(() => {});
  }
}

function releaseAudioContext() {
  if (sessions.size !== 0 || starting.size !== 0 || !audioContext) return;
  const oldContext = audioContext;
  audioContext = null;
  oldContext.close().catch(() => {});
  notifyIdle();
}

function stop(tabId) {
  const session = sessions.get(tabId);
  if (!session) return { ok: true };
  sessions.delete(tabId);
  session.track.removeEventListener('ended', session.onEnded);
  session.source.disconnect();
  session.gain.disconnect();
  session.stream.getTracks().forEach(track => track.stop());
  releaseAudioContext();
  return { ok: true };
}

async function start(tabId, streamId, volume) {
  if (sessions.has(tabId) || starting.has(tabId)) {
    throw new Error('このタブはすでに開始されています。');
  }
  starting.add(tabId);
  let stream;
  let source;
  let gain;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error('このタブの音声を取得できません。');
    if (!audioContext) audioContext = new AudioContext();
    source = audioContext.createMediaStreamSource(stream);
    gain = audioContext.createGain();
    gain.gain.value = volume / 100;
    source.connect(gain);
    gain.connect(audioContext.destination);
    await audioContext.resume();

    const onEnded = () => stop(tabId);
    sessions.set(tabId, { stream, track, source, gain, volume, onEnded });
    track.addEventListener('ended', onEnded, { once: true });
    if (track.readyState === 'ended') {
      stop(tabId);
      throw new Error('タブの音声取得が終了しました。');
    }
    return { ok: true };
  } catch (error) {
    source?.disconnect();
    gain?.disconnect();
    stream?.getTracks().forEach(track => track.stop());
    throw error;
  } finally {
    starting.delete(tabId);
    releaseAudioContext();
  }
}

function handle(message) {
  const tabId = message.tabId;
  switch (message.type) {
    case 'GET_COUNT':
      return { ok: true, count: sessions.size + starting.size };
    case 'GET_STATE': {
      const session = sessions.get(tabId);
      return { ok: true, active: !!session, volume: session?.volume ?? 100 };
    }
    case 'START':
      return start(tabId, message.streamId, message.volume);
    case 'SET_VOLUME': {
      const session = sessions.get(tabId);
      if (!session) throw new Error('このタブでは開始されていません。');
      session.gain.gain.value = message.volume / 100;
      session.volume = message.volume;
      return { ok: true };
    }
    case 'STOP':
      return stop(tabId);
    default:
      throw new Error('不明な操作です。');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen' || sender.id !== chrome.runtime.id) return;
  Promise.resolve().then(() => handle(message)).then(sendResponse, error => {
    sendResponse({ ok: false, error: error.message || String(error) });
  });
  return true;
});
