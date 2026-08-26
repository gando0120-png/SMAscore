/**
 * SMAScore — 試合履歴（現在試合 state とは分離）
 * localStorage: smascore-match-history
 * 現在の試合同期（Firebase rooms/.../state）を壊さないため、端末ローカル保存。
 */
(function () {
  const STORAGE_KEY = "smascore-match-history";
  const FOCUS_KEY = "smascore-history-focus-team";

  function readAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeAll(entries) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      /* ignore quota */
    }
  }

  function cloneSetResults(setResults) {
    return (setResults || []).map((result) => ({
      setNumber: result.setNumber,
      winnerTeamIndex: result.winnerTeamIndex ?? null,
      endReason: result.endReason || "normal",
      scores: (result.scores || []).map((score) => ({ ...score })),
    }));
  }

  /**
   * 試合終了スナップショットを upsert（matchId で重複防止）
   */
  function upsertMatchRecord(record) {
    if (!record || typeof record.matchId !== "string" || !record.matchId.trim()) {
      return { ok: false, reason: "missing-matchId" };
    }

    const matchId = record.matchId.trim();
    const list = readAll();
    const entry = {
      matchId,
      tournament: record.tournament || "",
      match: record.match || "",
      format: record.format || "",
      teamNames: Array.isArray(record.teamNames) ? [...record.teamNames] : [],
      playedAt: typeof record.playedAt === "number" ? record.playedAt : Date.now(),
      updatedAt: Date.now(),
      winnerTeamIndex:
        record.winnerTeamIndex === null || record.winnerTeamIndex === undefined
          ? null
          : Number(record.winnerTeamIndex),
      matchEndReason: record.matchEndReason || "normal",
      setResults: cloneSetResults(record.setResults),
      teams: Array.isArray(record.teams)
        ? record.teams.map((team) => ({
            name: team.name || "",
            setWins: Number(team.setWins) || 0,
            total: Number(team.total) || 0,
          }))
        : [],
    };

    const existing = list.findIndex((item) => item.matchId === matchId);
    if (existing >= 0) {
      entry.playedAt = list[existing].playedAt || entry.playedAt;
      list[existing] = entry;
    } else {
      list.unshift(entry);
    }

    writeAll(list);
    return { ok: true, entry, created: existing < 0 };
  }

  function getFocusTeamName() {
    try {
      return localStorage.getItem(FOCUS_KEY) || "";
    } catch {
      return "";
    }
  }

  function setFocusTeamName(name) {
    try {
      if (name) localStorage.setItem(FOCUS_KEY, name);
      else localStorage.removeItem(FOCUS_KEY);
    } catch {
      /* ignore */
    }
  }

  function collectTeamNames(entries) {
    const names = new Set();
    (entries || readAll()).forEach((entry) => {
      (entry.teamNames || []).forEach((name) => {
        if (name) names.add(name);
      });
      (entry.teams || []).forEach((team) => {
        if (team?.name) names.add(team.name);
      });
    });
    return [...names];
  }

  /**
   * 指定チームを「自チーム」として集計
   */
  function summarizeForTeam(teamName, entries) {
    const list = entries || readAll();
    const focus = String(teamName || "").trim();
    const empty = {
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      setsFor: 0,
      setsAgainst: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDiff: 0,
      setDiff: 0,
    };
    if (!focus) return empty;

    const stats = { ...empty };

    list.forEach((entry) => {
      const teams = entry.teams || [];
      const selfIndex = teams.findIndex((team) => team.name === focus);
      if (selfIndex < 0) return;

      stats.matches += 1;
      const self = teams[selfIndex];
      stats.setsFor += Number(self.setWins) || 0;
      stats.pointsFor += Number(self.total) || 0;

      teams.forEach((team, index) => {
        if (index === selfIndex) return;
        stats.setsAgainst += Number(team.setWins) || 0;
        stats.pointsAgainst += Number(team.total) || 0;
      });

      const winner = entry.winnerTeamIndex;
      if (winner === null || winner === undefined) {
        stats.draws += 1;
      } else if (Number(winner) === selfIndex) {
        stats.wins += 1;
      } else {
        stats.losses += 1;
      }
    });

    stats.pointDiff = stats.pointsFor - stats.pointsAgainst;
    stats.setDiff = stats.setsFor - stats.setsAgainst;
    return stats;
  }

  function endReasonLabel(reason) {
    if (reason === "time_limit") return "時間切れ";
    if (reason === "disqualification" || reason === "disqualified") return "失格";
    if (reason === "draw") return "引き分け";
    if (reason === "normal" || reason === "score") return "通常";
    return reason || "通常";
  }

  function matchEndReasonLabel(reason) {
    if (reason === "time_limit") return "時間切れ";
    if (reason === "disqualification" || reason === "disqualified") return "失格";
    return "通常";
  }

  window.SMAScoreMatchHistory = {
    STORAGE_KEY,
    FOCUS_KEY,
    readAll,
    upsertMatchRecord,
    getFocusTeamName,
    setFocusTeamName,
    collectTeamNames,
    summarizeForTeam,
    endReasonLabel,
    matchEndReasonLabel,
  };
})();
