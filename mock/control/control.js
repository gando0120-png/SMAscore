/**
 * SMAScore Control — 失格・セット/試合終了・修正モード・Firebase同期
 */
(function () {
  const ThrowOrder = window.SMAScoreThrowOrder;

  const inputDisplay = document.getElementById("inputDisplay");
  const teamNameEl = document.getElementById("teamName");
  const tournamentNameEl = document.getElementById("tournamentName");
  const matchNameEl = document.getElementById("matchName");
  const formatWrapEl = document.getElementById("formatWrap");
  const formatLabelEl = document.getElementById("formatLabel");
  const inputTeamBanner = document.getElementById("inputTeamBanner");
  const teamBoardEl = document.getElementById("teamBoard");
  const keypadEl = document.getElementById("keypad");
  const confirmBtn = document.getElementById("confirmBtn");
  const backBtn = document.getElementById("backBtn");
  const nextSetBtn = document.getElementById("nextSetBtn");
  const editModeBtn = document.getElementById("editModeBtn");
  const historyPanel = document.getElementById("historyPanel");
  const historyListEl = document.getElementById("historyList");
  const setScoreEl = document.getElementById("setScore");
  const keys = document.querySelectorAll("#keypad .key[data-value]");
  const editKeys = document.querySelectorAll("#editKeypad .key[data-value]");
  const settingsBtn = document.querySelector(".header__settings");
  const controlEl = document.querySelector(".control");
  const settingsModal = document.getElementById("settingsModal");
  const settingsBackdrop = document.getElementById("settingsBackdrop");
  const settingsCloseBtn = document.getElementById("settingsCloseBtn");
  const settingsCancelBtn = document.getElementById("settingsCancelBtn");
  const settingsForm = document.getElementById("settingsForm");
  const settingsNewMatchBtn = document.getElementById("settingsNewMatchBtn");
  const settingsTournamentInput = document.getElementById("settingsTournament");
  const settingsMatchInput = document.getElementById("settingsMatch");
  const settingsTeamNamesFieldset = document.getElementById("settingsTeamNames");
  const settingsShowTournamentInput = document.getElementById("settingsShowTournament");
  const settingsShowMatchInput = document.getElementById("settingsShowMatch");
  const settingsScoreAnimationInput = document.getElementById("settingsScoreAnimation");
  const throwOrderPanel = document.getElementById("throwOrderPanel");
  const throwOrderListEl = document.getElementById("throwOrderList");
  const matchResultPanel = document.getElementById("matchResultPanel");
  const matchResultTournament = document.getElementById("matchResultTournament");
  const matchResultMatch = document.getElementById("matchResultMatch");
  const matchResultWinner = document.getElementById("matchResultWinner");
  const matchResultSets = document.getElementById("matchResultSets");
  const matchResultSummary = document.getElementById("matchResultSummary");
  const rematchBtn = document.getElementById("rematchBtn");
  const newMatchBtn = document.getElementById("newMatchBtn");
  const matchResultStatus = document.getElementById("matchResultStatus");
  const matchResultTitle = document.getElementById("matchResultTitle");
  const matchResultEndReason = document.getElementById("matchResultEndReason");
  const showOverlayResultBtn = document.getElementById("showOverlayResultBtn");
  const hideOverlayResultBtn = document.getElementById("hideOverlayResultBtn");
  const forceEndMatchBtn = document.getElementById("forceEndMatchBtn");
  const forceEndWrap = document.getElementById("forceEndWrap");
  const settingsHistoryBtn = document.getElementById("settingsHistoryBtn");
  const historyModal = document.getElementById("historyModal");
  const historyBackdrop = document.getElementById("historyBackdrop");
  const historyCloseBtn = document.getElementById("historyCloseBtn");
  const historyFocusTeam = document.getElementById("historyFocusTeam");
  const historyStandings = document.getElementById("historyStandings");
  const matchHistoryList = document.getElementById("matchHistoryList");
  const matchHistoryDetail = document.getElementById("matchHistoryDetail");
  const inputViewEl = document.getElementById("inputView");
  const editViewEl = document.getElementById("editView");
  const editInputDisplay = document.getElementById("editInputDisplay");
  const editSummaryValue = document.getElementById("editSummaryValue");
  const editKeypadEl = document.getElementById("editKeypad");
  const cancelEditBtn = document.getElementById("cancelEditBtn");
  const editControlsEl = document.getElementById("editControls");
  const historyScrollEl = document.getElementById("historyScroll");
  const inputEditCursorEl = document.getElementById("inputEditCursor");
  const inputDisplayLabel = document.querySelector("#inputView .input-display__label");
  const editInputDisplayLabel = document.querySelector("#editView .input-display__label");

  const matchConfig = window.SMAScoreMatchConfig?.load();
  if (!matchConfig) {
    window.location.href = "../setup/";
    return;
  }

  const META = {
    tournament: matchConfig.tournament,
    match: matchConfig.match,
    format: matchConfig.format,
    teamCount: matchConfig.teamCount,
    matchId:
      typeof matchConfig.matchId === "string" && matchConfig.matchId.trim()
        ? matchConfig.matchId.trim()
        : window.SMAScoreMatchConfig?.createMatchId?.() ?? `match-${Date.now()}`,
  };

  // 旧設定に matchId が無い場合はここで補完して永続化
  if (!matchConfig.matchId) {
    window.SMAScoreMatchConfig?.save({
      ...matchConfig,
      matchId: META.matchId,
    });
  }

  const teams = matchConfig.teamNames.map((name) => ({
    name,
    score: 0,
    total: 0,
    misses: 0,
    won: false,
    disqualified: false,
    setWins: 0,
  }));

  let throwOrder = ThrowOrder.createDefault(teams.length);
  let activeTeamIndex = ThrowOrder.startIndexOf(throwOrder);
  let setStartTeamIndex = ThrowOrder.startIndexOf(throwOrder);
  let currentSetNumber = 1;
  let pendingSelection = null;
  let setEnded = false;
  let setWinnerIndex = null;
  let matchEnded = false;
  let matchWinnerIndex = null;
  /** 試合終了理由: null | "normal" | "time_limit" | "disqualification" */
  let matchEndReason = null;
  /** @type {Array<{setNumber:number,scores:Array<{teamIndex:number,score:number,disqualified:boolean}>,winnerTeamIndex:number|null,endReason:string}>} */
  let setResults = [];
  /** Overlay 表示モード: "score" = 通常スコア, "result" = 最終結果 */
  let overlayDisplayMode = "score";
  let selectedHistoryMatchId = null;
  const history = [];
  const throwLog = [];
  let matchTransitionBusy = false;

  /** "input" = 通常入力画面, "edit" = 修正画面 */
  let viewMode = "input";
  /** 過去投擲の修正カーソル。null = 最新地点（末尾追加モード） */
  let editCursor = null;
  let selectedEditIndex = null;
  let pendingEditSelection = null;
  let settingsOpen = false;
  let isApplyingRemote = false;
  let suppressPublish = true;
  let pendingPublish = false;
  let localRevision = 0;
  /** 折りたたみ中の過去セット番号 */
  const collapsedSets = new Set();

  const isEditMode = () => viewMode === "edit";

  function getEditableThrowIndices() {
    const indices = [];
    for (let i = 0; i < throwLog.length; i += 1) {
      if (!isOrderEntry(throwLog[i])) indices.push(i);
    }
    return indices;
  }

  function isEditingPast() {
    return editCursor !== null && editCursor >= 0 && editCursor < throwLog.length;
  }

  function clearEditCursor() {
    editCursor = null;
    selectedEditIndex = null;
    pendingEditSelection = null;
  }

  let overlaySettings = window.SMAScoreOverlaySettings?.load() ?? {
    showTournament: true,
    showMatch: true,
    backgroundOpacity: "standard",
    scoreAnimation: true,
  };

  function isOrderEntry(entry) {
    return entry?.kind === "order";
  }

  function normalizeSelection(selection) {
    if (selection === "miss" || selection === null || selection === undefined) {
      return 0;
    }
    return selection;
  }

  /**
   * 過去修正プレビュー用: throwLog の先頭〜cursor 直前だけを再生した一時状態。
   * 正式 state（teams / throwLog 等）は変更しない。
   */
  function simulateMatchFromLog(previewLog) {
    const simTeams = teams.map((team) => ({
      name: team.name,
      score: 0,
      total: 0,
      misses: 0,
      won: false,
      disqualified: false,
      setWins: 0,
    }));

    let simThrowOrder = ThrowOrder.createDefault(simTeams.length);
    let simSetStart = ThrowOrder.startIndexOf(simThrowOrder);
    let simActive = simSetStart;
    let simSetNumber = 1;
    let simSetEnded = false;
    let simSetWinnerIndex = null;
    let simMatchEnded = false;
    let simMatchWinnerIndex = null;
    const simSetResults = [];

    const simApplyFifty = (score) => (score > 50 ? 25 : score);
    const simNormalize = (selection) =>
      selection === "miss" || selection === null || selection === undefined ? 0 : selection;

    const simApplySelection = (team, selection) => {
      const value = simNormalize(selection);
      if (value >= 1 && value <= 12) {
        team.score = simApplyFifty(team.score + value);
        team.misses = 0;
        team.won = team.score === 50;
        return;
      }
      if (value === 0) {
        team.misses = Math.min(3, team.misses + 1);
        if (team.misses >= 3) {
          team.disqualified = true;
          team.score = 0;
          team.won = false;
        }
        return;
      }
      if (value === "F") {
        if (team.score >= 37) {
          team.score = 25;
          team.won = false;
        }
        team.misses = 0;
      }
    };

    const simRemaining = () =>
      simTeams.map((team, index) => (!team.disqualified ? index : -1)).filter((index) => index >= 0);

    const simNextActive = (fromIndex) =>
      ThrowOrder.getNextActiveIndex(simThrowOrder, fromIndex, simTeams);

    const simResolve = (teamIndex) => {
      const team = simTeams[teamIndex];
      if (team.disqualified) {
        if (simTeams.length === 2) {
          const winnerIndex = 1 - teamIndex;
          simTeams[winnerIndex].score = 50;
          simTeams[winnerIndex].won = true;
          return { setEnded: true, winnerIndex };
        }
        const remaining = simRemaining();
        if (remaining.length === 1) {
          simTeams[remaining[0]].score = 50;
          simTeams[remaining[0]].won = true;
          return { setEnded: true, winnerIndex: remaining[0] };
        }
        simActive = simNextActive(teamIndex);
        return { setEnded: false };
      }
      if (team.score === 50) {
        team.won = true;
        return { setEnded: true, winnerIndex: teamIndex };
      }
      simActive = simNextActive(teamIndex);
      return { setEnded: false };
    };

    const simRecordSet = (winnerIndex) => {
      const anyDq = simTeams.some((team) => team.disqualified);
      simSetResults.push({
        setNumber: simSetNumber,
        scores: simTeams.map((team, teamIndex) => ({
          teamIndex,
          score: team.disqualified ? 0 : team.score,
          disqualified: !!team.disqualified,
        })),
        winnerTeamIndex: winnerIndex,
        endReason: anyDq ? "disqualification" : "normal",
      });
      simTeams.forEach((team) => {
        team.total += team.disqualified ? 0 : team.score;
      });
    };

    const simBeginSet = () => {
      simSetStart = ThrowOrder.startIndexOf(simThrowOrder);
      simActive = simSetStart;
      simSetEnded = false;
      simSetWinnerIndex = null;
      simTeams.forEach((team) => {
        team.score = 0;
        team.misses = 0;
        team.won = false;
        team.disqualified = false;
      });
    };

    const simNextSet = (winnerIndex) => {
      const matchResult =
        window.SMAScoreMatchRules?.evaluateMatchEnd(simTeams, winnerIndex, META.format) ?? {
          ended: false,
          winnerIndex: null,
        };
      simTeams[winnerIndex].setWins += 1;
      if (matchResult.ended) {
        simMatchEnded = true;
        simMatchWinnerIndex = matchResult.winnerIndex;
        simSetEnded = false;
        simSetWinnerIndex = null;
        return;
      }
      simThrowOrder = ThrowOrder.rotateForNextSet(simThrowOrder);
      simSetNumber += 1;
      simBeginSet();
    };

    for (let i = 0; i < previewLog.length; i += 1) {
      const entry = previewLog[i];
      if (isOrderEntry(entry)) {
        if (Array.isArray(entry.throwOrder)) {
          simThrowOrder = ThrowOrder.normalize(entry.throwOrder, simTeams.length);
          simSetStart = ThrowOrder.startIndexOf(simThrowOrder);
        } else if (entry.setStartTeamIndex !== undefined && entry.setStartTeamIndex !== null) {
          simThrowOrder = ThrowOrder.fromStartIndex(simTeams.length, entry.setStartTeamIndex);
          simSetStart = ThrowOrder.startIndexOf(simThrowOrder);
        }
        simActive = entry.activeTeamIndex;
        continue;
      }

      simActive = entry.teamIndex;
      simApplySelection(simTeams[entry.teamIndex], entry.selection);
      const result = simResolve(entry.teamIndex);
      if (result.setEnded) {
        simSetEnded = true;
        simSetWinnerIndex = result.winnerIndex;
        simRecordSet(result.winnerIndex);
        // プレビューは「次セットへ」押下後の盤面も含める（ログに nextSet 自体は残らない）
        simNextSet(result.winnerIndex);
        if (simMatchEnded) break;
      }
    }

    return {
      teams: simTeams,
      throwOrder: simThrowOrder,
      activeTeamIndex: simActive,
      setStartTeamIndex: simSetStart,
      currentSetNumber: simSetNumber,
      setEnded: simSetEnded,
      setWinnerIndex: simSetWinnerIndex,
      matchEnded: simMatchEnded,
      matchWinnerIndex: simMatchWinnerIndex,
      matchEndReason: null,
      setResults: simSetResults,
      isPreview: true,
    };
  }

  function getPreviewCursorIndex() {
    if (isEditingPast()) return editCursor;
    if (
      isEditMode() &&
      selectedEditIndex !== null &&
      selectedEditIndex >= 0 &&
      selectedEditIndex < throwLog.length &&
      !isOrderEntry(throwLog[selectedEditIndex])
    ) {
      return selectedEditIndex;
    }
    return null;
  }

  function getViewState() {
    const cursor = getPreviewCursorIndex();
    if (cursor === null) {
      return {
        teams,
        throwOrder,
        activeTeamIndex,
        setStartTeamIndex,
        currentSetNumber,
        setEnded,
        setWinnerIndex,
        matchEnded,
        matchWinnerIndex,
        matchEndReason,
        setResults,
        isPreview: false,
      };
    }

    const preview = simulateMatchFromLog(throwLog.slice(0, cursor));
    const target = throwLog[cursor];
    if (target && !isOrderEntry(target) && typeof target.teamIndex === "number") {
      preview.activeTeamIndex = target.teamIndex;
    }
    return preview;
  }

  function shouldSuppressPublishForPreview() {
    return getPreviewCursorIndex() !== null;
  }

  function syncStartFromOrder() {
    setStartTeamIndex = ThrowOrder.startIndexOf(throwOrder);
  }

  function applyThrowOrder(nextOrder, options) {
    throwOrder = ThrowOrder.normalize(nextOrder, teams.length);
    syncStartFromOrder();
    if (options?.resetActive !== false) {
      activeTeamIndex = setStartTeamIndex;
    }
  }

  function cloneTeams() {
    return teams.map((team) => ({ ...team }));
  }

  function cloneThrowLog() {
    return throwLog.map((entry) => ({ ...entry }));
  }

  function cloneThrowOrder() {
    return [...throwOrder];
  }

  function cloneSetResults() {
    return setResults.map((result) => ({
      setNumber: result.setNumber,
      winnerTeamIndex: result.winnerTeamIndex ?? null,
      endReason: result.endReason || "normal",
      scores: (result.scores || []).map((score) => ({ ...score })),
    }));
  }

  function snapshot() {
    return {
      teams: cloneTeams(),
      throwOrder: cloneThrowOrder(),
      activeTeamIndex,
      setStartTeamIndex,
      currentSetNumber,
      setEnded,
      setWinnerIndex,
      matchEnded,
      matchWinnerIndex,
      matchEndReason,
      throwLog: cloneThrowLog(),
      setResults: cloneSetResults(),
    };
  }

  function restoreState(state) {
    teams.length = 0;
    state.teams.forEach((team) => teams.push({ ...team }));
    throwOrder = ThrowOrder.normalize(state.throwOrder, teams.length);
    if (!Array.isArray(state.throwOrder) && typeof state.setStartTeamIndex === "number") {
      throwOrder = ThrowOrder.fromStartIndex(teams.length, state.setStartTeamIndex);
    }
    activeTeamIndex = state.activeTeamIndex;
    setStartTeamIndex = ThrowOrder.startIndexOf(throwOrder);
    currentSetNumber = state.currentSetNumber || 1;
    setEnded = state.setEnded;
    setWinnerIndex = state.setWinnerIndex;
    matchEnded = !!state.matchEnded;
    matchWinnerIndex = state.matchWinnerIndex ?? null;
    matchEndReason = state.matchEndReason || null;
    throwLog.length = 0;
    state.throwLog.forEach((entry) => throwLog.push({ ...entry }));
    setResults = Array.isArray(state.setResults)
      ? state.setResults.map((result) => ({
          setNumber: result.setNumber,
          winnerTeamIndex: result.winnerTeamIndex ?? null,
          endReason: result.endReason || "normal",
          scores: (result.scores || []).map((score) => ({ ...score })),
        }))
      : [];
  }

  function buildSetResultEntry(winnerIndex, endReason) {
    const anyDq = teams.some((team) => team.disqualified);
    let reason = endReason;
    if (!reason) {
      reason = anyDq ? "disqualification" : "normal";
    }
    return {
      setNumber: currentSetNumber,
      scores: teams.map((team, teamIndex) => ({
        teamIndex,
        score: team.disqualified ? 0 : team.score,
        disqualified: !!team.disqualified,
      })),
      winnerTeamIndex: winnerIndex,
      endReason: reason,
    };
  }

  function recordSetResult(winnerIndex, endReason) {
    const entry = buildSetResultEntry(winnerIndex, endReason);
    const existing = setResults.findIndex((result) => result.setNumber === entry.setNumber);
    if (existing >= 0) {
      setResults[existing] = entry;
    } else {
      setResults.push(entry);
    }
  }

  function totalsFromSetResults() {
    const totals = teams.map(() => 0);
    setResults.forEach((result) => {
      (result.scores || []).forEach((row) => {
        if (row.teamIndex >= 0 && row.teamIndex < totals.length) {
          totals[row.teamIndex] += Number(row.score) || 0;
        }
      });
    });
    return totals;
  }

  function syncTotalsFromSetResults() {
    const totals = totalsFromSetResults();
    totals.forEach((total, index) => {
      if (teams[index]) teams[index].total = total;
    });
  }

  function getActiveTeam() {
    return teams[activeTeamIndex];
  }

  function getRemainingTeamIndices() {
    return teams.map((team, index) => (!team.disqualified ? index : -1)).filter((index) => index >= 0);
  }

  function getNextActiveIndex(fromIndex) {
    return ThrowOrder.getNextActiveIndex(throwOrder, fromIndex, teams);
  }

  function applyFiftyRule(score) {
    if (score > 50) {
      return 25;
    }
    return score;
  }

  function applySelection(team, selection) {
    const value = normalizeSelection(selection);

    if (value >= 1 && value <= 12) {
      team.score = applyFiftyRule(team.score + value);
      team.misses = 0;
      team.won = team.score === 50;
      return;
    }

    if (value === 0) {
      team.misses = Math.min(3, team.misses + 1);
      if (team.misses >= 3) {
        team.disqualified = true;
        team.score = 0;
        team.won = false;
      }
      return;
    }

    if (value === "F") {
      if (team.score >= 37) {
        team.score = 25;
        team.won = false;
      }
      team.misses = 0;
    }
  }

  function addCurrentScoresToTotals() {
    teams.forEach((team) => {
      const finalScore = team.disqualified ? 0 : team.score;
      team.total += finalScore;
    });
  }

  function setWinnerAtFifty(winnerIndex) {
    const winner = teams[winnerIndex];
    winner.score = 50;
    winner.won = true;
  }

  function resetSetScores() {
    teams.forEach((team) => {
      team.score = 0;
      team.misses = 0;
      team.won = false;
      team.disqualified = false;
    });
  }

  function rotateSetStartTeam() {
    applyThrowOrder(ThrowOrder.rotateForNextSet(throwOrder));
  }

  function beginSet() {
    syncStartFromOrder();
    activeTeamIndex = setStartTeamIndex;
    setEnded = false;
    setWinnerIndex = null;
    resetSetScores();
  }

  function countThrowsInSet(setNumber) {
    return throwLog.filter(
      (entry) => !isOrderEntry(entry) && (entry.setIndex || 1) === setNumber
    ).length;
  }

  function finishMatch(winnerIndex, reason) {
    matchEnded = true;
    matchWinnerIndex =
      winnerIndex === null || winnerIndex === undefined ? null : winnerIndex;
    setEnded = false;
    setWinnerIndex = null;
    pendingSelection = null;
    if (reason) {
      matchEndReason = reason;
    } else if (!matchEndReason) {
      matchEndReason = setResults.some((result) => result.endReason === "disqualification")
        ? "disqualification"
        : "normal";
    }
    persistMatchHistoryRecord();
  }

  function resolveMatchEndReason() {
    if (matchEndReason === "time_limit") return "time_limit";
    if (
      matchEndReason === "disqualification" ||
      setResults.some((result) => result.endReason === "disqualification")
    ) {
      return "disqualification";
    }
    return matchEndReason || "normal";
  }

  function persistMatchHistoryRecord() {
    if (!matchEnded || !META.matchId) return;
    const reason = resolveMatchEndReason();
    matchEndReason = reason;
    syncTotalsFromSetResults();
    window.SMAScoreMatchHistory?.upsertMatchRecord?.({
      matchId: META.matchId,
      tournament: META.tournament,
      match: META.match,
      format: META.format,
      teamNames: teams.map((team) => team.name),
      playedAt: Date.now(),
      winnerTeamIndex: matchWinnerIndex,
      matchEndReason: reason,
      setResults: cloneSetResults(),
      teams: teams.map((team) => ({
        name: team.name,
        setWins: team.setWins,
        total: team.total,
      })),
    });
  }

  function pickSetLeaderByCurrentScores() {
    let bestScore = -1;
    const leaders = [];
    teams.forEach((team, index) => {
      if (team.disqualified) return;
      const score = Number(team.score) || 0;
      if (score > bestScore) {
        bestScore = score;
        leaders.length = 0;
        leaders.push(index);
      } else if (score === bestScore) {
        leaders.push(index);
      }
    });
    if (leaders.length === 1) return leaders[0];
    return null;
  }

  function pickMatchWinnerFromStandings() {
    const maxWins = Math.max(...teams.map((team) => Number(team.setWins) || 0), 0);
    const setLeaders = teams
      .map((team, index) => ((Number(team.setWins) || 0) === maxWins ? index : -1))
      .filter((index) => index >= 0);
    if (setLeaders.length === 1) return setLeaders[0];

    const totals = totalsFromSetResults();
    const maxTotal = Math.max(...totals, 0);
    const totalLeaders = totals
      .map((total, index) => (total === maxTotal ? index : -1))
      .filter((index) => index >= 0);
    if (totalLeaders.length === 1) return totalLeaders[0];
    return null;
  }

  function restoreScoresFromLastSetResult() {
    if (!setResults.length) return;
    const last = setResults[setResults.length - 1];
    (last.scores || []).forEach((row) => {
      if (!teams[row.teamIndex]) return;
      teams[row.teamIndex].score = row.score;
      teams[row.teamIndex].disqualified = !!row.disqualified;
      teams[row.teamIndex].won = last.winnerTeamIndex === row.teamIndex;
      teams[row.teamIndex].misses = 0;
    });
    setEnded = false;
    setWinnerIndex = null;
  }

  function rebuildSetWinsFromResults() {
    teams.forEach((team) => {
      team.setWins = 0;
      team.won = false;
    });
    setResults.forEach((result) => {
      if (result.winnerTeamIndex === null || result.winnerTeamIndex === undefined) return;
      if (!teams[result.winnerTeamIndex]) return;
      teams[result.winnerTeamIndex].setWins += 1;
    });
    if (setResults.length) {
      const last = setResults[setResults.length - 1];
      if (last.winnerTeamIndex !== null && last.winnerTeamIndex !== undefined) {
        teams[last.winnerTeamIndex].won = true;
      }
    }
  }

  /**
   * 進行中セットを時間切れで確定し、試合を終了する（確認ダイアログなし）。
   * @param {{ betweenSets?: boolean }} options
   */
  function applyTimeLimitMatchEnd(options = {}) {
    const betweenSets = !!options.betweenSets;

    if (betweenSets) {
      // セット間終了: 空の次セットは残さない
      if (currentSetNumber > setResults.length) {
        currentSetNumber = Math.max(1, setResults.length);
      }
      rebuildSetWinsFromResults();
      syncTotalsFromSetResults();
      finishMatch(pickMatchWinnerFromStandings(), "time_limit");
      restoreScoresFromLastSetResult();
      return;
    }

    if (!setEnded) {
      const leader = pickSetLeaderByCurrentScores();
      const entry = {
        setNumber: currentSetNumber,
        scores: teams.map((team, teamIndex) => ({
          teamIndex,
          score: team.disqualified ? 0 : team.score,
          disqualified: !!team.disqualified,
        })),
        winnerTeamIndex: leader,
        endReason: "time_limit",
      };
      const existing = setResults.findIndex((result) => result.setNumber === entry.setNumber);
      if (existing >= 0) setResults[existing] = entry;
      else setResults.push(entry);
    }

    rebuildSetWinsFromResults();
    syncTotalsFromSetResults();
    finishMatch(pickMatchWinnerFromStandings(), "time_limit");
  }

  /**
   * 制限時間などによる強制試合終了。
   * 進行中セットを現在得点で確定し、試合を終了する。
   */
  function forceEndMatchByTimeLimit() {
    if (matchEnded || matchTransitionBusy || settingsOpen) return;
    if (isEditMode() || isEditingPast()) return;

    const ok = window.confirm("現在の得点で試合を終了しますか？");
    if (!ok) return;

    history.push(snapshot());
    applyTimeLimitMatchEnd({ betweenSets: !!setEnded });
    renderAll();
  }

  /**
   * 過去投擲修正後、時間切れ終了を再現する。
   * throwLog だけでは時間切れセットを復元できないため。
   */
  function reapplyTimeLimitAfterReplay(previousEndReason, previousSetResults) {
    if (previousEndReason !== "time_limit") return;
    if (matchEnded) return;

    const hadTimeLimitSet = (previousSetResults || []).some(
      (result) => result.endReason === "time_limit"
    );

    if (!hadTimeLimitSet) {
      // セット間での時間切れ終了を再現
      applyTimeLimitMatchEnd({ betweenSets: true });
      return;
    }

    // 進行中セットを時間切れで再確定（得点は replay 後の現在値）
    applyTimeLimitMatchEnd({ betweenSets: false });
  }

  function applyNextSetTransition(winnerIndex) {
    const matchResult = window.SMAScoreMatchRules?.evaluateMatchEnd(
      teams,
      winnerIndex,
      META.format
    ) ?? { ended: false, winnerIndex: null };

    teams[winnerIndex].setWins += 1;

    if (matchResult.ended) {
      finishMatch(matchResult.winnerIndex);
      return;
    }

    rotateSetStartTeam();
    currentSetNumber += 1;
    beginSet();
  }

  function resolveThrowDuringReplay(teamIndex) {
    const team = teams[teamIndex];

    if (team.disqualified) {
      if (teams.length === 2) {
        const winnerIndex = 1 - teamIndex;
        setWinnerAtFifty(winnerIndex);
        return { setEnded: true, winnerIndex };
      }

      const remaining = getRemainingTeamIndices();
      if (remaining.length === 1) {
        setWinnerAtFifty(remaining[0]);
        return { setEnded: true, winnerIndex: remaining[0] };
      }

      activeTeamIndex = getNextActiveIndex(teamIndex);
      return { setEnded: false };
    }

    if (team.score === 50) {
      team.won = true;
      return { setEnded: true, winnerIndex: teamIndex };
    }

    activeTeamIndex = getNextActiveIndex(teamIndex);
    return { setEnded: false };
  }

  function replayMatch() {
    const log = cloneThrowLog();
    const previousEndReason = matchEndReason;
    const previousSetResults = cloneSetResults();

    teams.forEach((team) => {
      team.score = 0;
      team.misses = 0;
      team.won = false;
      team.disqualified = false;
      team.total = 0;
      team.setWins = 0;
    });

    matchEnded = false;
    matchWinnerIndex = null;
    matchEndReason = null;
    currentSetNumber = 1;
    setResults = [];
    applyThrowOrder(ThrowOrder.createDefault(teams.length));
    beginSet();

    let setNumber = 1;
    let throwInSet = 0;
    let truncated = false;
    let droppedCount = 0;

    for (let i = 0; i < log.length; i += 1) {
      const entry = log[i];
      entry.setIndex = setNumber;

      if (isOrderEntry(entry)) {
        if (Array.isArray(entry.throwOrder)) {
          applyThrowOrder(entry.throwOrder, { resetActive: false });
        } else if (entry.setStartTeamIndex !== undefined && entry.setStartTeamIndex !== null) {
          applyThrowOrder(ThrowOrder.fromStartIndex(teams.length, entry.setStartTeamIndex), {
            resetActive: false,
          });
        }
        activeTeamIndex = entry.activeTeamIndex;
        entry.throwInSet = null;
        entry.setEnded = false;
        entry.setWinnerIndex = null;
        continue;
      }

      throwInSet += 1;
      entry.throwInSet = throwInSet;
      activeTeamIndex = entry.teamIndex;
      const team = teams[entry.teamIndex];

      applySelection(team, entry.selection);
      entry.scoreAfter = team.score;

      const result = resolveThrowDuringReplay(entry.teamIndex);

      if (result.setEnded) {
        setEnded = true;
        setWinnerIndex = result.winnerIndex;
        entry.setEnded = true;
        entry.setWinnerIndex = result.winnerIndex;
        recordSetResult(result.winnerIndex);
        addCurrentScoresToTotals();

        if (i < log.length - 1) {
          applyNextSetTransition(result.winnerIndex);
          if (matchEnded) {
            // 試合終了後の余剰ログは適用不能として切り捨て候補にする
            droppedCount = log.length - i - 1;
            truncated = droppedCount > 0;
            log.length = i + 1;
            break;
          }
          setNumber = currentSetNumber;
          throwInSet = 0;
        } else {
          // ログ末尾でセットが終わった場合も nextSet 相当で setWins / 試合終了を反映
          applyNextSetTransition(result.winnerIndex);
        }
      } else {
        entry.setEnded = false;
        entry.setWinnerIndex = null;
      }
    }

    if (!matchEnded && window.SMAScoreMatchRules) {
      const recomputed = SMAScoreMatchRules.recomputeMatchEnd(teams, META.format);
      matchEnded = recomputed.ended;
      matchWinnerIndex = recomputed.winnerIndex;
    }

    // 時間切れ終了は throwLog から復元できないため、必要なら再適用
    reapplyTimeLimitAfterReplay(previousEndReason, previousSetResults);

    // 試合終了後は進行中セット得点をリセット表示にしない（結果確認用に最終セット得点を残す）
    if (matchEnded && setResults.length) {
      const last = setResults[setResults.length - 1];
      (last.scores || []).forEach((row) => {
        if (!teams[row.teamIndex]) return;
        teams[row.teamIndex].score = row.score;
        teams[row.teamIndex].disqualified = !!row.disqualified;
        teams[row.teamIndex].won = last.winnerTeamIndex === row.teamIndex;
        teams[row.teamIndex].misses = 0;
      });
      setEnded = false;
      setWinnerIndex = null;
    } else if (!matchEnded) {
      // 試合が未終了に戻った場合は結果 Overlay を解除
      overlayDisplayMode = "score";
      matchEndReason = null;
    }

    if (matchEnded) {
      if (setResults.some((result) => result.endReason === "time_limit")) {
        matchEndReason = "time_limit";
      } else if (previousEndReason === "time_limit") {
        matchEndReason = "time_limit";
      } else if (setResults.some((result) => result.endReason === "disqualification")) {
        matchEndReason = "disqualification";
      } else {
        matchEndReason = "normal";
      }
      persistMatchHistoryRecord();
    }

    syncTotalsFromSetResults();

    throwLog.length = 0;
    log.forEach((entry) => throwLog.push({ ...entry }));
    currentSetNumber = setNumber;

    return { truncated, droppedCount };
  }

  function endSet(winnerIndex) {
    setEnded = true;
    setWinnerIndex = winnerIndex;
    if (teams[winnerIndex].score === 50) {
      teams[winnerIndex].won = true;
    }
    recordSetResult(winnerIndex);
    addCurrentScoresToTotals();
    pendingSelection = null;
  }

  function endSetByDisqualification(winnerIndex) {
    setWinnerAtFifty(winnerIndex);
    endSet(winnerIndex);
  }

  function handleDisqualification(dqTeamIndex) {
    if (teams.length === 2) {
      endSetByDisqualification(1 - dqTeamIndex);
      return;
    }

    const remaining = getRemainingTeamIndices();
    if (remaining.length === 1) {
      endSetByDisqualification(remaining[0]);
      return;
    }

    activeTeamIndex = getNextActiveIndex(activeTeamIndex);
  }

  function resolveAfterThrow(teamIndex) {
    const team = teams[teamIndex];

    if (team.disqualified) {
      handleDisqualification(teamIndex);
      return;
    }

    if (team.score === 50) {
      endSet(teamIndex);
      return;
    }

    activeTeamIndex = getNextActiveIndex(activeTeamIndex);
  }

  function formatSelection(selection) {
    if (selection === "F") return "F";
    if (selection === 0 || selection === "miss") return "0";
    return String(selection);
  }

  function formatHistoryEntry(entry) {
    if (isOrderEntry(entry)) {
      const name = teams[entry.activeTeamIndex]?.name ?? `チーム ${entry.activeTeamIndex + 1}`;
      return { teamName: name, input: "順序", score: "→" };
    }

    return {
      teamName: teams[entry.teamIndex]?.name ?? `チーム ${entry.teamIndex + 1}`,
      input: formatSelection(entry.selection),
      score: entry.scoreAfter ?? "-",
    };
  }

  function renderMissDots(misses, disqualified) {
    const count = disqualified ? 3 : misses;

    return [0, 1, 2]
      .map((i) => {
        const on = i < count ? " team-card__miss--on" : "";
        return `<span class="team-card__miss${on}" aria-hidden="true">×</span>`;
      })
      .join("");
  }

  function renderSetHeader() {
    if (!setScoreEl) return;
    const view = getViewState();

    const divider = view.teams.length === 2
      ? '<span class="header__set-divider">-</span>'
      : '<span class="header__set-divider header__set-divider--bar">|</span>';

    setScoreEl.innerHTML = view.throwOrder
      .map((teamIndex, position) => {
        const team = view.teams[teamIndex];
        const name = team?.name ?? `チーム ${teamIndex + 1}`;
        const wins = team?.setWins ?? 0;
        const item = `
          <span class="header__set-item header__set-item--color-${teamIndex}">
            <span class="header__set-team">${name}</span>
            <span class="header__set-num">${wins}</span>
            <span class="header__set-unit">セット</span>
          </span>
        `;
        return position === 0 ? item : `${divider}${item}`;
      })
      .join("");
  }

  function renderMetaHeader() {
    tournamentNameEl.textContent = META.tournament;
    matchNameEl.textContent = META.match;

    const formatLabel = window.SMAScoreMatchConfig?.formatToLabel(META.format) ?? "";
    if (formatLabel) {
      formatWrapEl.hidden = false;
      formatLabelEl.textContent = formatLabel;
    } else {
      formatWrapEl.hidden = true;
      formatLabelEl.textContent = "";
    }
  }

  function renderTeamBoard() {
    const view = getViewState();
    teamBoardEl.className = `team-board team-board--count-${view.teams.length}`;

    teamBoardEl.innerHTML = view.throwOrder
      .map((teamIndex) => {
        const team = view.teams[teamIndex];
        const isActive =
          !isEditMode() && !view.setEnded && !view.matchEnded && teamIndex === view.activeTeamIndex;
        const isSetWinner = view.setEnded && teamIndex === view.setWinnerIndex;
        const isMatchWinner = view.matchEnded && teamIndex === view.matchWinnerIndex;
        const victoryClass =
          team.won && !view.setEnded && !view.matchEnded ? " team-card__score--victory" : "";
        const dqBadge = team.disqualified
          ? '<span class="team-card__badge">失格</span>'
          : "<span></span>";

        return `
          <article class="team-card team-card--color-${teamIndex}${isActive ? " team-card--active" : ""}${team.disqualified ? " team-card--disqualified" : ""}${isSetWinner ? " team-card--set-winner" : ""}${isMatchWinner ? " team-card--match-winner" : ""}" data-team-index="${teamIndex}" aria-label="${team.name}">
            <div class="team-card__meta">
              <p class="team-card__name">${team.name}</p>
              ${dqBadge}
            </div>
            <div class="team-card__score-row">
              <span class="team-card__score${victoryClass}">${team.score}</span>
              <span class="team-card__total">T <span class="team-card__total-num">${team.total}</span></span>
            </div>
            <div class="team-card__meta">
              <p class="team-card__misses" aria-label="連続ミス">${renderMissDots(team.misses, team.disqualified)}</p>
              <span class="team-card__set-wins">SET <span class="team-card__set-wins-num">${team.setWins}</span></span>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderThrowOrderPanel() {
    if (!throwOrderPanel || !throwOrderListEl) return;
    const view = getViewState();
    const pastPreview = shouldSuppressPublishForPreview();

    const blocked = view.matchEnded || view.setEnded || isEditMode() || settingsOpen;
    throwOrderPanel.hidden = blocked;
    if (blocked) return;

    throwOrderListEl.innerHTML = view.throwOrder
      .map((teamIndex, position) => {
        const team = view.teams[teamIndex];
        const atFirst = position === 0;
        const atLast = position === view.throwOrder.length - 1;
        const disabled = pastPreview || atFirst;
        const disabledRight = pastPreview || atLast;
        return `
          <div class="throw-order__row throw-order__row--color-${teamIndex}" data-team-index="${teamIndex}">
            <span class="throw-order__pos">${position + 1}</span>
            <span class="throw-order__name">${team.name}</span>
            <div class="throw-order__actions">
              <button type="button" class="throw-order__btn" data-action="front" ${disabled ? "disabled" : ""}>先頭</button>
              <button type="button" class="throw-order__btn" data-action="left" ${disabled ? "disabled" : ""}>←</button>
              <button type="button" class="throw-order__btn" data-action="right" ${disabledRight ? "disabled" : ""}>→</button>
            </div>
          </div>
        `;
      })
      .join("");

    if (pastPreview) return;

    throwOrderListEl.querySelectorAll(".throw-order__btn").forEach((button) => {
      button.addEventListener("click", () => {
        const row = button.closest("[data-team-index]");
        const teamIndex = Number(row?.dataset.teamIndex);
        const action = button.dataset.action;
        if (Number.isNaN(teamIndex) || !action) return;
        changeThrowOrderByAction(teamIndex, action);
      });
    });
  }

  function buildHistoryGroups() {
    const groups = [];
    let current = {
      setNumber: 1,
      winnerIndex: null,
      closed: false,
      entries: [],
    };

    throwLog.forEach((entry, index) => {
      const setIndex = entry.setIndex || current.setNumber;
      if (setIndex !== current.setNumber) {
        if (current.entries.length > 0 || current.closed) {
          groups.push(current);
        }
        current = {
          setNumber: setIndex,
          winnerIndex: null,
          closed: false,
          entries: [],
        };
      }

      current.entries.push({ index, entry });

      if (entry.setEnded) {
        current.winnerIndex = entry.setWinnerIndex ?? null;
        current.closed = true;
        groups.push(current);
        current = {
          setNumber: setIndex + 1,
          winnerIndex: null,
          closed: false,
          entries: [],
        };
      }
    });

    if (!current.closed) {
      groups.push(current);
    }

    if (groups.length === 0) {
      groups.push({
        setNumber: currentSetNumber || 1,
        winnerIndex: null,
        closed: false,
        entries: [],
      });
    }

    return groups;
  }

  function renderHistoryList() {
    if (!isEditMode()) {
      historyListEl.innerHTML = "";
      return;
    }

    const groups = buildHistoryGroups();
    if (groups.every((group) => group.entries.length === 0)) {
      historyListEl.innerHTML = '<p class="history-list__empty">履歴がありません</p>';
      return;
    }

    historyListEl.innerHTML = groups
      .map((group) => {
        const isCurrent = !group.closed;
        const winnerName =
          group.winnerIndex !== null && group.winnerIndex !== undefined
            ? teams[group.winnerIndex]?.name ?? `チーム ${group.winnerIndex + 1}`
            : null;
        const meta = isCurrent
          ? "現在進行中"
          : winnerName
            ? `${winnerName}勝利`
            : "セット終了";
        const collapsed = !isCurrent && collapsedSets.has(group.setNumber);
        const items = group.entries
          .map(({ index, entry }) => {
            const formatted = formatHistoryEntry(entry);
            const selected = index === selectedEditIndex ? " history-item--selected" : "";
            const orderClass = isOrderEntry(entry) ? " history-item--order" : "";
            const throwLabel = isOrderEntry(entry)
              ? "順序"
              : `${entry.throwInSet || "-"}投目`;
            return `
              <button type="button" class="history-item${selected}${orderClass}" data-index="${index}">
                <span class="history-item__num">${throwLabel}</span>
                <span class="history-item__team">${formatted.teamName}</span>
                <span class="history-item__input">${formatted.input}</span>
                <span class="history-item__score">${formatted.score}</span>
              </button>
            `;
          })
          .join("");

        return `
          <section class="history-set${collapsed ? " history-set--collapsed" : ""}${isCurrent ? " history-set--current" : ""}" data-set-number="${group.setNumber}">
            <button type="button" class="history-set__header" data-set-toggle="${group.setNumber}">
              <span class="history-set__title">セット${group.setNumber}</span>
              <span class="history-set__meta">${meta}${collapsed ? " ▸" : " ▾"}</span>
            </button>
            <div class="history-set__body">${items || '<p class="history-list__empty">投擲なし</p>'}</div>
          </section>
        `;
      })
      .join("");

    historyListEl.querySelectorAll("[data-set-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const setNumber = Number(button.dataset.setToggle);
        if (collapsedSets.has(setNumber)) collapsedSets.delete(setNumber);
        else collapsedSets.add(setNumber);
        renderHistoryList();
      });
    });

    historyListEl.querySelectorAll(".history-item").forEach((button) => {
      button.addEventListener("click", () => {
        selectedEditIndex = Number(button.dataset.index);
        pendingEditSelection = null;
        if (!isOrderEntry(throwLog[selectedEditIndex])) {
          editCursor = selectedEditIndex;
          pendingSelection = throwLog[selectedEditIndex]?.selection ?? null;
        }
        renderAll();
        // 選択後にキーパッドが見えるよう、選択項目をスクロール位置に寄せる
        requestAnimationFrame(() => {
          button.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
      });
    });
  }

  function renderInputTeamBanner() {
    const view = getViewState();
    if (view.setEnded || view.matchEnded || isEditMode()) {
      inputTeamBanner.classList.add("input-team--hidden");
      return;
    }

    inputTeamBanner.classList.remove("input-team--hidden");
    const colorIndex = view.activeTeamIndex % 4;
    inputTeamBanner.className = `input-team input-team--color-${colorIndex}`;
    teamNameEl.textContent = view.teams[view.activeTeamIndex]?.name ?? "";
  }

  function selectionToKeyValue(selection) {
    if (selection === "F") return "F";
    if (selection === "miss") return "miss";
    if (selection === 0) return "0";
    if (selection === null || selection === undefined) return null;
    return String(selection);
  }

  function renderKeySelection(keyNodeList, selection) {
    const selectedValue = selectionToKeyValue(selection);
    keyNodeList.forEach((key) => {
      key.classList.toggle("key--selected", selectedValue !== null && key.dataset.value === selectedValue);
    });
  }

  function renderEditSummary() {
    if (!editSummaryValue) return;

    if (selectedEditIndex === null) {
      editSummaryValue.textContent = "履歴から投擲を選択";
      return;
    }

    const entry = throwLog[selectedEditIndex];
    if (!entry) {
      editSummaryValue.textContent = "履歴から投擲を選択";
      return;
    }

    if (isOrderEntry(entry)) {
      const name = teams[entry.activeTeamIndex]?.name ?? `チーム ${entry.activeTeamIndex + 1}`;
      editSummaryValue.textContent = `セット${entry.setIndex || "?"} / 順序変更 → ${name}`;
      return;
    }

    const name = teams[entry.teamIndex]?.name ?? `チーム ${entry.teamIndex + 1}`;
    const current = pendingEditSelection !== null ? pendingEditSelection : entry.selection;
    editSummaryValue.textContent = `セット${entry.setIndex || "?"} / ${entry.throwInSet || "?"}投目 / ${name} / 現在 ${formatSelection(current)}`;
  }

  function renderInputDisplay() {
    inputDisplay.classList.remove(
      "input-display__value--waiting",
      "input-display__value--entered",
      "input-display__value--foul",
      "input-display__value--set-end",
      "input-display__value--match-end",
      "input-display__value--edit"
    );

    if (inputDisplayLabel) inputDisplayLabel.textContent = isEditingPast() ? "修正入力" : "現在入力";

    if (inputEditCursorEl) {
      if (isEditingPast()) {
        const entry = throwLog[editCursor];
        const indices = getEditableThrowIndices();
        const pos = indices.indexOf(editCursor);
        const fromEnd = pos >= 0 ? indices.length - pos : 1;
        const setLabel = entry?.setIndex ? `セット${entry.setIndex}` : "";
        const throwLabel = entry?.throwInSet ? `${entry.throwInSet}投目` : "";
        const detail = [setLabel, throwLabel].filter(Boolean).join("・");
        inputEditCursorEl.hidden = false;
        inputEditCursorEl.textContent = detail
          ? `${fromEnd}投前を修正中（${detail}）`
          : `${fromEnd}投前を修正中`;
      } else {
        inputEditCursorEl.hidden = true;
        inputEditCursorEl.textContent = "";
      }
    }

    if (matchEnded && !isEditingPast()) {
      inputDisplay.textContent = "試合終了";
      inputDisplay.classList.add("input-display__value--match-end");
      return;
    }

    if (setEnded && !isEditingPast()) {
      inputDisplay.textContent = "セット終了";
      inputDisplay.classList.add("input-display__value--set-end");
      return;
    }

    if (pendingSelection === null) {
      inputDisplay.textContent = "入力待ち";
      inputDisplay.classList.add("input-display__value--waiting");
    } else if (pendingSelection === "F") {
      inputDisplay.textContent = "F";
      inputDisplay.classList.add("input-display__value--foul");
    } else if (pendingSelection === "miss" || pendingSelection === 0) {
      inputDisplay.textContent = "0";
      inputDisplay.classList.add("input-display__value--entered");
    } else {
      inputDisplay.textContent = String(pendingSelection);
      inputDisplay.classList.add("input-display__value--entered");
    }
  }

  function renderEditInputDisplay() {
    if (!editInputDisplay) return;

    editInputDisplay.classList.remove(
      "input-display__value--waiting",
      "input-display__value--entered",
      "input-display__value--foul",
      "input-display__value--edit"
    );

    if (editInputDisplayLabel) editInputDisplayLabel.textContent = "修正入力";

    if (selectedEditIndex === null) {
      editInputDisplay.textContent = "履歴を選択";
      editInputDisplay.classList.add("input-display__value--edit");
      return;
    }

    if (isOrderEntry(throwLog[selectedEditIndex])) {
      editInputDisplay.textContent = "順序変更は修正不可";
      editInputDisplay.classList.add("input-display__value--edit");
      return;
    }

    if (pendingEditSelection === null) {
      editInputDisplay.textContent = formatSelection(throwLog[selectedEditIndex].selection);
      editInputDisplay.classList.add("input-display__value--entered");
      return;
    }

    if (pendingEditSelection === "F") {
      editInputDisplay.textContent = "F";
      editInputDisplay.classList.add("input-display__value--foul");
    } else {
      editInputDisplay.textContent = formatSelection(pendingEditSelection);
      editInputDisplay.classList.add("input-display__value--entered");
    }
  }

  function normalizeOverlayDisplayMode(mode) {
    return mode === "result" ? "result" : "score";
  }

  function setOverlayDisplayMode(mode) {
    const next = normalizeOverlayDisplayMode(mode);
    if (overlayDisplayMode === next) {
      renderMatchResultPanel();
      return;
    }
    overlayDisplayMode = next;
    renderMatchResultPanel();
    if (!shouldSuppressPublishForPreview()) {
      publishSync();
    }
  }

  function showOverlayResult() {
    if (!matchEnded || matchTransitionBusy) return;
    setOverlayDisplayMode("result");
  }

  function hideOverlayResult() {
    if (matchTransitionBusy) return;
    setOverlayDisplayMode("score");
  }

  function endReasonLabel(reason) {
    if (reason === "disqualification" || reason === "disqualified") return "3連続ミスによる失格";
    if (reason === "time_limit") return "時間切れ";
    if (reason === "draw") return "引き分け";
    if (reason === "normal" || reason === "score") return "";
    return "";
  }

  function matchEndReasonLabel(reason) {
    if (reason === "time_limit") return "時間切れ終了";
    if (reason === "disqualification" || reason === "disqualified") return "失格による終了";
    return "";
  }

  function renderMatchResultPanel() {
    if (!matchResultPanel) return;
    const view = getViewState();

    const showResult = view.matchEnded && !isEditMode() && !isEditingPast();
    matchResultPanel.hidden = !showResult;
    controlEl.classList.toggle("control--match-result", showResult);
    if (!showResult) return;

    const endReason = view.matchEndReason || matchEndReason || resolveMatchEndReason();
    if (matchResultTitle) {
      matchResultTitle.textContent =
        endReason === "time_limit" ? "試合終了（時間切れ）" : "試合終了";
    }
    if (matchResultEndReason) {
      const label = matchEndReasonLabel(endReason);
      matchResultEndReason.hidden = !label;
      matchResultEndReason.textContent = label;
    }

    if (matchResultTournament) matchResultTournament.textContent = META.tournament || "—";
    if (matchResultMatch) matchResultMatch.textContent = META.match || "—";

    const winnerName =
      view.matchWinnerIndex !== null && view.matchWinnerIndex !== undefined
        ? view.teams[view.matchWinnerIndex]?.name ?? `チーム ${view.matchWinnerIndex + 1}`
        : "引き分け";
    if (matchResultWinner) {
      matchResultWinner.textContent =
        view.matchWinnerIndex === null || view.matchWinnerIndex === undefined
          ? "勝者：引き分け"
          : `勝者：${winnerName}`;
    }

    if (matchResultSets) {
      if (!view.setResults.length) {
        matchResultSets.innerHTML = '<p class="match-result__empty">セット結果がありません</p>';
      } else {
        matchResultSets.innerHTML = view.setResults
          .map((result) => {
            const rows = (result.scores || [])
              .map((row) => {
                const name = view.teams[row.teamIndex]?.name ?? `チーム ${row.teamIndex + 1}`;
                const winnerClass =
                  result.winnerTeamIndex === row.teamIndex ? " match-result__set-row--winner" : "";
                const dq = row.disqualified ? "（失格）" : "";
                return `<div class="match-result__set-row${winnerClass}"><span>${name}</span><span>${row.score}点${dq}</span></div>`;
              })
              .join("");
            const reason = endReasonLabel(result.endReason);
            return `
              <article class="match-result__set">
                <h3 class="match-result__set-title">セット${result.setNumber}</h3>
                ${rows}
                ${reason ? `<p class="match-result__set-reason">${reason}</p>` : ""}
              </article>
            `;
          })
          .join("");
      }
    }

    if (matchResultSummary) {
      const totals = view.teams.map((team, index) => {
        return (view.setResults || []).reduce((sum, result) => {
          const row = (result.scores || []).find((score) => score.teamIndex === index);
          return sum + (row?.score || 0);
        }, 0) || team.total;
      });
      const setWinsRows = view.teams
        .map((team) => `<div class="match-result__set-row"><span>${team.name}</span><span>${team.setWins}</span></div>`)
        .join("");
      const totalRows = view.teams
        .map((team, index) => `<div class="match-result__set-row"><span>${team.name}</span><span>${totals[index] ?? team.total}点</span></div>`)
        .join("");
      matchResultSummary.innerHTML = `
        <div class="match-result__summary-block">
          <h3>獲得セット</h3>
          ${setWinsRows}
        </div>
        <div class="match-result__summary-block">
          <h3>合計得点</h3>
          ${totalRows}
        </div>
      `;
    }

    if (matchResultStatus) {
      matchResultStatus.hidden = !matchTransitionBusy;
      matchResultStatus.textContent = matchTransitionBusy ? "準備中…" : "";
    }
    if (rematchBtn) {
      rematchBtn.disabled = matchTransitionBusy;
      rematchBtn.textContent = matchTransitionBusy ? "準備中…" : "同じ試合をもう一度";
    }
    if (newMatchBtn) {
      newMatchBtn.disabled = matchTransitionBusy;
      newMatchBtn.textContent = matchTransitionBusy ? "準備中…" : "新しい試合";
    }

    const showingResult = overlayDisplayMode === "result";
    if (showOverlayResultBtn) {
      showOverlayResultBtn.disabled = matchTransitionBusy || showingResult;
      showOverlayResultBtn.classList.toggle("match-result__btn--active", showingResult);
      showOverlayResultBtn.setAttribute("aria-pressed", showingResult ? "true" : "false");
    }
    if (hideOverlayResultBtn) {
      hideOverlayResultBtn.disabled = matchTransitionBusy || !showingResult;
      hideOverlayResultBtn.classList.toggle("match-result__btn--active", !showingResult);
      hideOverlayResultBtn.setAttribute("aria-pressed", showingResult ? "false" : "true");
    }
  }

  function renderForceEndButton() {
    if (!forceEndWrap || !forceEndMatchBtn) return;
    const show =
      !matchEnded &&
      !isEditMode() &&
      !isEditingPast() &&
      !settingsOpen &&
      !matchTransitionBusy;
    forceEndWrap.hidden = !show;
    forceEndMatchBtn.disabled = !show;
  }

  function renderViewMode() {
    const editing = isEditMode();
    const pastEditing = isEditingPast();
    controlEl.classList.toggle("control--edit-mode", editing);
    controlEl.classList.toggle("control--input-mode", !editing);
    controlEl.classList.toggle("control--past-edit", pastEditing && !editing);
    controlEl.classList.toggle("control--teams-2", teams.length === 2);
    controlEl.classList.toggle("control--teams-3", teams.length === 3);
    controlEl.classList.toggle("control--teams-4", teams.length >= 4);

    if (inputViewEl) inputViewEl.hidden = editing;
    if (editViewEl) editViewEl.hidden = !editing;

    editModeBtn.textContent = editing ? "通常入力へ" : "修正画面へ";
    editModeBtn.classList.toggle("action--edit-on", editing);
  }

  function renderControls() {
    renderViewMode();

    const editing = isEditMode();
    const pastEditing = isEditingPast();
    const orderEntry =
      selectedEditIndex !== null && isOrderEntry(throwLog[selectedEditIndex]);
    const editableIndices = getEditableThrowIndices();
    const atFirstEditable =
      pastEditing && editableIndices.length > 0 && editableIndices[0] === editCursor;

    historyPanel?.toggleAttribute?.("hidden", false);

    if (editControlsEl) {
      editControlsEl.hidden = !editing || selectedEditIndex === null;
    }

    keypadEl.classList.toggle(
      "keypad--disabled",
      (!pastEditing && (setEnded || matchEnded)) || settingsOpen
    );
    editKeypadEl?.classList.toggle(
      "keypad--disabled",
      settingsOpen || selectedEditIndex === null || orderEntry
    );

    editModeBtn.hidden = pastEditing && !editing;
    // 試合終了後も結果修正できるようにする
    editModeBtn.disabled = settingsOpen || matchTransitionBusy;

    backBtn.hidden = editing;
    cancelEditBtn.hidden = !(editing || pastEditing);
    cancelEditBtn.disabled =
      settingsOpen || (editing && selectedEditIndex === null && !pastEditing);
    if (pastEditing && !editing) {
      // スマホ幅向けに2行表示（中央「戻る」位置は維持）
      cancelEditBtn.innerHTML = "最新の入力へ<br>戻る";
    } else {
      cancelEditBtn.textContent = "修正をやめる";
    }

    if (editing) {
      nextSetBtn.hidden = true;
      confirmBtn.hidden = false;
      confirmBtn.textContent = "修正確定";
      confirmBtn.disabled =
        settingsOpen || selectedEditIndex === null || orderEntry || pendingEditSelection === null;
    } else if (pastEditing) {
      nextSetBtn.hidden = true;
      confirmBtn.hidden = false;
      confirmBtn.textContent = "決定";
      confirmBtn.disabled = settingsOpen || pendingSelection === null;
    } else {
      confirmBtn.hidden = setEnded || matchEnded;
      confirmBtn.disabled = settingsOpen || setEnded || matchEnded || pendingSelection === null;
      confirmBtn.textContent = "決定";
      nextSetBtn.hidden = !setEnded || matchEnded;
      nextSetBtn.disabled = settingsOpen || matchEnded;
    }

    backBtn.disabled =
      editing || settingsOpen || editableIndices.length === 0 || atFirstEditable;
    renderThrowOrderPanel();
    renderForceEndButton();
    renderKeySelection(keys, editing ? null : pendingSelection);
    renderKeySelection(editKeys, editing ? pendingEditSelection : null);
  }

  function renderSettingsTeamFields() {
    settingsTeamNamesFieldset.innerHTML = '<legend class="settings-fieldset__legend">チーム名</legend>';

    teams.forEach((team, index) => {
      const field = document.createElement("div");
      field.className = "settings-field";
      field.innerHTML = `
        <label class="settings-field__label" for="settingsTeam${index}">チーム ${index + 1}</label>
        <input class="settings-field__input" type="text" id="settingsTeam${index}" autocomplete="off">
      `;
      field.querySelector("input").value = team.name;
      settingsTeamNamesFieldset.appendChild(field);
    });
  }

  function populateSettingsForm() {
    settingsTournamentInput.value = META.tournament;
    settingsMatchInput.value = META.match;
    renderSettingsTeamFields();
    settingsShowTournamentInput.checked = overlaySettings.showTournament;
    settingsShowMatchInput.checked = overlaySettings.showMatch;
    settingsScoreAnimationInput.checked = overlaySettings.scoreAnimation;

    settingsForm
      .querySelectorAll('input[name="backgroundOpacity"]')
      .forEach((input) => {
        input.checked = input.value === overlaySettings.backgroundOpacity;
      });
  }

  function openSettings() {
    settingsOpen = true;
    populateSettingsForm();
    settingsModal.hidden = false;
    controlEl.classList.add("control--settings-open");
    renderControls();
  }

  function closeSettings() {
    settingsOpen = false;
    settingsModal.hidden = true;
    controlEl.classList.remove("control--settings-open");
    renderControls();
  }

  function readSettingsForm() {
    const backgroundOpacity =
      settingsForm.querySelector('input[name="backgroundOpacity"]:checked')?.value ?? "standard";

    const teamNames = teams.map((_, index) => {
      const input = document.getElementById(`settingsTeam${index}`);
      const value = input?.value.trim();
      return value || `チーム ${index + 1}`;
    });

    return {
      tournament: settingsTournamentInput.value.trim(),
      match: settingsMatchInput.value.trim(),
      teamNames,
      overlaySettings: {
        showTournament: settingsShowTournamentInput.checked,
        showMatch: settingsShowMatchInput.checked,
        backgroundOpacity,
        scoreAnimation: settingsScoreAnimationInput.checked,
      },
    };
  }

  function saveSettings(event) {
    event.preventDefault();

    const data = readSettingsForm();

    META.tournament = data.tournament;
    META.match = data.match;
    data.teamNames.forEach((name, index) => {
      teams[index].name = name;
    });

    overlaySettings = data.overlaySettings;
    window.SMAScoreOverlaySettings?.save(overlaySettings);

    window.SMAScoreMatchConfig?.save({
      tournament: META.tournament,
      match: META.match,
      format: META.format,
      teamCount: META.teamCount,
      teamNames: teams.map((team) => team.name),
      matchId: META.matchId,
    });

    closeSettings();
    renderAll();
  }

  function setMatchTransitionBusy(busy) {
    matchTransitionBusy = busy;
    renderMatchResultPanel();
    if (settingsNewMatchBtn) {
      settingsNewMatchBtn.disabled = busy;
      settingsNewMatchBtn.textContent = busy ? "準備中…" : "新しい試合を作成";
    }
  }

  async function goToNewMatchSetup() {
    if (matchTransitionBusy) return;
    setMatchTransitionBusy(true);
    try {
      // 結果 Overlay を次試合へ引き継がない
      overlayDisplayMode = "score";
      if (!shouldSuppressPublishForPreview()) {
        publishSync();
      }
      window.SMAScoreMatchStart?.clearDraft?.();
      await window.SMAScoreMatchStart?.clearGameState?.();
      window.location.href = "../setup/?mode=new";
    } catch (error) {
      console.error("[SMAScore Control] new match failed:", error);
      setMatchTransitionBusy(false);
      window.alert("新しい試合の準備に失敗しました。もう一度お試しください。");
    }
  }

  async function goToRematchSetup() {
    if (matchTransitionBusy) return;
    setMatchTransitionBusy(true);
    try {
      // 結果 Overlay を次試合へ引き継がない
      overlayDisplayMode = "score";
      if (!shouldSuppressPublishForPreview()) {
        publishSync();
      }
      window.SMAScoreMatchStart?.saveDraft?.({
        mode: "rematch",
        tournament: META.tournament,
        match: META.match,
        format: META.format,
        teamCount: META.teamCount,
        teamNames: teams.map((team) => team.name),
        overlaySettings: { ...overlaySettings },
      });
      await window.SMAScoreMatchStart?.clearGameState?.();
      window.location.href = "../setup/?mode=rematch";
    } catch (error) {
      console.error("[SMAScore Control] rematch failed:", error);
      setMatchTransitionBusy(false);
      window.alert("再試合の準備に失敗しました。もう一度お試しください。");
    }
  }

  async function confirmNewMatch() {
    if (matchTransitionBusy) return;
    const ok = window.confirm("現在の試合データは終了します。新しい試合を作成しますか？");
    if (!ok) return;
    await goToNewMatchSetup();
  }

  function buildSyncState() {
    return {
      matchId: META.matchId,
      tournament: META.tournament,
      match: META.match,
      format: META.format,
      teamCount: META.teamCount,
      teams: cloneTeams(),
      throwOrder: cloneThrowOrder(),
      activeTeamIndex,
      setStartTeamIndex,
      setEnded,
      setWinnerIndex,
      matchEnded,
      matchWinnerIndex,
      matchEndReason: matchEndReason || null,
      pendingSelection: isEditMode() ? pendingEditSelection : pendingSelection,
      currentSetNumber,
      throwLog: cloneThrowLog(),
      setResults: cloneSetResults(),
      overlayDisplayMode: normalizeOverlayDisplayMode(overlayDisplayMode),
      overlaySettings,
      revision: localRevision,
    };
  }

  function applySyncState(state) {
    if (!state?.teams?.length) return;

    const revision = window.SMAScoreSync?.getRevision(state) ?? 0;
    const incomingMatchId = window.SMAScoreSync?.getMatchId?.(state) || state.matchId || "";
    const sameMatch = !!incomingMatchId && !!META.matchId && incomingMatchId === META.matchId;

    // 別試合 / matchId 無しの remote は現行試合へ適用しない
    if (!sameMatch) return;
    if (revision <= localRevision && !(revision === 0 && localRevision === 0)) return;

    if (revision > localRevision && pendingSelection !== null) {
      console.warn("[SMAScore Control] Remote update received; pending input cleared.");
    }

    isApplyingRemote = true;
    localRevision = revision;

    if (incomingMatchId) META.matchId = incomingMatchId;
    if (state.tournament !== undefined) META.tournament = state.tournament;
    if (state.match !== undefined) META.match = state.match;
    if (state.format !== undefined) META.format = state.format;

    teams.length = 0;
    state.teams.forEach((team) => teams.push({ ...team }));

    if (Array.isArray(state.throwOrder)) {
      throwOrder = ThrowOrder.normalize(state.throwOrder, teams.length);
    } else if (typeof state.setStartTeamIndex === "number") {
      throwOrder = ThrowOrder.fromStartIndex(teams.length, state.setStartTeamIndex);
    } else {
      throwOrder = ThrowOrder.createDefault(teams.length);
    }
    syncStartFromOrder();

    activeTeamIndex = state.activeTeamIndex ?? setStartTeamIndex;
    currentSetNumber = state.currentSetNumber || currentSetNumber || 1;
    setEnded = !!state.setEnded;
    setWinnerIndex = state.setWinnerIndex ?? null;
    matchEnded = !!state.matchEnded;
    matchWinnerIndex = state.matchWinnerIndex ?? null;
    matchEndReason = state.matchEndReason || null;

    if (Array.isArray(state.throwLog)) {
      throwLog.length = 0;
      state.throwLog.forEach((entry) => throwLog.push({ ...entry }));
    } else if (revision > 0) {
      console.warn("[SMAScore Control] Remote state lacks throwLog; score display only applied.");
    }

    if (Array.isArray(state.setResults)) {
      setResults = state.setResults.map((result) => ({
        setNumber: result.setNumber,
        winnerTeamIndex: result.winnerTeamIndex ?? null,
        endReason: result.endReason || "normal",
        scores: (result.scores || []).map((score) => ({ ...score })),
      }));
    } else {
      setResults = [];
    }

    overlayDisplayMode = normalizeOverlayDisplayMode(state.overlayDisplayMode);

    if (state.overlaySettings) {
      overlaySettings = { ...overlaySettings, ...state.overlaySettings };
    }

    pendingSelection = null;
    pendingEditSelection = null;
    editCursor = null;
    selectedEditIndex = null;
    isApplyingRemote = false;

    renderAll({ skipPublish: true });
  }

  function publishSync() {
    if (isApplyingRemote || !window.SMAScoreSync) return;

    // 別試合の state が既に配信されているときは旧試合で上書きしない
    const cursor = window.SMAScoreSync.read?.();
    const cursorMatchId =
      window.SMAScoreSync.getMatchId?.(cursor) || cursor?.matchId || "";
    if (
      cursor?.teams?.length &&
      cursorMatchId &&
      META.matchId &&
      cursorMatchId !== META.matchId
    ) {
      return;
    }

    if (suppressPublish) {
      pendingPublish = true;
      // bootstrap 中でも localStorage には反映し、テストや同一タブの read() を最新に保つ
      try {
        const pendingRevision = Math.max(localRevision + 1, 1);
        localRevision = pendingRevision;
        const payload = {
          ...buildSyncState(),
          revision: pendingRevision,
          updatedAt: Date.now(),
        };
        localStorage.setItem(SMAScoreSync.STORAGE_KEY, JSON.stringify(payload));
      } catch {
        /* ignore */
      }
      return;
    }
    pendingPublish = false;
    publishSyncWithRetry(buildSyncState(), localRevision, 3);
  }

  function publishSyncWithRetry(state, baseRevision, attemptsLeft) {
    const stateMatchId = state.matchId || META.matchId || "";
    const pendingRevision = baseRevision + 1;
    localRevision = pendingRevision;

    SMAScoreSync.publish(state, { baseRevision }).then((result) => {
      if (result?.committed && result.data) {
        localRevision = SMAScoreSync.getRevision(result.data);
        const committedMatchId = SMAScoreSync.getMatchId?.(result.data) || result.data.matchId;
        if (committedMatchId) META.matchId = committedMatchId;
        return;
      }

      if (result?.conflict && result.remote) {
        const remoteRevision = SMAScoreSync.getRevision(result.remote);
        const remoteMatchId = SMAScoreSync.getMatchId?.(result.remote) || result.remote.matchId || "";

        // 別試合の remote と衝突した場合は現行（新試合）を優先して再送
        if (stateMatchId && remoteMatchId && stateMatchId !== remoteMatchId && attemptsLeft > 0) {
          publishSyncWithRetry(buildSyncState(), 0, attemptsLeft - 1);
          return;
        }

        if (attemptsLeft > 0 && remoteRevision >= pendingRevision) {
          // より新しい remote がある場合は、現行メモリ状態を新しい base で再送
          publishSyncWithRetry(buildSyncState(), remoteRevision, attemptsLeft - 1);
          return;
        }

        if (remoteRevision > baseRevision) {
          localRevision = Math.max(0, remoteRevision - 1);
          applySyncState(result.remote);
          return;
        }
      }

      localRevision = baseRevision;
    });
  }

  function renderAll(options) {
    controlEl.classList.toggle("control--past-preview", shouldSuppressPublishForPreview());
    renderMetaHeader();
    renderTeamBoard();
    renderSetHeader();
    renderInputTeamBanner();
    renderInputDisplay();
    renderEditSummary();
    renderEditInputDisplay();
    renderHistoryList();
    renderControls();
    renderMatchResultPanel();

    if (!options?.skipPublish && !shouldSuppressPublishForPreview()) {
      publishSync();
    }
  }

  function selectValue(value) {
    if (settingsOpen) return;
    if (matchEnded && !isEditMode() && !isEditingPast()) return;

    if (isEditMode()) {
      if (selectedEditIndex === null || isOrderEntry(throwLog[selectedEditIndex])) return;
      pendingEditSelection = value === "miss" ? 0 : value;
      renderEditSummary();
      renderEditInputDisplay();
      renderControls();
      if (!shouldSuppressPublishForPreview()) {
        publishSync();
      }
      return;
    }

    if (setEnded && !isEditingPast()) return;
    pendingSelection = value === "miss" ? 0 : value;
    renderInputDisplay();
    renderControls();
    if (!shouldSuppressPublishForPreview()) {
      publishSync();
    }
  }

  function applyThrowLogEdit(index, selection) {
    if (index === null || index < 0 || index >= throwLog.length) return false;
    if (isOrderEntry(throwLog[index])) return false;

    const before = snapshot();
    throwLog[index].selection = selection;
    const result = replayMatch();

    if (result.truncated && result.droppedCount > 0) {
      const ok = window.confirm(
        `修正により試合が早く終了したため、後続の${result.droppedCount}件の入力は適用できません。\n切り捨ててよろしいですか？`
      );
      if (!ok) {
        restoreState(before);
        return false;
      }
    }

    history.length = 0;
    return true;
  }

  function confirmEdit() {
    if (selectedEditIndex === null || pendingEditSelection === null) return;
    if (isOrderEntry(throwLog[selectedEditIndex])) return;

    const applied = applyThrowLogEdit(selectedEditIndex, pendingEditSelection);
    if (!applied) {
      renderAll();
      return;
    }

    clearEditCursor();
    pendingSelection = null;
    renderAll();
  }

  function confirmPastEdit() {
    if (!isEditingPast() || pendingSelection === null) return;
    if (isOrderEntry(throwLog[editCursor])) return;

    const selection = normalizeSelection(pendingSelection);
    const applied = applyThrowLogEdit(editCursor, selection);
    if (!applied) {
      renderAll({ skipPublish: true });
      return;
    }

    clearEditCursor();
    pendingSelection = null;
    // 全履歴 replay 済みの正式 state を Overlay へ publish
    renderAll();
  }

  function confirm() {
    if (isEditMode()) {
      confirmEdit();
      return;
    }

    if (isEditingPast()) {
      confirmPastEdit();
      return;
    }

    if (setEnded || matchEnded) return;
    if (pendingSelection === null) return;

    const selection = normalizeSelection(pendingSelection);

    history.push(snapshot());

    const teamIndex = activeTeamIndex;
    const throwInSet = countThrowsInSet(currentSetNumber) + 1;
    throwLog.push({
      kind: "throw",
      teamIndex,
      selection,
      scoreAfter: 0,
      setIndex: currentSetNumber,
      throwInSet,
      setEnded: false,
      setWinnerIndex: null,
    });

    applySelection(getActiveTeam(), selection);
    throwLog[throwLog.length - 1].scoreAfter = teams[teamIndex].score;
    pendingSelection = null;

    resolveAfterThrow(teamIndex);

    if (setEnded) {
      throwLog[throwLog.length - 1].setEnded = true;
      throwLog[throwLog.length - 1].setWinnerIndex = setWinnerIndex;
    }

    renderAll();
  }

  function nextSet() {
    if (!setEnded || setWinnerIndex === null || matchEnded) return;

    history.push(snapshot());

    const matchResult = window.SMAScoreMatchRules?.evaluateMatchEnd(
      teams,
      setWinnerIndex,
      META.format
    ) ?? { ended: false, winnerIndex: null };

    teams[setWinnerIndex].setWins += 1;

    if (matchResult.ended) {
      finishMatch(matchResult.winnerIndex);
      renderAll();
      return;
    }

    rotateSetStartTeam();
    currentSetNumber += 1;
    beginSet();
    pendingSelection = null;

    renderAll();
  }

  function pushOrderChange(nextOrder) {
    const normalized = ThrowOrder.normalize(nextOrder, teams.length);
    const same =
      normalized.length === throwOrder.length &&
      normalized.every((value, index) => value === throwOrder[index]);
    if (same) return;

    history.push(snapshot());
    applyThrowOrder(normalized);
    pendingSelection = null;

    throwLog.push({
      kind: "order",
      activeTeamIndex,
      setStartTeamIndex,
      throwOrder: cloneThrowOrder(),
      setIndex: currentSetNumber,
      throwInSet: null,
      setEnded: false,
      setWinnerIndex: null,
    });

    renderAll();
  }

  function changeThrowOrderByAction(teamIndex, action) {
    if (matchEnded || setEnded || isEditMode() || settingsOpen) return;
    if (teamIndex < 0 || teamIndex >= teams.length) return;
    if (teams[teamIndex].disqualified) return;

    let nextOrder = cloneThrowOrder();
    if (action === "front") {
      nextOrder = ThrowOrder.moveToFront(nextOrder, teamIndex);
    } else if (action === "left") {
      nextOrder = ThrowOrder.move(nextOrder, teamIndex, -1);
    } else if (action === "right") {
      nextOrder = ThrowOrder.move(nextOrder, teamIndex, 1);
    } else {
      return;
    }

    const label = teams[teamIndex]?.name ?? `チーム ${teamIndex + 1}`;
    const actionLabel =
      action === "front" ? "先頭にする" : action === "left" ? "1つ前へ" : "1つ後ろへ";
    const ok = window.confirm(
      `投擲順を変更します。\n${label} を${actionLabel}\n\nよろしいですか？`
    );
    if (!ok) return;

    pushOrderChange(nextOrder);
  }

  function back() {
    if (isEditMode() || settingsOpen) return;

    const indices = getEditableThrowIndices();
    if (!indices.length) return;

    if (!isEditingPast()) {
      editCursor = indices[indices.length - 1];
    } else {
      const pos = indices.indexOf(editCursor);
      if (pos <= 0) {
        editCursor = indices[0];
      } else {
        editCursor = indices[pos - 1];
      }
    }

    const entry = throwLog[editCursor];
    pendingSelection = entry?.selection ?? null;
    pendingEditSelection = null;
    selectedEditIndex = null;
    renderAll();
  }

  function openEditView() {
    viewMode = "edit";
    // 過去修正中なら履歴側にも同期
    if (isEditingPast()) {
      selectedEditIndex = editCursor;
      pendingEditSelection = pendingSelection;
    } else {
      selectedEditIndex = null;
      pendingEditSelection = null;
    }
    collapsedSets.clear();
    // 現在セット以外を折りたたみ
    buildHistoryGroups().forEach((group) => {
      if (group.closed) collapsedSets.add(group.setNumber);
    });
    renderAll();
  }

  function closeEditView() {
    viewMode = "input";
    clearEditCursor();
    pendingSelection = null;
    historyListEl.innerHTML = "";
    renderAll();
  }

  function toggleEditMode() {
    if (settingsOpen || matchTransitionBusy) return;
    if (isEditMode()) closeEditView();
    else openEditView();
  }

  function cancelEditSelection() {
    if (isEditingPast()) {
      clearEditCursor();
      pendingSelection = null;
      viewMode = "input";
      // 正式 state は未変更だが、表示を最新へ確実に戻す
      replayMatch();
      renderAll();
      return;
    }

    if (!isEditMode()) return;
    selectedEditIndex = null;
    pendingEditSelection = null;
    if (editControlsEl) editControlsEl.hidden = true;
    renderAll();
  }

  function formatHistoryDate(ts) {
    if (!ts) return "";
    try {
      const date = new Date(ts);
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      const hh = String(date.getHours()).padStart(2, "0");
      const mm = String(date.getMinutes()).padStart(2, "0");
      return `${y}/${m}/${d} ${hh}:${mm}`;
    } catch {
      return "";
    }
  }

  function renderMatchHistoryStandings() {
    if (!historyStandings || !historyFocusTeam) return;
    const History = window.SMAScoreMatchHistory;
    if (!History) {
      historyStandings.innerHTML = "";
      return;
    }

    const entries = History.readAll();
    const names = History.collectTeamNames(entries);
    const focus = historyFocusTeam.value || History.getFocusTeamName() || names[0] || "";
    if (focus && historyFocusTeam.value !== focus) {
      historyFocusTeam.value = focus;
    }

    const stats = History.summarizeForTeam(focus, entries);
    historyStandings.innerHTML = `
      <div class="history-standings__item"><span>試合数</span><strong>${stats.matches}</strong></div>
      <div class="history-standings__item"><span>勝 / 敗 / 分</span><strong>${stats.wins} / ${stats.losses} / ${stats.draws}</strong></div>
      <div class="history-standings__item"><span>獲得セット</span><strong>${stats.setsFor}</strong></div>
      <div class="history-standings__item"><span>失セット</span><strong>${stats.setsAgainst}</strong></div>
      <div class="history-standings__item"><span>総得点</span><strong>${stats.pointsFor}</strong></div>
      <div class="history-standings__item"><span>失点</span><strong>${stats.pointsAgainst}</strong></div>
      <div class="history-standings__item"><span>セット差</span><strong>${stats.setDiff >= 0 ? "+" : ""}${stats.setDiff}</strong></div>
      <div class="history-standings__item"><span>得失点差</span><strong>${stats.pointDiff >= 0 ? "+" : ""}${stats.pointDiff}</strong></div>
    `;
  }

  function renderMatchHistoryFocusOptions() {
    if (!historyFocusTeam) return;
    const History = window.SMAScoreMatchHistory;
    if (!History) return;
    const entries = History.readAll();
    const names = History.collectTeamNames(entries);
    const current = History.getFocusTeamName() || names[0] || "";
    historyFocusTeam.innerHTML = names.length
      ? names.map((name) => `<option value="${name}">${name}</option>`).join("")
      : '<option value="">（履歴なし）</option>';
    if (current && names.includes(current)) historyFocusTeam.value = current;
  }

  function renderMatchHistoryList() {
    if (!matchHistoryList) return;
    const History = window.SMAScoreMatchHistory;
    const entries = History?.readAll?.() || [];
    if (!entries.length) {
      matchHistoryList.innerHTML =
        '<p class="history-card__empty">保存された試合履歴はまだありません</p>';
      return;
    }

    matchHistoryList.innerHTML = entries
      .map((entry) => {
        const teams = entry.teams || [];
        const winner =
          entry.winnerTeamIndex === null || entry.winnerTeamIndex === undefined
            ? "引き分け"
            : teams[entry.winnerTeamIndex]?.name || "—";
        const setLine = teams.map((team) => `${team.name} ${team.setWins}`).join(" / ");
        const totalLine = teams.map((team) => `${team.name} ${team.total}`).join(" / ");
        const reason = History.matchEndReasonLabel(entry.matchEndReason);
        const active = selectedHistoryMatchId === entry.matchId ? " history-card--active" : "";
        return `
          <button type="button" class="history-card${active}" data-history-id="${entry.matchId}">
            <p class="history-card__title">${entry.match || "（試合名なし）"}</p>
            <p class="history-card__meta">${entry.tournament || "—"} ｜ ${formatHistoryDate(entry.playedAt)}</p>
            <div class="history-card__row"><span>勝者</span><span>${winner}</span></div>
            <div class="history-card__row"><span>セット</span><span>${setLine}</span></div>
            <div class="history-card__row"><span>合計</span><span>${totalLine}</span></div>
            <div class="history-card__row"><span>終了理由</span><span>${reason}</span></div>
          </button>
        `;
      })
      .join("");

    matchHistoryList.querySelectorAll("[data-history-id]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedHistoryMatchId = button.getAttribute("data-history-id");
        renderMatchHistoryList();
        renderMatchHistoryDetail(selectedHistoryMatchId);
      });
    });
  }

  function renderMatchHistoryDetail(matchId) {
    if (!matchHistoryDetail) return;
    const History = window.SMAScoreMatchHistory;
    const entry = (History?.readAll?.() || []).find((item) => item.matchId === matchId);
    if (!entry) {
      matchHistoryDetail.hidden = true;
      matchHistoryDetail.innerHTML = "";
      return;
    }

    const winner =
      entry.winnerTeamIndex === null || entry.winnerTeamIndex === undefined
        ? "引き分け"
        : entry.teams?.[entry.winnerTeamIndex]?.name || "—";
    const setsHtml = (entry.setResults || [])
      .map((result) => {
        const rows = (result.scores || [])
          .map((row) => {
            const name = entry.teams?.[row.teamIndex]?.name || `チーム${row.teamIndex + 1}`;
            const dq = row.disqualified ? "（失格）" : "";
            return `<div class="history-card__row"><span>${name}</span><span>${row.score}点${dq}</span></div>`;
          })
          .join("");
        const reason = History.endReasonLabel(result.endReason);
        return `
          <div class="history-detail__set">
            <p class="history-detail__set-title">セット${result.setNumber}${reason ? `（${reason}）` : ""}</p>
            ${rows}
          </div>
        `;
      })
      .join("");

    matchHistoryDetail.hidden = false;
    matchHistoryDetail.innerHTML = `
      <p class="history-detail__title">${entry.match || "試合詳細"}</p>
      <p class="history-detail__line">${entry.tournament || "—"} ｜ ${formatHistoryDate(entry.playedAt)}</p>
      <p class="history-detail__line">勝者：${winner}</p>
      <p class="history-detail__line">終了理由：${History.matchEndReasonLabel(entry.matchEndReason)}</p>
      ${setsHtml}
      <div class="history-detail__set">
        <p class="history-detail__set-title">合計得点</p>
        ${(entry.teams || [])
          .map(
            (team) =>
              `<div class="history-card__row"><span>${team.name}</span><span>${team.total}点（${team.setWins}セット）</span></div>`
          )
          .join("")}
      </div>
    `;
  }

  function openMatchHistoryModal() {
    if (!historyModal) return;
    closeSettings();
    renderMatchHistoryFocusOptions();
    renderMatchHistoryStandings();
    renderMatchHistoryList();
    if (selectedHistoryMatchId) renderMatchHistoryDetail(selectedHistoryMatchId);
    historyModal.hidden = false;
  }

  function closeMatchHistoryModal() {
    if (!historyModal) return;
    historyModal.hidden = true;
  }

  function bindKeyPad(nodeList) {
    nodeList.forEach((key) => {
      key.addEventListener("click", () => {
        const raw = key.dataset.value;
        if (raw === "F") {
          selectValue("F");
          return;
        }
        if (raw === "miss") {
          selectValue("miss");
          return;
        }
        selectValue(Number(raw));
      });
    });
  }

  bindKeyPad(keys);
  bindKeyPad(editKeys);

  confirmBtn.addEventListener("click", confirm);
  backBtn.addEventListener("click", back);
  nextSetBtn.addEventListener("click", nextSet);
  editModeBtn.addEventListener("click", toggleEditMode);
  cancelEditBtn?.addEventListener("click", cancelEditSelection);

  settingsBtn.addEventListener("click", openSettings);
  settingsCloseBtn.addEventListener("click", closeSettings);
  settingsCancelBtn.addEventListener("click", closeSettings);
  settingsBackdrop.addEventListener("click", closeSettings);
  settingsForm.addEventListener("submit", saveSettings);
  settingsNewMatchBtn.addEventListener("click", confirmNewMatch);
  settingsHistoryBtn?.addEventListener("click", openMatchHistoryModal);
  historyCloseBtn?.addEventListener("click", closeMatchHistoryModal);
  historyBackdrop?.addEventListener("click", closeMatchHistoryModal);
  historyFocusTeam?.addEventListener("change", () => {
    window.SMAScoreMatchHistory?.setFocusTeamName?.(historyFocusTeam.value);
    renderMatchHistoryStandings();
  });
  forceEndMatchBtn?.addEventListener("click", forceEndMatchByTimeLimit);
  rematchBtn?.addEventListener("click", () => {
    goToRematchSetup();
  });
  newMatchBtn?.addEventListener("click", () => {
    goToNewMatchSetup();
  });
  showOverlayResultBtn?.addEventListener("click", showOverlayResult);
  hideOverlayResultBtn?.addEventListener("click", hideOverlayResult);

  async function bootstrap() {
    window.SMAScoreControlReady = false;

    if (!window.SMAScoreSync) {
      suppressPublish = false;
      renderAll();
      window.SMAScoreControlReady = true;
      return;
    }

    // Firebase 待ちの間も UI を先に出す（ready は同期完了後）
    renderAll({ skipPublish: true });
    // 万一同期待ちが詰まっても 5 秒で操作可能にする
    setTimeout(() => {
      if (!window.SMAScoreControlReady) {
        console.warn("[SMAScore Control] bootstrap watchdog: forcing ready");
        suppressPublish = false;
        window.SMAScoreControlReady = true;
      }
    }, 5000);

    SMAScoreSync.subscribe((state) => {
      if (!state?.teams?.length) return;
      const incomingMatchId = SMAScoreSync.getMatchId?.(state) || state.matchId || "";
      // matchId が無い旧 state は現行試合として扱わない（新試合を古い得点で上書きしない）
      const sameMatch = !!incomingMatchId && !!META.matchId && incomingMatchId === META.matchId;
      if (sameMatch && SMAScoreSync.getRevision(state) > localRevision) {
        applySyncState(state);
      } else if (sameMatch && SMAScoreSync.getRevision(state) === 0 && localRevision === 0) {
        applySyncState(state);
      }
    });

    const syncBootstrap = async () => {
      let remote = null;
      try {
        remote = await Promise.race([
          SMAScoreSync.ready(1200),
          new Promise((resolve) => setTimeout(() => resolve(SMAScoreSync.read()), 1300)),
        ]);
      } catch {
        remote = SMAScoreSync.read();
      }

      const remoteRevision = SMAScoreSync.getRevision(remote);
      const remoteMatchId = remote
        ? SMAScoreSync.getMatchId?.(remote) || remote.matchId || ""
        : "";
      const remoteIsSameMatch =
        !!remoteMatchId && !!META.matchId && remoteMatchId === META.matchId;

      if (remote?.teams?.length && remoteRevision > 0 && remoteIsSameMatch) {
        applySyncState(remote);
      } else {
        localRevision = 0;
        try {
          const result = await Promise.race([
            SMAScoreSync.publish(buildSyncState(), {
              baseRevision: remoteIsSameMatch ? remoteRevision : 0,
            }),
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    ok: true,
                    committed: true,
                    timeout: true,
                    data: { ...buildSyncState(), revision: 1 },
                  }),
                1500
              )
            ),
          ]);
          if (result?.committed && result.data) {
            localRevision = SMAScoreSync.getRevision(result.data) || 1;
            if (result.timeout) {
              // タイムアウト時も local に初期 state を残す
              try {
                localStorage.setItem(
                  SMAScoreSync.STORAGE_KEY,
                  JSON.stringify({
                    ...buildSyncState(),
                    revision: localRevision,
                    updatedAt: Date.now(),
                  })
                );
              } catch {
                /* ignore */
              }
            }
          }
        } catch (error) {
          console.warn("[SMAScore Control] initial publish failed:", error);
          try {
            localStorage.setItem(
              SMAScoreSync.STORAGE_KEY,
              JSON.stringify({
                ...buildSyncState(),
                revision: 1,
                updatedAt: Date.now(),
              })
            );
            localRevision = 1;
          } catch {
            /* ignore */
          }
        }
      }
    };

    try {
      await Promise.race([
        syncBootstrap(),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
    } catch (error) {
      console.warn("[SMAScore Control] bootstrap sync error:", error);
    }

    // local にまだ state が無ければ最低限書き込む
    if (!SMAScoreSync.read()?.teams?.length) {
      try {
        localStorage.setItem(
          SMAScoreSync.STORAGE_KEY,
          JSON.stringify({
            ...buildSyncState(),
            revision: Math.max(1, localRevision || 1),
            updatedAt: Date.now(),
          })
        );
        localRevision = Math.max(1, localRevision || 1);
      } catch {
        /* ignore */
      }
    }

    suppressPublish = false;
    if (pendingPublish) {
      publishSync();
    }
    window.SMAScoreControlReady = true;
  }

  bootstrap().catch((error) => {
    console.error("[SMAScore Control] bootstrap failed:", error);
    suppressPublish = false;
    try {
      renderAll({ skipPublish: true });
      if (window.SMAScoreSync && !SMAScoreSync.read()?.teams?.length) {
        localStorage.setItem(
          SMAScoreSync.STORAGE_KEY,
          JSON.stringify({
            ...buildSyncState(),
            revision: 1,
            updatedAt: Date.now(),
          })
        );
      }
    } catch {
      /* ignore */
    }
    window.SMAScoreControlReady = true;
  });
})();
