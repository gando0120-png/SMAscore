/**
 * SMAScore — 同一ブラウザ内タブ間同期（BroadcastChannel + localStorage）
 */
(function () {
  const CHANNEL_NAME = "smascore-game";
  const STORAGE_KEY = "smascore-game-state";

  let channel = null;

  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }

  function readStored() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function publish(state) {
    const payload = { ...state, _ts: Date.now() };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* localStorage 不可時は BroadcastChannel のみ */
    }

    if (channel) {
      channel.postMessage(payload);
    }
  }

  function subscribe(callback) {
    let lastTs = 0;

    function deliver(data) {
      if (!data || typeof data._ts !== "number") return;
      if (data._ts <= lastTs) return;
      lastTs = data._ts;
      callback(data);
    }

    if (channel) {
      channel.onmessage = (event) => deliver(event.data);
    }

    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        deliver(JSON.parse(event.newValue));
      } catch {
        /* ignore */
      }
    });

    const initial = readStored();
    if (initial) {
      deliver(initial);
    }

    setInterval(() => {
      const stored = readStored();
      if (stored) deliver(stored);
    }, 200);
  }

  window.SMAScoreSync = { publish, subscribe, read: readStored };
})();
