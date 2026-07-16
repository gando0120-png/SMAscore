/**
 * SMAScore — Firebase Realtime Database 設定・初期化
 * GitHub Pages 等の静的ホスティング向け（Firebase CDN compat SDK を使用）
 */
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyC04I6I1IwG2V_bac9JfSqX5g9S0r1SL9E",
    authDomain: "smascore-db366.firebaseapp.com",
    databaseURL: "https://smascore-db366-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "smascore-db366",
    storageBucket: "smascore-db366.firebasestorage.app",
    messagingSenderId: "444294233069",
    appId: "1:444294233069:web:aae2edcdaca1439aa685e4",
  };

  const REQUIRED_CONFIG_KEYS = [
    "apiKey",
    "authDomain",
    "databaseURL",
    "projectId",
    "storageBucket",
    "messagingSenderId",
    "appId",
  ];

  const ROOM_STORAGE_KEY = "smascore-room-id";

  let database = null;
  let connected = false;
  let initAttempted = false;

  function sanitizeRoomId(id) {
    const cleaned = String(id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
    return cleaned || "default";
  }

  function getRoomId() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("room");
    if (fromUrl) {
      try {
        localStorage.setItem(ROOM_STORAGE_KEY, sanitizeRoomId(fromUrl));
      } catch {
        /* ignore */
      }
      return sanitizeRoomId(fromUrl);
    }

    try {
      const stored = localStorage.getItem(ROOM_STORAGE_KEY);
      if (stored) return sanitizeRoomId(stored);
    } catch {
      /* ignore */
    }

    return "default";
  }

  function getMissingConfigKeys() {
    return REQUIRED_CONFIG_KEYS.filter((key) => {
      const value = firebaseConfig[key];
      return typeof value !== "string" || !value.trim();
    });
  }

  function init() {
    if (initAttempted) return !!database;
    initAttempted = true;

    if (typeof firebase === "undefined") {
      console.error(
        "[SMAScore Firebase] 初期化失敗: Firebase SDK が読み込まれていません。" +
          " firebase-app-compat.js → firebase-database-compat.js → firebase.js の順で読み込んでください。"
      );
      return false;
    }

    const missingKeys = getMissingConfigKeys();
    if (missingKeys.length > 0) {
      console.error(
        `[SMAScore Firebase] 初期化失敗: firebaseConfig の必須項目が未設定です (${missingKeys.join(", ")})`
      );
      return false;
    }

    try {
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
      database = firebase.database(app);

      database.ref(".info/connected").on("value", (snapshot) => {
        connected = snapshot.val() === true;
      });

      return true;
    } catch (error) {
      database = null;
      console.error("[SMAScore Firebase] 初期化失敗:", error?.message || error);
      return false;
    }
  }

  function getStateRef() {
    if (!database && !init()) return null;
    return database.ref(`rooms/${getRoomId()}/state`);
  }

  window.SMAScoreFirebase = {
    init,
    getRoomId,
    getStateRef,
    isAvailable() {
      return !!getStateRef();
    },
    isConnected() {
      return connected;
    },
  };

  init();
})();
