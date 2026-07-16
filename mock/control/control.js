/**
 * SMAScore Control — 失格・セット終了・修正モード・履歴再計算
 */

(function () {
  const inputDisplay = document.getElementById("inputDisplay");
  const inputDisplayLabel = document.querySelector(".input-display__label");
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
  const setScoreLeftEl = document.getElementById("setScoreLeft");
  const setScoreRightEl = document.getElementById("setScoreRight");
  const keys = document.querySelectorAll(".key[data-value]");
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
  };

  const teams = matchConfig.teamNames.map((name) => ({
    name,
    score: 0,
    total: 0,
    misses: 0,
    won: false,
    disqualified: false,
    setWins: 0,
  }));

  let activeTeamIndex = 0;
  let setStartTeamIndex = 0;
  let pendingSelection = null;
  let setEnded = false;
  let setWinnerIndex = null;
  const history = [];
  const throwLog = [];

  let editMode = false;
  let selectedEditIndex = null;
  let pendingEditSelection = null;
  let settingsOpen = false;

  let overlaySettings = window.SMAScoreOverlaySettings?.load() ?? {
    showTournament: true,
    showMatch: true,
    backgroundOpacity: "standard",
    scoreAnimation: true,
  };

  function cloneTeams() {
    return teams.map((team) => ({ ...team }));
  }

  function cloneThrowLog() {
    return throwLog.map((entry) => ({ ...entry }));
  }

  function snapshot() {
    return {
      teams: cloneTeams(),
      activeTeamIndex,
      setStartTeamIndex,
      setEnded,
      setWinnerIndex,
      throwLog: cloneThrowLog(),
    };
  }

  function restoreState(state) {
    teams.length = 0;
    state.teams.forEach((team) => teams.push({ ...team }));
    activeTeamIndex = state.activeTeamIndex;
    setStartTeamIndex = state.setStartTeamIndex;
    setEnded = state.setEnded;
    setWinnerIndex = state.setWinnerIndex;
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
    const total = teams.length;
    for (let step = 1; step <= total; step += 1) {
      const index = (fromIndex + step) % total;
      if (!teams[index].disqualified) {
        return index;
      }
    }
    return fromIndex;
  }

  function applyFiftyRule(score) {
    if (score > 50) {
      return 25;
    }
    return score;
  }

  function applySelection(team, selection) {
    if (selection >= 1 && selection <= 12) {
      team.score = applyFiftyRule(team.score + selection);
      team.misses = 0;
      team.won = team.score === 50;
      return;
    }

    if (selection === 0) {
      team.misses = Math.min(3, team.misses + 1);
      if (team.misses >= 3) {
        team.disqualified = true;
        team.score = 0;
        team.won = false;
      }
      return;
    }

    if (selection === "F") {
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
    if (teams.length === 2) {
      setStartTeamIndex = 1 - setStartTeamIndex;
    } else {
      setStartTeamIndex = (setStartTeamIndex + 1) % teams.length;
    }
  }

  function beginSet() {
    activeTeamIndex = setStartTeamIndex;
    setEnded = false;
    setWinnerIndex = null;
    resetSetScores();
  }

  function applyNextSetTransition(winnerIndex) {
    teams[winnerIndex].setWins += 1;
    rotateSetStartTeam();
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

    setStartTeamIndex = 0;
    beginSet();

    for (let i = 0; i < log.length; i += 1) {
      const entry = log[i];
      activeTeamIndex = entry.teamIndex;
      const team = teams[entry.teamIndex];

      applySelection(team, entry.selection);
      entry.scoreAfter = team.score;

      const result = resolveThrowDuringReplay(entry.teamIndex);

      if (result.setEnded) {
        addCurrentScoresToTotals();
        setEnded = true;
        setWinnerIndex = result.winnerIndex;

        if (i < log.length - 1) {
          applyNextSetTransition(result.winnerIndex);
        }
      }
    }

    throwLog.length = 0;
    log.forEach((entry) => throwLog.push({ ...entry }));
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
    return selection === "F" ? "F" : String(selection);
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
    if (teams.length >= 2) {
      setScoreLeftEl.textContent = teams[0].setWins;
      setScoreRightEl.textContent = teams[1].setWins;
    }
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

    teamBoardEl.innerHTML = teams
      .map((team, index) => {
        const isActive = !editMode && !setEnded && index === activeTeamIndex;
        const isWinner = setEnded && index === setWinnerIndex;
        const victoryClass = team.won && !setEnded ? " team-card__score--victory" : "";
        const dqBadge = team.disqualified
          ? '<span class="team-card__badge">失格</span>'
          : "<span></span>";

        return `
          <article class="team-card team-card--color-${index}${isActive ? " team-card--active" : ""}${team.disqualified ? " team-card--disqualified" : ""}${isWinner ? " team-card--set-winner" : ""}" aria-label="${team.name}">
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

  function renderHistoryList() {
    if (!editMode) return;

    if (throwLog.length === 0) {
      historyListEl.innerHTML = '<p class="history-list__empty">履歴がありません</p>';
      return;
    }

    historyListEl.innerHTML = throwLog
      .map((entry, index) => {
        const teamName = teams[entry.teamIndex]?.name ?? `チーム ${entry.teamIndex + 1}`;
        const selected = index === selectedEditIndex ? " history-item--selected" : "";
        return `
          <button type="button" class="history-item${selected}" data-index="${index}">
            <span class="history-item__num">${index + 1}</span>
            <span class="history-item__team">${teamName}</span>
            <span class="history-item__input">${formatSelection(entry.selection)}</span>
            <span class="history-item__score">${entry.scoreAfter ?? "-"}</span>
          </button>
        `;
      })
      .join("");

    historyListEl.querySelectorAll(".history-item").forEach((button) => {
      button.addEventListener("click", () => {
        selectedEditIndex = Number(button.dataset.index);
        pendingEditSelection = null;
        renderAll();
      });
    });
  }

  function renderInputTeamBanner() {
    if (setEnded || editMode) {
      inputTeamBanner.classList.add("input-team--hidden");
      return;
    }

    inputTeamBanner.classList.remove("input-team--hidden");
    const colorIndex = activeTeamIndex % 4;
    inputTeamBanner.className = `input-team input-team--color-${colorIndex}`;
    teamNameEl.textContent = getActiveTeam().name;
  }

  function renderInputDisplay() {
    inputDisplay.classList.remove(
      "input-display__value--waiting",
      "input-display__value--entered",
      "input-display__value--foul",
      "input-display__value--set-end",
      "input-display__value--edit"
    );

    if (editMode) {
      inputDisplayLabel.textContent = "修正入力";

      if (selectedEditIndex === null) {
        inputDisplay.textContent = "履歴を選択";
        inputDisplay.classList.add("input-display__value--edit");
        return;
      }

      if (pendingEditSelection === null) {
        inputDisplay.textContent = formatSelection(throwLog[selectedEditIndex].selection);
        inputDisplay.classList.add("input-display__value--entered");
        return;
      }

      if (pendingEditSelection === "F") {
        inputDisplay.textContent = "F";
        inputDisplay.classList.add("input-display__value--foul");
      } else {
        inputDisplay.textContent = String(pendingEditSelection);
        inputDisplay.classList.add("input-display__value--entered");
      }
      return;
    }

    inputDisplayLabel.textContent = "現在入力";

    if (setEnded) {
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
    } else {
      inputDisplay.textContent = String(pendingSelection);
      inputDisplay.classList.add("input-display__value--entered");
    }
  }

  function renderControls() {
    editModeBtn.classList.toggle("action--edit-on", editMode);
    editModeBtn.textContent = editMode ? "通常モード" : "修正モード";
    historyPanel.hidden = !editMode;

    const inputBlocked = setEnded || editMode || settingsOpen;
    keypadEl.classList.toggle("keypad--disabled", inputBlocked && !(editMode && selectedEditIndex !== null));

    editModeBtn.disabled = settingsOpen;

    if (editMode) {
      nextSetBtn.hidden = true;
      confirmBtn.hidden = false;
      confirmBtn.disabled = settingsOpen || selectedEditIndex === null || pendingEditSelection === null;
    } else {
      confirmBtn.hidden = setEnded;
      confirmBtn.disabled = settingsOpen || setEnded || pendingSelection === null;
      nextSetBtn.hidden = !setEnded;
      nextSetBtn.disabled = settingsOpen;
    }

    backBtn.disabled = history.length === 0 || settingsOpen;
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
    });

    closeSettings();
    renderAll();
  }

  function confirmNewMatch() {
    const ok = window.confirm("現在の試合データは終了します。新しい試合を作成しますか？");
    if (!ok) return;

    try {
      localStorage.removeItem("smascore-game-state");
    } catch {
      /* ignore */
    }

    window.location.href = "../setup/";
  }

  function buildSyncState() {
    return {
      tournament: META.tournament,
      match: META.match,
      format: META.format,
      teamCount: META.teamCount,
      teams: cloneTeams(),
      activeTeamIndex,
      setEnded,
      setWinnerIndex,
      pendingSelection: editMode ? pendingEditSelection : pendingSelection,
      overlaySettings,
    };
  }

  function publishSync() {
    if (window.SMAScoreSync) {
      SMAScoreSync.publish(buildSyncState());
    }
  }

  function renderAll() {
    renderMetaHeader();
    renderTeamBoard();
    renderSetHeader();
    renderInputTeamBanner();
    renderInputDisplay();
    renderHistoryList();
    renderControls();
    publishSync();
  }

  function selectValue(value) {
    if (settingsOpen) return;

    if (editMode) {
      if (selectedEditIndex === null) return;
      pendingEditSelection = value;
      renderInputDisplay();
      renderControls();
      publishSync();
      return;
    }

    if (setEnded) return;
    pendingSelection = value;
    renderInputDisplay();
    renderControls();
    publishSync();
  }

  function confirmEdit() {
    if (selectedEditIndex === null || pendingEditSelection === null) return;

    history.push(snapshot());

    throwLog[selectedEditIndex].selection = pendingEditSelection;
    replayMatch();

    selectedEditIndex = null;
    pendingEditSelection = null;
    pendingSelection = null;

    renderAll();
  }

  function confirm() {
    if (editMode) {
      confirmEdit();
      return;
    }

    if (setEnded || pendingSelection === null) return;

    history.push(snapshot());

    const teamIndex = activeTeamIndex;
    throwLog.push({
      teamIndex,
      selection: pendingSelection,
      scoreAfter: 0,
    });

    applySelection(getActiveTeam(), pendingSelection);
    throwLog[throwLog.length - 1].scoreAfter = teams[teamIndex].score;
    pendingSelection = null;

    resolveAfterThrow(teamIndex);
    renderAll();
  }

  function nextSet() {
    if (!setEnded || setWinnerIndex === null) return;

    history.push(snapshot());

    teams[setWinnerIndex].setWins += 1;
    rotateSetStartTeam();
    beginSet();
    pendingSelection = null;

    renderAll();
  }

  function back() {
    if (history.length === 0) return;

    restoreState(history.pop());
    pendingSelection = null;
    pendingEditSelection = null;
    selectedEditIndex = null;
    renderAll();
  }

  function toggleEditMode() {
    if (settingsOpen) return;

    editMode = !editMode;
    selectedEditIndex = null;
    pendingEditSelection = null;
    pendingSelection = null;
    renderAll();
  }

  keys.forEach((key) => {
    key.addEventListener("click", () => {
      const raw = key.dataset.value;
      const value = raw === "F" ? "F" : Number(raw);
      selectValue(value);
    });
  });

  confirmBtn.addEventListener("click", confirm);
  backBtn.addEventListener("click", back);
  nextSetBtn.addEventListener("click", nextSet);
  editModeBtn.addEventListener("click", toggleEditMode);

  settingsBtn.addEventListener("click", openSettings);
  settingsCloseBtn.addEventListener("click", closeSettings);
  settingsCancelBtn.addEventListener("click", closeSettings);
  settingsBackdrop.addEventListener("click", closeSettings);
  settingsForm.addEventListener("submit", saveSettings);
  settingsNewMatchBtn.addEventListener("click", confirmNewMatch);

  renderAll();
})();
