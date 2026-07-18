/**
 * SMAScore — 試合状態の同期
 * Firebase Realtime Database（revision + transaction）+ localStorage バックアップ + BroadcastChannel
 */
(function () {
  const CHANNEL_NAME = "smascore-game";
  const STORAGE_KEY = "smascore-game-state";

  let channel = null;
  let lastDeliveredRevision = 0;

  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }

  function getRevision(data) {
    if (!data || typeof data !== "object") return 0;
    if (typeof data.revision === "number") return data.revision;
    return 0;
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

  function getStateRef() {
    return window.SMAScoreFirebase?.getStateRef?.() ?? null;
  }

  function serverTimestamp() {
    if (typeof firebase !== "undefined" && firebase.database?.ServerValue?.TIMESTAMP) {
      return firebase.database.ServerValue.TIMESTAMP;
    }
    return Date.now();
  }

  function publishLocal(payload) {
    writeStored(payload);
    if (channel) {
      channel.postMessage(payload);
    }
  }

  function publishToFirebase(payload, baseRevision) {
    const ref = getStateRef();
    if (!ref) {
      return Promise.resolve({
        ok: true,
        committed: true,
        offline: true,
        data: payload,
        revision: getRevision(payload),
      });
    }

    return new Promise((resolve) => {
      ref.transaction(
        (current) => {
          const currentRevision = getRevision(current);
          if (currentRevision > baseRevision) {
            return undefined;
          }

          return {
            ...payload,
            revision: currentRevision + 1,
            updatedAt: serverTimestamp(),
          };
        },
        (error, committed, snapshot) => {
          if (error) {
            console.warn("[SMAScore Sync] Firebase transaction failed:", error.message || error);
            resolve({ ok: false, committed: false, error });
            return;
          }

          if (!committed) {
            ref.once("value").then((remoteSnap) => {
              const remote = remoteSnap.val();
              console.warn(
                "[SMAScore Sync] Conflict: remote revision",
                getRevision(remote),
                "is newer than base",
                baseRevision
              );
              resolve({
                ok: false,
                committed: false,
                conflict: true,
                remote,
                revision: getRevision(remote),
              });
            });
            return;
          }

          const data = snapshot.val();
          publishLocal(data);
          resolve({
            ok: true,
            committed: true,
            data,
            revision: getRevision(data),
          });
        },
        false
      );
    });
  }

  function clearFirebase() {
    const ref = getStateRef();
    if (!ref) return Promise.resolve();

    return ref.remove().catch(() => undefined);
  }

  function publish(state, options) {
    const baseRevision = options?.baseRevision ?? lastDeliveredRevision;
    const pendingRevision = baseRevision + 1;
    const payload = {
      ...state,
      revision: pendingRevision,
      updatedAt: Date.now(),
    };

    publishLocal(payload);
    lastDeliveredRevision = pendingRevision;

    return publishToFirebase(payload, baseRevision).then((result) => {
      if (result.committed && result.data) {
        lastDeliveredRevision = getRevision(result.data);
        publishLocal(result.data);
        return result;
      }

      if (result.conflict && result.remote) {
        const remoteRevision = getRevision(result.remote);
        // ローカルに既に新しい revision を載せている場合、古い remote で上書きしない
        if (remoteRevision >= pendingRevision) {
          lastDeliveredRevision = remoteRevision;
          publishLocal(result.remote);
        }
      } else if (!result.committed) {
        lastDeliveredRevision = Math.max(baseRevision, getRevision(readStored()));
      }

      return result;
    });
  }

  function deliver(callback, data) {
    const revision = getRevision(data);
    if (revision <= lastDeliveredRevision) return false;
    lastDeliveredRevision = revision;
    writeStored(data);
    callback(data);
    return true;
  }

  function subscribe(callback) {
    if (channel) {
      channel.onmessage = (event) => {
        deliver(callback, event.data);
      };
    }

    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        deliver(callback, JSON.parse(event.newValue));
      } catch {
        /* ignore */
      }
    });

    const stateRef = getStateRef();
    if (stateRef) {
      stateRef.on("value", (snapshot) => {
        const data = snapshot.val();
        if (data) deliver(callback, data);
      });
    }

    const initial = readStored();
    if (initial) {
      deliver(callback, initial);
    }
  }

  function ready(timeoutMs) {
    const waitMs = typeof timeoutMs === "number" ? timeoutMs : 3000;

    return new Promise((resolve) => {
      const ref = getStateRef();
      if (!ref) {
        resolve(readStored());
        return;
      }

      let settled = false;
      const finish = (data) => {
        if (settled) return;
        settled = true;
        resolve(data || readStored());
      };

      ref.once("value").then((snapshot) => finish(snapshot.val()));
      setTimeout(() => finish(readStored()), waitMs);
    });
  }

  function fetchRemote() {
    const ref = getStateRef();
    if (!ref) {
      return Promise.resolve(readStored());
    }

    return ref.once("value").then((snapshot) => snapshot.val() || readStored());
  }

  function clear() {
    lastDeliveredRevision = 0;
    removeStored();
    return clearFirebase();
  }

  window.SMAScoreSync = {
    publish,
    subscribe,
    ready,
    fetchRemote,
    read: readStored,
    clear,
    getRevision,
    STORAGE_KEY,
  };
})();
