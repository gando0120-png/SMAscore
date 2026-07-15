/**
 * SMAScore — 試合設定の localStorage 管理
 */
(function () {
  const STORAGE_KEY = "smascore-match-config";

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

  window.SMAScoreMatchConfig = { STORAGE_KEY, save, load };
})();
