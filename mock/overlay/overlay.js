/**
 * SMAScore Overlay — 管理画面と同期表示
 */
(function () {
  const overlayRoot = document.getElementById("overlayRoot");

  const TEAM_COLORS = ["#448aff", "#ff5252", "#66bb6a", "#ffca28"];

  function renderMisses(misses, disqualified) {
    const count = disqualified ? 3 : misses;
    return [0, 1, 2]
      .map((i) => {
        const on = i < count ? " miss--on" : "";
        return `<span class="miss${on}" aria-hidden="true">×</span>`;
      })
      .join("");
  }

  function renderTeamSide(team, index, side, isActive) {
    if (!team) {
      return `
        <section class="team team--${side}" aria-hidden="true">
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
      <section class="team team--${side} team--color-${index}${activeClass}" aria-label="${team.name}" style="--team-color:${TEAM_COLORS[index % 4]}">
        <p class="team__name">${team.name}${team.disqualified ? ' <span class="team__dq">失格</span>' : ""}</p>
        <p class="team__score${victoryClass}" aria-label="現在得点">${team.score}</p>
        <p class="team__total">${totalMarkup}</p>
        <p class="team__misses" aria-label="連続ミス">${renderMisses(team.misses, team.disqualified)}</p>
      </section>
    `;
  }

  function renderOverlay(state) {
    const teams = state.teams || [];
    const left = teams[0];
    const right = teams[1];
    const activeIndex = state.setEnded ? -1 : state.activeTeamIndex;
    const activeTeam = activeIndex >= 0 ? teams[activeIndex] : null;

    let waitingText = "入力待ち";
    if (state.setEnded) {
      waitingText = "セット終了";
    } else if (state.pendingSelection !== null && state.pendingSelection !== undefined) {
      waitingText = "入力中";
    }

    const setLeft = left ? left.setWins : 0;
    const setRight = right ? right.setWins : 0;

    overlayRoot.innerHTML = `
      ${renderTeamSide(left, 0, "left", activeIndex === 0)}
      <section class="center" aria-label="試合状況">
        <div class="center__set">
          <span class="center__set-label">SET</span>
          <span class="center__set-score">
            <span class="center__set-num center__set-num--left">${setLeft}</span>
            <span class="center__set-divider">-</span>
            <span class="center__set-num center__set-num--right">${setRight}</span>
          </span>
        </div>
        <p class="center__throw">
          <span class="center__throw-label">投擲</span>
          <span class="center__throw-name">${activeTeam ? activeTeam.name : "—"}</span>
        </p>
        <p class="center__waiting${state.setEnded ? " center__waiting--set-end" : ""}">${waitingText}</p>
      </section>
      ${renderTeamSide(right, 1, "right", activeIndex === 1)}
    `;
  }

  if (window.SMAScoreSync) {
    SMAScoreSync.subscribe(renderOverlay);
    const initial = SMAScoreSync.read();
    if (initial) renderOverlay(initial);
  }
})();
