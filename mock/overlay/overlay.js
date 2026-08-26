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
      overlayDisplayMode: "score",
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
      overlayDisplayMode: "score",
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

  function shouldShowResultOverlay(state) {
    if (!state?.matchEnded) return false;
    if (state.overlayDisplayMode !== "result") return false;
    const stateMatchId =
      window.SMAScoreSync?.getMatchId?.(state) ||
      (typeof state.matchId === "string" ? state.matchId : "") ||
      "";
    // 別試合の result を誤表示しない
    if (currentMatchId && stateMatchId && stateMatchId !== currentMatchId) return false;
    return true;
  }

  function resolveDisplayMode(state) {
    // 進行中試合は常に通常スコア。欠損時も score
    if (!state?.matchEnded) return "score";
    return state.overlayDisplayMode === "result" ? "result" : "score";
  }

  function hardResetResultUi() {
    prevScores = {};
    if (!overlayRoot) return;
    overlayRoot.classList.remove(
      "overlay--result",
      "overlay--result-compact",
      "overlay--result-dense",
      "overlay--result-2",
      "overlay--result-3",
      "overlay--result-4"
    );
    // result DOM を残さない（次の描画まで空でもよい）
    if (overlayRoot.querySelector(".result-board")) {
      overlayRoot.innerHTML = "";
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function totalsFromSetResults(state) {
    const teams = state.teams || [];
    const setResults = Array.isArray(state.setResults) ? state.setResults : [];
    return teams.map((team, index) => {
      const fromResults = setResults.reduce((sum, result) => {
        const row = (result.scores || []).find((score) => score.teamIndex === index);
        return sum + (Number(row?.score) || 0);
      }, 0);
      return fromResults || Number(team.total) || 0;
    });
  }

  function renderResultOverlay(state) {
    const teams = state.teams || [];
    const teamCount = resolveTeamCount(state);
    const setResults = Array.isArray(state.setResults) ? state.setResults : [];
    const totals = totalsFromSetResults(state);
    const winnerName =
      state.matchWinnerIndex !== null && state.matchWinnerIndex !== undefined
        ? teams[state.matchWinnerIndex]?.name || `チーム ${state.matchWinnerIndex + 1}`
        : "引き分け";

    const matchEndReason = state.matchEndReason || "";
    const endReasonText =
      matchEndReason === "time_limit"
        ? "時間切れ終了"
        : matchEndReason === "disqualification"
          ? "失格による終了"
          : "";
    const titleText = matchEndReason === "time_limit" ? "試合終了（時間切れ）" : "試合終了";

    const setHeaders = setResults
      .map((result) => `<th scope="col">S${result.setNumber}</th>`)
      .join("");

    const bodyRows = teams
      .slice(0, teamCount)
      .map((team, teamIndex) => {
        const cells = setResults
          .map((result) => {
            const row = (result.scores || []).find((score) => score.teamIndex === teamIndex);
            const score = row ? Number(row.score) || 0 : "—";
            const winnerClass =
              result.winnerTeamIndex === teamIndex ? " result-table__cell--winner" : "";
            const dq = row?.disqualified ? '<span class="result-table__dq">失格</span>' : "";
            const timeLimit =
              result.endReason === "time_limit" && !row?.disqualified
                ? ""
                : "";
            return `<td class="result-table__cell${winnerClass}">${score}${dq}${timeLimit}</td>`;
          })
          .join("");
        const isWinner = state.matchWinnerIndex === teamIndex;
        return `
          <tr class="result-table__row${isWinner ? " result-table__row--winner" : ""}" data-team-index="${teamIndex}">
            <th scope="row" class="result-table__name">
              <span class="result-table__swatch" style="--team-color:${TEAM_COLORS[teamIndex % 4]}"></span>
              ${escapeHtml(team.name)}
            </th>
            ${cells}
            <td class="result-table__cell result-table__cell--sets">${Number(team.setWins) || 0}</td>
            <td class="result-table__cell result-table__cell--total">${totals[teamIndex] ?? 0}</td>
          </tr>
        `;
      })
      .join("");

    const compactClass =
      setResults.length >= 4 || teamCount >= 4
        ? " overlay--result-compact"
        : setResults.length >= 3 || teamCount >= 3
          ? " overlay--result-dense"
          : "";

    const hasTimeLimitSet = setResults.some((result) => result.endReason === "time_limit");

    overlayRoot.className = `overlay overlay--result overlay--result-${teamCount}${compactClass}`;
    overlayRoot.innerHTML = `
      <div class="result-board" aria-label="試合最終結果">
        <header class="result-board__header">
          <p class="result-board__title">${titleText}</p>
          <p class="result-board__winner">勝者：${escapeHtml(winnerName)}</p>
        </header>
        ${
          endReasonText || hasTimeLimitSet
            ? `<p class="result-board__reason">${endReasonText || "時間切れを含む結果"}</p>`
            : ""
        }
        <table class="result-table">
          <thead>
            <tr>
              <th scope="col" class="result-table__name-head">チーム</th>
              ${setHeaders}
              <th scope="col">SET</th>
              <th scope="col">合計</th>
            </tr>
          </thead>
          <tbody>
            ${bodyRows || `<tr><td colspan="${Math.max(3, setResults.length + 3)}">結果がありません</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderOverlay(state) {
    const settings = resolveOverlaySettings(state);
    applyVisualSettings(settings);
    renderMetaBar(state, settings);

    const viewState = { ...state, overlayDisplayMode: resolveDisplayMode(state) };

    if (shouldShowResultOverlay(viewState)) {
      renderResultOverlay(viewState);
      prevScores = {};
      return;
    }

    // result から score へ戻るとき残存 class / DOM を確実に除去
    if (overlayRoot.classList.contains("overlay--result") || overlayRoot.querySelector(".result-board")) {
      hardResetResultUi();
    }

    const teamCount = resolveTeamCount(viewState);
    const entries = getOrderedEntries(viewState, teamCount);
    const activeIndex =
      viewState.matchEnded || viewState.setEnded ? -1 : viewState.activeTeamIndex;
    const activeTeam =
      activeIndex >= 0 ? (viewState.teams || [])[activeIndex] || null : null;
    const winnerTeam =
      viewState.setEnded && viewState.setWinnerIndex !== null && viewState.setWinnerIndex !== undefined
        ? (viewState.teams || [])[viewState.setWinnerIndex]
        : null;
    const matchWinnerTeam =
      viewState.matchEnded &&
      viewState.matchWinnerIndex !== null &&
      viewState.matchWinnerIndex !== undefined
        ? (viewState.teams || [])[viewState.matchWinnerIndex]
        : null;

    if (teamCount === 2) {
      renderOverlayTwo(entries, viewState, activeIndex, activeTeam, winnerTeam, matchWinnerTeam);
    } else {
      renderOverlayMulti(teamCount, entries, viewState, activeIndex, activeTeam, winnerTeam, matchWinnerTeam);
    }

    applyScoreAnimations(entries, settings);
  }

  let lastAppliedUpdatedAt = 0;

  function resetForNewMatch(matchId) {
    currentMatchId = matchId || "";
    hardResetResultUi();
  }

  function applyState(state) {
    if (demoTeamCount !== null) {
      renderOverlay(createDemoState(demoTeamCount));
      return;
    }

    // 明示 clear（null）時のみ結果UIを破棄して待機表示
    if (state === null) {
      hardResetResultUi();
      currentMatchId = "";
      lastAppliedUpdatedAt = 0;
      renderOverlay(createInitialState());
      return;
    }

    const next = { ...(state || createInitialState()) };
    const incomingMatchId =
      window.SMAScoreSync?.getMatchId?.(next) ||
      (typeof next.matchId === "string" ? next.matchId : "") ||
      "";
    const incomingTs = typeof next.updatedAt === "number" ? next.updatedAt : 0;

    if (incomingMatchId && currentMatchId && incomingMatchId !== currentMatchId) {
      // 新 matchId: 結果UIを必ず破棄してから描画（sync 層が受理した state を信頼）
      resetForNewMatch(incomingMatchId);
    } else if (incomingMatchId && !currentMatchId) {
      currentMatchId = incomingMatchId;
    }

    // 新試合・進行中は必ず score。欠損も score
    next.overlayDisplayMode = resolveDisplayMode(next);

    if (incomingTs) {
      lastAppliedUpdatedAt = Math.max(lastAppliedUpdatedAt, incomingTs);
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
