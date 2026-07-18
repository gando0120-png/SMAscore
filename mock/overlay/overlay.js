/**
 * SMAScore Overlay — 管理画面と同期表示（2～4チーム対応）
 */
(function () {
  const ThrowOrder = window.SMAScoreThrowOrder;

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
  const debugBackground = urlParams.get("debugBackground") === "1";

  if (debugBackground) {
    document.documentElement.classList.add("debug-background");
  }

  let prevScores = {};
  let currentMatchId = "";
  let currentOverlaySettings = window.SMAScoreOverlaySettings?.load() ?? {
    showTournament: true,
    showMatch: true,
    backgroundOpacity: "standard",
    scoreAnimation: true,
  };

  /** localStorage キー: smascore-game-state（試合同期）, smascore-overlay-settings（Overlay表示） */
  function createInitialState() {
    return {
      matchId: "",
      tournament: "",
      match: "",
      teamCount: 2,
      teams: [
        {
          name: "チーム1",
          score: 0,
          total: 0,
          misses: 0,
          won: false,
          disqualified: false,
          setWins: 0,
        },
        {
          name: "チーム2",
          score: 0,
          total: 0,
          misses: 0,
          won: false,
          disqualified: false,
          setWins: 0,
        },
      ],
      throwOrder: [0, 1],
      activeTeamIndex: 0,
      setStartTeamIndex: 0,
      setEnded: false,
      setWinnerIndex: null,
      matchEnded: false,
      matchWinnerIndex: null,
      pendingSelection: null,
      overlaySettings: currentOverlaySettings,
    };
  }

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
    const throwOrder = ThrowOrder
      ? ThrowOrder.fromStartIndex(count, Math.max(0, activeTeamIndex))
      : Array.from({ length: count }, (_, i) => i);

    if (demoSetEnd) {
      teams[0].won = true;
    }

    return {
      matchId: `demo-${count}`,
      tournament: "デモ大会",
      match: "デモ試合",
      teamCount: count,
      teams,
      throwOrder,
      activeTeamIndex: demoSetEnd ? 0 : activeTeamIndex,
      setStartTeamIndex: throwOrder[0] ?? 0,
      setEnded: demoSetEnd,
      setWinnerIndex,
      matchEnded: false,
      matchWinnerIndex: null,
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

  function resolveThrowOrder(state, count) {
    if (ThrowOrder) {
      if (Array.isArray(state.throwOrder)) {
        return ThrowOrder.normalize(state.throwOrder, count);
      }
      if (typeof state.setStartTeamIndex === "number") {
        return ThrowOrder.fromStartIndex(count, state.setStartTeamIndex);
      }
      return ThrowOrder.createDefault(count);
    }

    if (Array.isArray(state.throwOrder) && state.throwOrder.length === count) {
      return state.throwOrder.slice();
    }
    return Array.from({ length: count }, (_, i) => i);
  }

  function getOrderedEntries(state, count) {
    const source = state.teams || [];
    const order = resolveThrowOrder(state, count);
    return order.map((teamIndex) => ({
      teamIndex,
      team: source[teamIndex] || null,
    }));
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

  function renderWaitingContent(state, winnerTeam, matchWinnerTeam) {
    if (state.matchEnded) {
      const winnerName = matchWinnerTeam ? matchWinnerTeam.name : "—";
      return `
        <span class="waiting__winner">${winnerName}</span>
        <span class="waiting__label">試合終了</span>
      `;
    }

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

  function renderSetScores(entries, layout) {
    const dividerClass = entries.length === 2 ? "info__set-divider" : "info__set-divider info__set-divider--bar";
    const dividerText = entries.length === 2 ? "-" : "|";

    const nums = entries
      .map((entry, position) => {
        const wins = entry.team ? entry.team.setWins : 0;
        const colorClass = `info__set-num--${entry.teamIndex}`;
        const chunk = `<span class="info__set-num ${colorClass}">${wins}</span>`;
        if (position === 0) return chunk;
        return `<span class="${dividerClass}">${dividerText}</span>${chunk}`;
      })
      .join("");

    if (layout === "center") {
      const left = entries[0]?.team ? entries[0].team.setWins : 0;
      const right = entries[1]?.team ? entries[1].team.setWins : 0;
      const leftColor = entries[0] ? entries[0].teamIndex : 0;
      const rightColor = entries[1] ? entries[1].teamIndex : 1;
      return `
        <div class="center__set">
          <span class="center__set-label">SET</span>
          <span class="center__set-score">
            <span class="center__set-num info__set-num--${leftColor}">${left}</span>
            <span class="center__set-divider">-</span>
            <span class="center__set-num info__set-num--${rightColor}">${right}</span>
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

  function renderWaitingBlock(state, winnerTeam, matchWinnerTeam) {
    const endClass =
      state.matchEnded || state.setEnded
        ? " info__waiting--set-end"
        : "";
    return `
      <p class="info__waiting${endClass}">${renderWaitingContent(state, winnerTeam, matchWinnerTeam)}</p>
    `;
  }

  function renderTeamSide(team, teamIndex, side, isActive) {
    if (!team) {
      return `
        <section class="team team--${side}" data-team-index="${teamIndex}" aria-hidden="true">
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
      <section class="team team--${side} team--color-${teamIndex}${activeClass}" data-team-index="${teamIndex}" aria-label="${team.name}" style="--team-color:${TEAM_COLORS[teamIndex % 4]}">
        <p class="team__name">${team.name}${team.disqualified ? ' <span class="team__dq">失格</span>' : ""}</p>
        <p class="team__score${victoryClass}" aria-label="現在得点">${team.score}</p>
        <p class="team__total">${totalMarkup}</p>
        <p class="team__misses" aria-label="連続ミス">${renderMisses(team.misses, team.disqualified)}</p>
      </section>
    `;
  }

  function renderTeamCard(team, teamIndex, isActive) {
    if (!team) {
      return `
        <section class="team team--card" data-team-index="${teamIndex}" aria-hidden="true">
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
      <section class="team team--card team--color-${teamIndex}${activeClass}" data-team-index="${teamIndex}" aria-label="${team.name}" style="--team-color:${TEAM_COLORS[teamIndex % 4]}">
        <p class="team__name">${team.name}${team.disqualified ? ' <span class="team__dq">失格</span>' : ""}</p>
        <p class="team__score${victoryClass}" aria-label="現在得点">${team.score}</p>
        <p class="team__total"><span class="team__total-label">TOTAL</span><span class="team__total-value">${team.total}</span></p>
        <p class="team__misses" aria-label="連続ミス">${renderMisses(team.misses, team.disqualified)}</p>
      </section>
    `;
  }

  function renderOverlayTwo(entries, state, activeIndex, activeTeam, winnerTeam, matchWinnerTeam) {
    const left = entries[0];
    const right = entries[1];
    const leftColor = TEAM_COLORS[(left?.teamIndex ?? 0) % 4];
    const rightColor = TEAM_COLORS[(right?.teamIndex ?? 1) % 4];

    overlayRoot.className = "overlay overlay--2";
    overlayRoot.style.setProperty("--accent-left", leftColor);
    overlayRoot.style.setProperty("--accent-right", rightColor);
    overlayRoot.innerHTML = `
      ${renderTeamSide(left?.team, left?.teamIndex ?? 0, "left", activeIndex === (left?.teamIndex ?? -1))}
      <section class="center" aria-label="試合状況">
        ${renderSetScores(entries, "center")}
        ${renderThrowBlock(activeTeam)}
        ${renderWaitingBlock(state, winnerTeam, matchWinnerTeam)}
      </section>
      ${renderTeamSide(right?.team, right?.teamIndex ?? 1, "right", activeIndex === (right?.teamIndex ?? -1))}
    `;
  }

  function renderOverlayMulti(teamCount, entries, state, activeIndex, activeTeam, winnerTeam, matchWinnerTeam) {
    const layoutClass = teamCount === 3 ? "overlay--3" : "overlay--4";
    overlayRoot.className = `overlay ${layoutClass}`;
    overlayRoot.innerHTML = `
      <header class="overlay__info" aria-label="試合状況">
        ${renderSetScores(entries, "info")}
        ${renderThrowBlock(activeTeam)}
        ${renderWaitingBlock(state, winnerTeam, matchWinnerTeam)}
      </header>
      <div class="overlay__teams">
        ${entries.map((entry) => renderTeamCard(entry.team, entry.teamIndex, activeIndex === entry.teamIndex)).join("")}
      </div>
    `;
  }

  function applyScoreAnimations(entries, settings) {
    const scoreByTeamIndex = {};
    entries.forEach((entry) => {
      scoreByTeamIndex[entry.teamIndex] = entry.team ? entry.team.score : 0;
    });

    if (!settings.scoreAnimation) {
      prevScores = scoreByTeamIndex;
      return;
    }

    entries.forEach((entry) => {
      if (!entry.team || !prevScores || typeof prevScores !== "object") return;
      if (prevScores[entry.teamIndex] === entry.team.score) return;

      const section = overlayRoot.querySelector(`[data-team-index="${entry.teamIndex}"]`);
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

    prevScores = scoreByTeamIndex;
  }

  function renderOverlay(state) {
    const settings = resolveOverlaySettings(state);
    applyVisualSettings(settings);
    renderMetaBar(state, settings);

    const teamCount = resolveTeamCount(state);
    const entries = getOrderedEntries(state, teamCount);
    const activeIndex =
      state.matchEnded || state.setEnded ? -1 : state.activeTeamIndex;
    const activeTeam =
      activeIndex >= 0 ? (state.teams || [])[activeIndex] || null : null;
    const winnerTeam =
      state.setEnded && state.setWinnerIndex !== null && state.setWinnerIndex !== undefined
        ? (state.teams || [])[state.setWinnerIndex]
        : null;
    const matchWinnerTeam =
      state.matchEnded &&
      state.matchWinnerIndex !== null &&
      state.matchWinnerIndex !== undefined
        ? (state.teams || [])[state.matchWinnerIndex]
        : null;

    if (teamCount === 2) {
      renderOverlayTwo(entries, state, activeIndex, activeTeam, winnerTeam, matchWinnerTeam);
    } else {
      renderOverlayMulti(teamCount, entries, state, activeIndex, activeTeam, winnerTeam, matchWinnerTeam);
    }

    applyScoreAnimations(entries, settings);
  }

  function resetForNewMatch(matchId) {
    currentMatchId = matchId || "";
    prevScores = {};
  }

  function applyState(state) {
    if (demoTeamCount !== null) {
      renderOverlay(createDemoState(demoTeamCount));
      return;
    }

    const next = state || createInitialState();
    const incomingMatchId =
      window.SMAScoreSync?.getMatchId?.(next) ||
      (typeof next.matchId === "string" ? next.matchId : "") ||
      "";

    if (incomingMatchId && currentMatchId && incomingMatchId !== currentMatchId) {
      resetForNewMatch(incomingMatchId);
    } else if (incomingMatchId && !currentMatchId) {
      currentMatchId = incomingMatchId;
    }

    renderOverlay(next);
  }

  applyVisualSettings(currentOverlaySettings);

  if (window.SMAScoreSync) {
    SMAScoreSync.subscribe(applyState);
    applyState(SMAScoreSync.read());
  } else {
    applyState(null);
  }
})();
