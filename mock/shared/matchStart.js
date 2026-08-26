/**
 * SMAScore — 試合開始・再試合ドラフト・初期 state 発行
 *
 * clear → config 保存 → 初期 state publish → control 遷移 の順序を保証する
 */
(function () {
  const DRAFT_KEY = "smascore-setup-draft";

  function defaultOverlaySettings() {
    return (
      window.SMAScoreOverlaySettings?.load() ?? {
        showTournament: true,
        showMatch: true,
        backgroundOpacity: "standard",
        scoreAnimation: true,
      }
    );
  }

  function buildInitialGameState(config, overlaySettings) {
    const teamCount = Number(config.teamCount) || 2;
    const teamNames = Array.isArray(config.teamNames) ? config.teamNames : [];
    const throwOrder = Array.from({ length: teamCount }, (_, index) => index);

    return {
      matchId: config.matchId,
      tournament: config.tournament || "",
      match: config.match || "",
      format: config.format || "win-2",
      teamCount,
      teams: Array.from({ length: teamCount }, (_, index) => ({
        name: teamNames[index] || `チーム ${index + 1}`,
        score: 0,
        total: 0,
        misses: 0,
        won: false,
        disqualified: false,
        setWins: 0,
      })),
      throwOrder,
      activeTeamIndex: 0,
      setStartTeamIndex: 0,
      currentSetNumber: 1,
      setEnded: false,
      setWinnerIndex: null,
      matchEnded: false,
      matchWinnerIndex: null,
      matchEndReason: null,
      pendingSelection: null,
      throwLog: [],
      setResults: [],
      overlayDisplayMode: "score",
      overlaySettings: overlaySettings || defaultOverlaySettings(),
    };
  }

  function saveDraft(draft) {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }

  function loadDraft() {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function clearDraft() {
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }

  async function clearGameState() {
    if (window.SMAScoreSync?.clear) {
      await SMAScoreSync.clear();
      return;
    }
    try {
      localStorage.removeItem("smascore-game-state");
    } catch {
      /* ignore */
    }
  }

  /**
   * 新しい試合を安全に開始する。
   * 1. clear
   * 2. config 保存（新 matchId）
   * 3. 初期 state を publish
   * @returns {Promise<object>} 保存した config
   */
  async function startNewMatch(config, options = {}) {
    const matchId =
      (typeof config.matchId === "string" && config.matchId.trim()) ||
      window.SMAScoreMatchConfig?.createMatchId?.() ||
      `match-${Date.now()}`;

    const fullConfig = {
      tournament: config.tournament || "",
      match: config.match || "",
      format: config.format || "win-2",
      teamCount: Number(config.teamCount) || 2,
      teamNames: Array.isArray(config.teamNames) ? [...config.teamNames] : [],
      matchId,
    };

    const overlaySettings = options.overlaySettings || defaultOverlaySettings();

    await clearGameState();

    window.SMAScoreMatchConfig?.save(fullConfig);
    if (options.overlaySettings) {
      window.SMAScoreOverlaySettings?.save(overlaySettings);
    }

    const initial = buildInitialGameState(fullConfig, overlaySettings);
    // 次試合開始時は必ず通常スコア表示（前試合 result を引き継がない）
    initial.overlayDisplayMode = "score";
    initial.matchEnded = false;
    initial.matchWinnerIndex = null;
    initial.setResults = [];
    initial.throwLog = [];

    if (window.SMAScoreSync?.publish) {
      const publishOnce = () =>
        Promise.race([
          SMAScoreSync.publish(initial, { baseRevision: 0 }),
          new Promise((resolve) =>
            setTimeout(() => resolve({ ok: false, committed: false, timeout: true }), 3000)
          ),
        ]);
      const result = await publishOnce();
      if (!result?.committed && result?.conflict) {
        // 衝突時も新 matchId で再送（score 固定を維持）
        initial.overlayDisplayMode = "score";
        await publishOnce();
      }
    } else {
      try {
        localStorage.setItem(
          "smascore-game-state",
          JSON.stringify({
            ...initial,
            overlayDisplayMode: "score",
            revision: 1,
            updatedAt: Date.now(),
          })
        );
      } catch {
        /* ignore */
      }
    }

    clearDraft();
    return fullConfig;
  }

  window.SMAScoreMatchStart = {
    DRAFT_KEY,
    buildInitialGameState,
    saveDraft,
    loadDraft,
    clearDraft,
    clearGameState,
    startNewMatch,
  };
})();
