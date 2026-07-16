/**
 * SMAScore — 試合状態の同期
 * Firebase Realtime Database（優先）+ localStorage バックアップ + BroadcastChannel（同一ブラウザ）
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

  function writeStored(payload) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* localStorage 不可時はスキップ */
    }
  }

  function removeStored() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  function publishToFirebase(payload) {
    const ref = window.SMAScoreFirebase?.getStateRef?.();
    if (!ref) return;

    ref.set(payload).catch(() => {
      /* Firebase 未接続時は localStorage / BroadcastChannel のみ */
    });
  }

  function clearFirebase() {
    const ref = window.SMAScoreFirebase?.getStateRef?.();
    if (!ref) return;

    ref.remove().catch(() => {
      /* ignore */
    });
  }

  function publish(state) {
    const payload = { ...state, _ts: Date.now() };

    writeStored(payload);

    if (channel) {
      channel.postMessage(payload);
    }

    publishToFirebase(payload);
  }

  function subscribe(callback) {
    let lastTs = 0;

    function deliver(data) {
      if (!data || typeof data._ts !== "number") return;
      if (data._ts <= lastTs) return;
      lastTs = data._ts;
      writeStored(data);
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

    const stateRef = window.SMAScoreFirebase?.getStateRef?.();
    if (stateRef) {
      const handler = (snapshot) => {
        const data = snapshot.val();
        if (data) deliver(data);
      };
      stateRef.on("value", handler);
    }

    setInterval(() => {
      const stored = readStored();
      if (stored) deliver(stored);
    }, 200);
  }

  function clear() {
    removeStored();
    clearFirebase();
  }

  window.SMAScoreSync = {
    publish,
    subscribe,
    read: readStored,
    clear,
    STORAGE_KEY,
  };
})();
