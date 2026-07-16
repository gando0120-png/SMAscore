/**
 * SMAScore — Overlay 表示設定の localStorage 管理
 */
(function () {
  const STORAGE_KEY = "smascore-overlay-settings";

  const OPACITY_VALUES = {
    low: 0.92,
    standard: 0.82,
    high: 0.62,
  };

  const DEFAULTS = {
    showTournament: true,
    showMatch: true,
    backgroundOpacity: "standard",
    scoreAnimation: true,
  };

  function normalize(settings) {
    const merged = { ...DEFAULTS, ...settings };
    if (!OPACITY_VALUES[merged.backgroundOpacity]) {
      merged.backgroundOpacity = DEFAULTS.backgroundOpacity;
    }
    return merged;
  }

  function save(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalize(settings)));
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULTS };
      return normalize(JSON.parse(raw));
    } catch {
      return { ...DEFAULTS };
    }
  }

  function getOpacityValue(preset) {
    return OPACITY_VALUES[preset] ?? OPACITY_VALUES.standard;
  }

  window.SMAScoreOverlaySettings = {
    STORAGE_KEY,
    DEFAULTS,
    OPACITY_VALUES,
    save,
    load,
    getOpacityValue,
  };
})();
