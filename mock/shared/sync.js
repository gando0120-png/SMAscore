/**
 * SMAScore — 試合状態の同期
 * Firebase Realtime Database（revision + transaction）+ localStorage バックアップ + BroadcastChannel
 *
 * matchId が変わった state は revision が小さくても新しい試合として受け入れる
 */
(function () {
  const CHANNEL_NAME = "smascore-game";
  const STORAGE_KEY = "smascore-game-state";
  const CLEAR_SENTINEL = "__smascore_sync_clear__";

  let channel = null;
  let lastDeliveredRevision = 0;
  let lastDeliveredMatchId = "";

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

  function getMatchId(data) {
    if (!data || typeof data !== "object") return "";
    if (typeof data.matchId === "string" && data.matchId.trim()) {
      return data.matchId.trim();
    }
    return "";
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

  function resetDeliveryCursor() {
    lastDeliveredRevision = 0;
    lastDeliveredMatchId = "";
  }

  function shouldAccept(data) {
    if (!data || typeof data !== "object") return false;

    const revision = getRevision(data);
    const matchId = getMatchId(data);

    if (matchId && lastDeliveredMatchId && matchId !== lastDeliveredMatchId) {
      // 別試合への切替: より新しい updatedAt のみ受け入れる（古い remote で新試合を潰さない）
      const stored = readStored();
      if (stored) {
        const incomingTs = typeof data.updatedAt === "number" ? data.updatedAt : 0;
        const storedTs = typeof stored.updatedAt === "number" ? stored.updatedAt : 0;
        if (incomingTs < storedTs) return false;
        if (incomingTs === storedTs && getMatchId(stored) === lastDeliveredMatchId) {
          return false;
        }
      }
      return true;
    }

    if (matchId && !lastDeliveredMatchId) {
      return revision > 0 || !!data.teams;
    }

    return revision > lastDeliveredRevision;
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
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const timer = setTimeout(() => {
        console.warn("[SMAScore Sync] Firebase publish timed out; keeping local state");
        finish({
          ok: true,
          committed: true,
          offline: true,
          timeout: true,
          data: payload,
          revision: getRevision(payload),
        });
      }, 1200);

      ref.transaction(
        (current) => {
          const currentRevision = getRevision(current);
          const currentMatchId = getMatchId(current);
          const nextMatchId = getMatchId(payload);

          // 別試合への切替は baseRevision に関係なく書き込む
          if (nextMatchId && currentMatchId && nextMatchId !== currentMatchId) {
            return {
              ...payload,
              revision: 1,
              updatedAt: serverTimestamp(),
            };
          }

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
          clearTimeout(timer);
          if (error) {
            console.warn("[SMAScore Sync] Firebase transaction failed:", error.message || error);
            finish({ ok: false, committed: false, error });
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
              finish({
                ok: false,
                committed: false,
                conflict: true,
                remote,
                revision: getRevision(remote),
              });
            }).catch(() => {
              finish({ ok: false, committed: false, conflict: true });
            });
            return;
          }

          const data = snapshot.val();
          publishLocal(data);
          finish({
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

    // ネットワーク不通時に remove が永遠に pending にならないようタイムアウトする
    return Promise.race([
      ref.remove().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 1200)),
    ]);
  }

  function publish(state, options) {
    const baseRevision = options?.baseRevision ?? lastDeliveredRevision;
    const matchId = getMatchId(state);
    const isNewMatch =
      !!matchId && !!lastDeliveredMatchId && matchId !== lastDeliveredMatchId;

    const pendingRevision = isNewMatch ? 1 : baseRevision + 1;
    const payload = {
      ...state,
      revision: pendingRevision,
      updatedAt: Date.now(),
    };

    publishLocal(payload);
    lastDeliveredRevision = pendingRevision;
    if (matchId) lastDeliveredMatchId = matchId;

    const firebaseBase = isNewMatch ? 0 : baseRevision;

    return publishToFirebase(payload, firebaseBase).then((result) => {
      if (result.committed && result.data) {
        lastDeliveredRevision = getRevision(result.data);
        const committedMatchId = getMatchId(result.data);
        if (committedMatchId) lastDeliveredMatchId = committedMatchId;
        publishLocal(result.data);
        return result;
      }

      if (result.conflict && result.remote) {
        const remoteRevision = getRevision(result.remote);
        const remoteMatchId = getMatchId(result.remote);
        if (remoteMatchId && matchId && remoteMatchId !== matchId) {
          // 別試合の remote — ローカル新試合を優先保持
          return result;
        }
        if (remoteRevision >= pendingRevision) {
          lastDeliveredRevision = remoteRevision;
          if (remoteMatchId) lastDeliveredMatchId = remoteMatchId;
          publishLocal(result.remote);
        }
      } else if (!result.committed) {
        lastDeliveredRevision = Math.max(baseRevision, getRevision(readStored()));
      }

      return result;
    });
  }

  function deliver(callback, data) {
    if (!shouldAccept(data)) return false;

    const revision = getRevision(data);
    const matchId = getMatchId(data);

    lastDeliveredRevision = revision;
    if (matchId) lastDeliveredMatchId = matchId;

    writeStored(data);
    callback(data);
    return true;
  }

  function notifyCleared(callback) {
    resetDeliveryCursor();
    removeStored();
    try {
      callback(null);
    } catch {
      /* ignore subscriber errors */
    }
  }

  function subscribe(callback) {
    if (channel) {
      channel.onmessage = (event) => {
        if (event.data && event.data[CLEAR_SENTINEL]) {
          notifyCleared(callback);
          return;
        }
        deliver(callback, event.data);
      };
    }

    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY) return;
      if (!event.newValue) {
        // 削除イベント: UI も初期化し、次の新試合を受け入れる
        notifyCleared(callback);
        return;
      }
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
        if (!data) {
          // 一時的な null では UI を消さない（明示 clear は CLEAR_SENTINEL / storage 削除）
          resetDeliveryCursor();
          return;
        }
        deliver(callback, data);
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
    resetDeliveryCursor();
    removeStored();
    if (channel) {
      try {
        channel.postMessage({ [CLEAR_SENTINEL]: true });
      } catch {
        /* ignore */
      }
    }
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
    getMatchId,
    STORAGE_KEY,
  };
})();
