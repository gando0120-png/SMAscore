/**
 * SMAScore Overlay — 管理画面と同期表示（2～4チーム対応）
 */
(function () {
  const overlayWrap = document.getElementById("overlayWrap");
  const overlayMeta = document.getElementById("overlayMeta");
  const overlayRoot = document.getElementById("overlayRoot");

  const TEAM_COLORS = ["#448aff", "#ff5252", "#66bb6a", "#ffca28"];
  const DEMO_NAMES = ["青チーム", "赤チーム", "緑チーム", "黄チーム"];

  const urlParams = new URLSearchParams(window.location.search);
  const demoTeamCount = parseDemoParam(urlParams.get("demo"));
  const demoPending = urlParams.get("sel");
  const demoSetEnd = urlParams.get("setend") === "1";
  const demoActive = urlParams.has("active") ? Number(urlParams.get("active")) : 1;

  let prevScores = [];
  let currentOverlaySettings = window.SMAScoreOverlaySettings?.load() ?? {
    showTournament: true,
    showMatch: true,
    backgroundOpacity: "standard",
    scoreAnimation: true,
  };

  function parseDemoParam(value) {
    const n = Number(value);
    if (n >= 2 && n <= 4) return n;
    return null;
  }

  function createDemoState(count) {
    const scores = [37, 42, 28, 31];
    const totals = [112, 98, 87, 76];
    const misses = [1, 0, 2, 0];
    const setWins = [1, 0, 2, 1];

    const teams = Array.from({ length: count }, (_, i) => ({
      name: DEMO_NAMES[i],
      score: scores[i],
      total: totals[i],
      misses: misses[i],
      won: false,
      disqualified: count === 4 && i === 2,
      setWins: setWins[i],
    }));

    let pendingSelection = null;
    if (demoPending === "F") {
      pendingSelection = "F";
    } else if (demoPending !== null && demoPending !== "") {
      const num = Number(demoPending);
      if (!Number.isNaN(num)) pendingSelection = num;
    }

    const activeTeamIndex = demoSetEnd ? -1 : Math.min(Math.max(0, demoActive), count - 1);
    const setWinnerIndex = demoSetEnd ? 0 : null;

    if (demoSetEnd) {
      teams[0].won = true;
    }

    return {
      tournament: "デモ大会",
      match: "デモ試合",
      teamCount: count,
      teams,
      activeTeamIndex: demoSetEnd ? 0 : activeTeamIndex,
      setEnded: demoSetEnd,
      setWinnerIndex,
      pendingSelection: demoSetEnd ? null : pendingSelection,
      overlaySettings: currentOverlaySettings,
    };
  }

  function resolveTeamCount(state) {
    if (state.teamCount >= 2 && state.teamCount <= 4) return state.teamCount;
    const len = (state.teams || []).length;
    if (len >= 2 && len <= 4) return len;
    return 2;
  }

  function getTeams(state, count) {
    const source = state.teams || [];
    return Array.from({ length: count }, (_, i) => source[i] || null);
  }

  function resolveOverlaySettings(state) {
    if (window.SMAScoreOverlaySettings) {
      currentOverlaySettings = SMAScoreOverlaySettings.load();
    }
    if (state?.overlaySettings) {
      currentOverlaySettings = { ...currentOverlaySettings, ...state.overlaySettings };
    }
    return currentOverlaySettings;
  }

  function applyVisualSettings(settings) {
    const opacity = window.SMAScoreOverlaySettings
      ? SMAScoreOverlaySettings.getOpacityValue(settings.backgroundOpacity)
      : 0.82;
    overlayWrap.style.setProperty("--overlay-bg-opacity", String(opacity));
  }

  function renderMetaBar(state, settings) {
    const tournament = state.tournament?.trim();
    const match = state.match?.trim();
    const showTournament = settings.showTournament && tournament;
    const showMatch = settings.showMatch && match;

    if (!showTournament && !showMatch) {
      overlayMeta.hidden = true;
      overlayMeta.innerHTML = "";
      return;
    }

    overlayMeta.hidden = false;
    overlayMeta.innerHTML = `
      ${showTournament ? `<p class="overlay__tournament">${tournament}</p>` : ""}
      ${showMatch ? `<p class="overlay__match">${match}</p>` : ""}
    `;
  }

  function renderMisses(misses, disqualified) {
    const count = disqualified ? 3 : misses;
    return [0, 1, 2]
      .map((i) => {
        const on = i < count ? " miss--on" : "";
        return `<span class="miss${on}" aria-hidden="true">×</span>`;
      })
      .join("");
  }

  function renderWaitingContent(state, winnerTeam) {
    if (state.setEnded) {
      const winnerName = winnerTeam ? winnerTeam.name : "—";
      return `
        <span class="waiting__winner">${winnerName}</span>
        <span class="waiting__label">セット終了</span>
      `;
    }

    if (state.pendingSelection !== null && state.pendingSelection !== undefined) {
      const val = state.pendingSelection === "F" ? "F" : String(state.pendingSelection);
      const foulClass = state.pendingSelection === "F" ? " waiting__value--foul" : "";
      return `
        <span class="waiting__status">入力中</span>
        <span class="waiting__value${foulClass}">${val}</span>
      `;
    }

    return `<span class="waiting__status">入力待ち</span>`;
  }

  function renderSetScores(teams, layout) {
    const nums = teams
      .map((team, index) => {
        const wins = team ? team.setWins : 0;
        const colorClass = `info__set-num--${index}`;
        return `<span class="info__set-num ${colorClass}">${wins}</span>`;
      })
      .join(`<span class="info__set-divider">-</span>`);

    if (layout === "center") {
      const left = teams[0] ? teams[0].setWins : 0;
      const right = teams[1] ? teams[1].setWins : 0;
      return `
        <div class="center__set">
          <span class="center__set-label">SET</span>
          <span class="center__set-score">
            <span class="center__set-num center__set-num--left">${left}</span>
            <span class="center__set-divider">-</span>
            <span class="center__set-num center__set-num--right">${right}</span>
          </span>
        </div>
      `;
    }

    return `
      <div class="info__set">
        <span class="info__set-label">SET</span>
        <span class="info__set-score">${nums}</span>
      </div>
    `;
  }

  function renderThrowBlock(activeTeam) {
    return `
      <p class="info__throw">
        <span class="info__throw-label">投擲</span>
        <span class="info__throw-name">${activeTeam ? activeTeam.name : "—"}</span>
      </p>
    `;
  }

  function renderWaitingBlock(state, winnerTeam) {
    const setEndClass = state.setEnded ? " info__waiting--set-end" : "";
    return `
      <p class="info__waiting${setEndClass}">${renderWaitingContent(state, winnerTeam)}</p>
    `;
  }

  function renderTeamSide(team, index, side, isActive) {
    if (!team) {
      return `
        <section class="team team--${side}" data-team-index="${index}" aria-hidden="true">
          <p class="team__name">—</p>
          <p class="team__score">0</p>
          <p class="team__total"><span class="team__total-label">TOTAL</span><span class="team__total-value">0</span></p>
          <p class="team__misses">${renderMisses(0, false)}</p>
        </section>
      `;
    }

    const activeClass = isActive ? " team--active" : "";
    const victoryClass = team.won ? " team__score--victory" : "";
    const totalMarkup =
      side === "right"
        ? `<span class="team__total-value">${team.total}</span><span class="team__total-label">TOTAL</span>`
        : `<span class="team__total-label">TOTAL</span><span class="team__total-value">${team.total}</span>`;

    return `
      <section class="team team--${side} team--color-${index}${activeClass}" data-team-index="${index}" aria-label="${team.name}" style="--team-color:${TEAM_COLORS[index % 4]}">
        <p class="team__name">${team.name}${team.disqualified ? ' <span class="team__dq">失格</span>' : ""}</p>
        <p class="team__score${victoryClass}" aria-label="現在得点">${team.score}</p>
        <p class="team__total">${totalMarkup}</p>
        <p class="team__misses" aria-label="連続ミス">${renderMisses(team.misses, team.disqualified)}</p>
      </section>
    `;
  }

  function renderTeamCard(team, index, isActive) {
    if (!team) {
      return `
        <section class="team team--card" data-team-index="${index}" aria-hidden="true">
          <p class="team__name">—</p>
          <p class="team__score">0</p>
          <p class="team__total"><span class="team__total-label">TOTAL</span><span class="team__total-value">0</span></p>
          <p class="team__misses">${renderMisses(0, false)}</p>
        </section>
      `;
    }

    const activeClass = isActive ? " team--active" : "";
    const victoryClass = team.won ? " team__score--victory" : "";

    return `
      <section class="team team--card team--color-${index}${activeClass}" data-team-index="${index}" aria-label="${team.name}" style="--team-color:${TEAM_COLORS[index % 4]}">
        <p class="team__name">${team.name}${team.disqualified ? ' <span class="team__dq">失格</span>' : ""}</p>
        <p class="team__score${victoryClass}" aria-label="現在得点">${team.score}</p>
        <p class="team__total"><span class="team__total-label">TOTAL</span><span class="team__total-value">${team.total}</span></p>
        <p class="team__misses" aria-label="連続ミス">${renderMisses(team.misses, team.disqualified)}</p>
      </section>
    `;
  }

  function renderOverlayTwo(teams, state, activeIndex, activeTeam, winnerTeam) {
    overlayRoot.className = "overlay overlay--2";
    overlayRoot.innerHTML = `
      ${renderTeamSide(teams[0], 0, "left", activeIndex === 0)}
      <section class="center" aria-label="試合状況">
        ${renderSetScores(teams, "center")}
        ${renderThrowBlock(activeTeam)}
        ${renderWaitingBlock(state, winnerTeam)}
      </section>
      ${renderTeamSide(teams[1], 1, "right", activeIndex === 1)}
    `;
  }

  function renderOverlayMulti(teamCount, teams, state, activeIndex, activeTeam, winnerTeam) {
    const layoutClass = teamCount === 3 ? "overlay--3" : "overlay--4";
    overlayRoot.className = `overlay ${layoutClass}`;
    overlayRoot.innerHTML = `
      <header class="overlay__info" aria-label="試合状況">
        ${renderSetScores(teams, "info")}
        ${renderThrowBlock(activeTeam)}
        ${renderWaitingBlock(state, winnerTeam)}
      </header>
      <div class="overlay__teams">
        ${teams.map((team, index) => renderTeamCard(team, index, activeIndex === index)).join("")}
      </div>
    `;
  }

  function applyScoreAnimations(teams, settings) {
    const nextScores = teams.map((team) => (team ? team.score : 0));

    if (!settings.scoreAnimation) {
      prevScores = nextScores;
      return;
    }

    teams.forEach((team, index) => {
      if (!team || prevScores.length === 0) return;
      if (prevScores[index] === team.score) return;

      const section = overlayRoot.querySelector(`[data-team-index="${index}"]`);
      const scoreEl = section?.querySelector(".team__score");
      if (!scoreEl) return;

      scoreEl.classList.remove("team__score--animate");
      void scoreEl.offsetWidth;
      scoreEl.classList.add("team__score--animate");
      scoreEl.addEventListener(
        "animationend",
        () => scoreEl.classList.remove("team__score--animate"),
        { once: true }
      );
    });

    prevScores = nextScores;
  }

  function renderOverlay(state) {
    const settings = resolveOverlaySettings(state);
    applyVisualSettings(settings);
    renderMetaBar(state, settings);

    const teamCount = resolveTeamCount(state);
    const teams = getTeams(state, teamCount);
    const activeIndex = state.setEnded ? -1 : state.activeTeamIndex;
    const activeTeam = activeIndex >= 0 ? teams[activeIndex] : null;
    const winnerTeam =
      state.setEnded && state.setWinnerIndex !== null && state.setWinnerIndex !== undefined
        ? teams[state.setWinnerIndex]
        : null;

    if (teamCount === 2) {
      renderOverlayTwo(teams, state, activeIndex, activeTeam, winnerTeam);
    } else {
      renderOverlayMulti(teamCount, teams, state, activeIndex, activeTeam, winnerTeam);
    }

    applyScoreAnimations(teams, settings);
  }

  function applyState(state) {
    if (demoTeamCount !== null) {
      renderOverlay(createDemoState(demoTeamCount));
      return;
    }
    if (state) renderOverlay(state);
  }

  applyVisualSettings(currentOverlaySettings);

  if (window.SMAScoreSync) {
    SMAScoreSync.subscribe(applyState);
    const initial = SMAScoreSync.read();
    if (initial || demoTeamCount !== null) applyState(initial);
  } else if (demoTeamCount !== null) {
    applyState(null);
  }
})();
