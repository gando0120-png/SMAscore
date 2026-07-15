/**
 * SMAScore Control — ブラウザ内試作
 * 失格・セット終了・次セット・履歴付き戻る
 */

(function () {
  const inputDisplay = document.getElementById("inputDisplay");
  const teamNameEl = document.getElementById("teamName");
  const inputTeamBanner = document.getElementById("inputTeamBanner");
  const teamBoardEl = document.getElementById("teamBoard");
  const keypadEl = document.getElementById("keypad");
  const confirmBtn = document.getElementById("confirmBtn");
  const backBtn = document.getElementById("backBtn");
  const nextSetBtn = document.getElementById("nextSetBtn");
  const setScoreLeftEl = document.getElementById("setScoreLeft");
  const setScoreRightEl = document.getElementById("setScoreRight");
  const keys = document.querySelectorAll(".key[data-value]");

  const META = {
    tournament: "第10回 全国モルック大会",
    match: "準決勝 A",
  };

  const teams = [
    { name: "チームさくら", score: 42, total: 125, misses: 0, won: false, disqualified: false, setWins: 2 },
    { name: "チームすずらん", score: 38, total: 118, misses: 1, won: false, disqualified: false, setWins: 1 },
  ];

  let activeTeamIndex = 0;
  let setStartTeamIndex = 0;
  let pendingSelection = null;
  let setEnded = false;
  let setWinnerIndex = null;
  const history = [];

  function getActiveTeam() {
    return teams[activeTeamIndex];
  }

  function cloneTeams() {
    return teams.map((team) => ({ ...team }));
  }

  function snapshot() {
    return {
      teams: cloneTeams(),
      activeTeamIndex,
      setStartTeamIndex,
      setEnded,
      setWinnerIndex,
    };
  }

  function restoreState(state) {
    teams.length = 0;
    state.teams.forEach((team) => teams.push({ ...team }));
    activeTeamIndex = state.activeTeamIndex;
    setStartTeamIndex = state.setStartTeamIndex;
    setEnded = state.setEnded;
    setWinnerIndex = state.setWinnerIndex;
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

  function renderTeamBoard() {
    teamBoardEl.className = `team-board team-board--count-${teams.length}`;

    teamBoardEl.innerHTML = teams
      .map((team, index) => {
        const isActive = !setEnded && index === activeTeamIndex;
        const isWinner = setEnded && index === setWinnerIndex;
        const victoryClass = team.won && !setEnded ? " team-card__score--victory" : "";
        const dqBadge = team.disqualified
          ? '<span class="team-card__badge">失格</span>'
          : '<span></span>';

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

  function renderInputTeamBanner() {
    if (setEnded) {
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
      "input-display__value--set-end"
    );

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
    keypadEl.classList.toggle("keypad--disabled", setEnded);
    confirmBtn.hidden = setEnded;
    confirmBtn.disabled = setEnded || pendingSelection === null;
    nextSetBtn.hidden = !setEnded;
    backBtn.disabled = history.length === 0;
  }

  function buildSyncState() {
    return {
      tournament: META.tournament,
      match: META.match,
      teams: cloneTeams(),
      activeTeamIndex,
      setEnded,
      setWinnerIndex,
      pendingSelection,
    };
  }

  function publishSync() {
    if (window.SMAScoreSync) {
      SMAScoreSync.publish(buildSyncState());
    }
  }

  function renderAll() {
    renderTeamBoard();
    renderSetHeader();
    renderInputTeamBanner();
    renderInputDisplay();
    renderControls();
    publishSync();
  }

  function selectValue(value) {
    if (setEnded) return;
    pendingSelection = value;
    renderInputDisplay();
    renderControls();
    publishSync();
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

  function endSet(winnerIndex) {
    setEnded = true;
    setWinnerIndex = winnerIndex;
    addCurrentScoresToTotals();
    pendingSelection = null;
  }

  function resolveAfterThrow(teamIndex) {
    const team = teams[teamIndex];

    if (team.disqualified) {
      if (teams.length === 2) {
        endSet(1 - teamIndex);
        return;
      }

      const remaining = getRemainingTeamIndices();
      if (remaining.length === 1) {
        endSet(remaining[0]);
        return;
      }

      advanceTeam();
      return;
    }

    if (team.score === 50) {
      endSet(teamIndex);
      return;
    }

    advanceTeam();
  }

  function advanceTeam() {
    if (setEnded) return;
    activeTeamIndex = getNextActiveIndex(activeTeamIndex);
  }

  function confirm() {
    if (setEnded || pendingSelection === null) return;

    history.push(snapshot());

    const teamIndex = activeTeamIndex;
    applySelection(getActiveTeam(), pendingSelection);
    pendingSelection = null;

    resolveAfterThrow(teamIndex);
    renderAll();
  }

  function rotateSetStartTeam() {
    if (teams.length === 2) {
      setStartTeamIndex = 1 - setStartTeamIndex;
    } else {
      setStartTeamIndex = (setStartTeamIndex + 1) % teams.length;
    }
  }

  function nextSet() {
    if (!setEnded || setWinnerIndex === null) return;

    history.push(snapshot());

    teams[setWinnerIndex].setWins += 1;

    rotateSetStartTeam();

    teams.forEach((team) => {
      team.score = 0;
      team.misses = 0;
      team.won = false;
      team.disqualified = false;
    });

    activeTeamIndex = setStartTeamIndex;
    setEnded = false;
    setWinnerIndex = null;
    pendingSelection = null;

    renderAll();
  }

  function back() {
    if (history.length === 0) return;

    restoreState(history.pop());
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

  renderAll();
})();
