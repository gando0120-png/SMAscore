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
  const history = [];
  const throwLog = [];

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
      throwLog: cloneThrowLog(),
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
    throwLog.length = 0;
    state.throwLog.forEach((entry) => throwLog.push({ ...entry }));
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

  function finishMatch(winnerIndex) {
    matchEnded = true;
    matchWinnerIndex = winnerIndex;
    setEnded = false;
    setWinnerIndex = null;
    pendingSelection = null;
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
    currentSetNumber = 1;
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
        addCurrentScoresToTotals();
        setEnded = true;
        setWinnerIndex = result.winnerIndex;
        entry.setEnded = true;
        entry.setWinnerIndex = result.winnerIndex;

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

    const divider = teams.length === 2
      ? '<span class="header__set-divider">-</span>'
      : '<span class="header__set-divider header__set-divider--bar">|</span>';

    setScoreEl.innerHTML = throwOrder
      .map((teamIndex, position) => {
        const team = teams[teamIndex];
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
    teamBoardEl.className = `team-board team-board--count-${teams.length}`;

    teamBoardEl.innerHTML = throwOrder
      .map((teamIndex) => {
        const team = teams[teamIndex];
        const isActive = !isEditMode() && !setEnded && !matchEnded && teamIndex === activeTeamIndex;
        const isSetWinner = setEnded && teamIndex === setWinnerIndex;
        const isMatchWinner = matchEnded && teamIndex === matchWinnerIndex;
        const victoryClass = team.won && !setEnded && !matchEnded ? " team-card__score--victory" : "";
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

    const blocked = matchEnded || setEnded || isEditMode() || settingsOpen;
    throwOrderPanel.hidden = blocked;
    if (blocked) return;

    throwOrderListEl.innerHTML = throwOrder
      .map((teamIndex, position) => {
        const team = teams[teamIndex];
        const atFirst = position === 0;
        const atLast = position === throwOrder.length - 1;
        return `
          <div class="throw-order__row throw-order__row--color-${teamIndex}" data-team-index="${teamIndex}">
            <span class="throw-order__pos">${position + 1}</span>
            <span class="throw-order__name">${team.name}</span>
            <div class="throw-order__actions">
              <button type="button" class="throw-order__btn" data-action="front" ${atFirst ? "disabled" : ""}>先頭</button>
              <button type="button" class="throw-order__btn" data-action="left" ${atFirst ? "disabled" : ""}>←</button>
              <button type="button" class="throw-order__btn" data-action="right" ${atLast ? "disabled" : ""}>→</button>
            </div>
          </div>
        `;
      })
      .join("");

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
    if (setEnded || matchEnded || isEditMode() || isEditingPast()) {
      inputTeamBanner.classList.add("input-team--hidden");
      return;
    }

    inputTeamBanner.classList.remove("input-team--hidden");
    const colorIndex = activeTeamIndex % 4;
    inputTeamBanner.className = `input-team input-team--color-${colorIndex}`;
    teamNameEl.textContent = getActiveTeam().name;
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

  function renderViewMode() {
    const editing = isEditMode();
    const pastEditing = isEditingPast();
    controlEl.classList.toggle("control--edit-mode", editing);
    controlEl.classList.toggle("control--input-mode", !editing);
    controlEl.classList.toggle("control--past-edit", pastEditing && !editing);

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
    editModeBtn.disabled = settingsOpen || matchEnded;

    backBtn.hidden = editing;
    cancelEditBtn.hidden = !(editing || pastEditing);
    cancelEditBtn.disabled =
      settingsOpen || (editing && selectedEditIndex === null && !pastEditing);
    cancelEditBtn.textContent = pastEditing && !editing ? "最新の入力へ戻る" : "修正をやめる";

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

  async function confirmNewMatch() {
    const ok = window.confirm("現在の試合データは終了します。新しい試合を作成しますか？");
    if (!ok) return;

    try {
      if (window.SMAScoreSync?.clear) {
        await SMAScoreSync.clear();
      } else {
        localStorage.removeItem("smascore-game-state");
      }
    } catch {
      try {
        localStorage.removeItem("smascore-game-state");
      } catch {
        /* ignore */
      }
    }

    window.location.href = "../setup/";
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
      pendingSelection: isEditMode() ? pendingEditSelection : pendingSelection,
      currentSetNumber,
      throwLog: cloneThrowLog(),
      overlaySettings,
      revision: localRevision,
    };
  }

  function applySyncState(state) {
    if (!state?.teams?.length) return;

    const revision = window.SMAScoreSync?.getRevision(state) ?? 0;
    const incomingMatchId = window.SMAScoreSync?.getMatchId?.(state) || state.matchId || "";
    const sameMatch = !incomingMatchId || !META.matchId || incomingMatchId === META.matchId;

    if (sameMatch && revision <= localRevision) return;

    if (sameMatch && revision > localRevision && pendingSelection !== null) {
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

    if (Array.isArray(state.throwLog)) {
      throwLog.length = 0;
      state.throwLog.forEach((entry) => throwLog.push({ ...entry }));
    } else if (revision > 0) {
      console.warn("[SMAScore Control] Remote state lacks throwLog; score display only applied.");
    }

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
    if (suppressPublish) {
      pendingPublish = true;
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
    renderMetaHeader();
    renderTeamBoard();
    renderSetHeader();
    renderInputTeamBanner();
    renderInputDisplay();
    renderEditSummary();
    renderEditInputDisplay();
    renderHistoryList();
    renderControls();

    if (!options?.skipPublish) {
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
      publishSync();
      return;
    }

    if (setEnded && !isEditingPast()) return;
    pendingSelection = value === "miss" ? 0 : value;
    renderInputDisplay();
    renderControls();
    publishSync();
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
      renderAll();
      return;
    }

    clearEditCursor();
    pendingSelection = null;
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
    if (settingsOpen || matchEnded) return;
    if (isEditMode()) closeEditView();
    else openEditView();
  }

  function cancelEditSelection() {
    if (isEditingPast()) {
      clearEditCursor();
      pendingSelection = null;
      viewMode = "input";
      renderAll();
      return;
    }

    if (!isEditMode()) return;
    selectedEditIndex = null;
    pendingEditSelection = null;
    if (editControlsEl) editControlsEl.hidden = true;
    renderAll();
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

  async function bootstrap() {
    if (!window.SMAScoreSync) {
      suppressPublish = false;
      renderAll();
      return;
    }

    SMAScoreSync.subscribe((state) => {
      if (!state?.teams?.length) return;
      const incomingMatchId = SMAScoreSync.getMatchId?.(state) || state.matchId || "";
      const sameMatch = !incomingMatchId || !META.matchId || incomingMatchId === META.matchId;
      if (!sameMatch || SMAScoreSync.getRevision(state) > localRevision) {
        applySyncState(state);
      }
    });

    const remote = await SMAScoreSync.ready(3000);
    const remoteRevision = SMAScoreSync.getRevision(remote);
    const remoteMatchId = remote
      ? SMAScoreSync.getMatchId?.(remote) || remote.matchId || ""
      : "";
    const remoteIsSameMatch =
      !remoteMatchId || !META.matchId || remoteMatchId === META.matchId;

    if (remote?.teams?.length && remoteRevision > 0 && remoteIsSameMatch) {
      applySyncState(remote);
    } else {
      // 新規試合、または room に別 matchId が残っている場合はローカル試合を publish
      renderAll({ skipPublish: true });
      localRevision = 0;
      const result = await SMAScoreSync.publish(buildSyncState(), {
        baseRevision: remoteIsSameMatch ? remoteRevision : 0,
      });
      if (result?.committed && result.data) {
        localRevision = SMAScoreSync.getRevision(result.data);
      }
    }

    suppressPublish = false;
    if (pendingPublish) {
      publishSync();
    }
  }

  bootstrap();
})();
