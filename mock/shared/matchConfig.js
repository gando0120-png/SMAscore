/**
 * SMAScore — 試合設定の localStorage 管理
 */
(function () {
  const STORAGE_KEY = "smascore-match-config";

  function createMatchId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `match-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function save(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function formatToLabel(format) {
    if (!format) return "";

    const labels = {
      "win-2": "2勝先取",
      "win-3": "3勝先取",
      "win-4": "4勝先取",
      "win-5": "5勝先取",
      "game-2": "2ゲーム合計",
      "game-3": "3ゲーム合計",
      "game-4": "4ゲーム合計",
      "total-2": "2ゲーム合計",
      "total-3": "3ゲーム合計",
      "total-4": "4ゲーム合計",
    };

    return labels[format] ?? "";
  }

  window.SMAScoreMatchConfig = {
    STORAGE_KEY,
    save,
    load,
    formatToLabel,
    createMatchId,
  };
})();
