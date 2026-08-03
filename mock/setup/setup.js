/**
 * SMAScore Setup — 設定保存と管理画面へ遷移
 * rematch ドラフトの読み込み、開始時の clear→publish 順序保証
 */
(function () {
  const form = document.querySelector(".setup__form");
  const titleEl = document.querySelector(".setup__title");
  const subtitleEl = document.querySelector(".setup__subtitle");
  const startBtn = form?.querySelector(".start-btn");
  const formatSection = document.querySelector(".field-group--format") || null;
  const teamsCountSection = document.querySelector(".field-group--team-count") || null;

  let starting = false;
  let rematchMode = false;

  function setTeamFieldsVisibility(teamCount) {
    document.querySelectorAll(".team-field").forEach((field) => {
      const n = Number(field.className.match(/team-field--(\d+)/)?.[1] || 0);
      field.style.display = n <= teamCount ? "" : "none";
    });
  }

  function applyDraft(draft) {
    if (!draft) return;

    rematchMode = draft.mode === "rematch";

    if (titleEl) titleEl.textContent = rematchMode ? "同じ試合をもう一度" : "試合設定";
    if (subtitleEl) {
      subtitleEl.textContent = rematchMode
        ? "試合名・チーム名を確認して開始してください（ルールは前試合を引き継ぎます）"
        : "大会・試合情報を入力してください";
    }

    const tournament = document.getElementById("tournament");
    const match = document.getElementById("match");
    if (tournament) tournament.value = draft.tournament || "";
    if (match) match.value = draft.match || "";

    const formatValue = draft.format || "win-2";
    const formatInput = form.querySelector(`input[name="format"][value="${formatValue}"]`);
    if (formatInput) formatInput.checked = true;

    const teamCount = Number(draft.teamCount) || 2;
    const teamsInput = form.querySelector(`input[name="teams"][value="${teamCount}"]`);
    if (teamsInput) teamsInput.checked = true;
    setTeamFieldsVisibility(teamCount);

    const names = Array.isArray(draft.teamNames) ? draft.teamNames : [];
    for (let i = 1; i <= 4; i += 1) {
      const input = document.getElementById(`team${i}`);
      if (input) input.value = names[i - 1] || "";
    }

    if (rematchMode) {
      form.querySelectorAll('input[name="format"], input[name="teams"]').forEach((input) => {
        input.disabled = true;
      });
      if (formatSection) formatSection.classList.add("field-group--locked");
      if (teamsCountSection) teamsCountSection.classList.add("field-group--locked");
    }
  }

  function readFormConfig() {
    const tournament = document.getElementById("tournament").value.trim();
    const match = document.getElementById("match").value.trim();
    const draft = window.SMAScoreMatchStart?.loadDraft?.();
    const format =
      form.querySelector('input[name="format"]:checked')?.value ||
      draft?.format ||
      "win-2";
    const teamCount = Number(
      form.querySelector('input[name="teams"]:checked')?.value || draft?.teamCount || 2
    );

    const teamNames = [];
    for (let i = 1; i <= teamCount; i += 1) {
      const name = document.getElementById(`team${i}`).value.trim();
      teamNames.push(name || `チーム ${i}`);
    }

    return { tournament, match, format, teamCount, teamNames };
  }

  function setStarting(busy) {
    starting = busy;
    if (startBtn) {
      startBtn.disabled = busy;
      startBtn.textContent = busy ? "準備中…" : "開始";
    }
  }

  // チーム数変更で入力欄の表示を切り替え
  form?.querySelectorAll('input[name="teams"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) setTeamFieldsVisibility(Number(input.value));
    });
  });

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  const draft = window.SMAScoreMatchStart?.loadDraft?.();

  if (mode === "rematch" && draft?.mode === "rematch") {
    applyDraft(draft);
  } else if (draft?.mode === "rematch" && mode !== "new") {
    // mode 無しでもドラフトがあれば引き継ぎ画面として扱う
    applyDraft(draft);
  } else {
    window.SMAScoreMatchStart?.clearDraft?.();
    setTeamFieldsVisibility(
      Number(form.querySelector('input[name="teams"]:checked')?.value ?? 2)
    );
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (starting) return;

    setStarting(true);

    try {
      const config = readFormConfig();
      const draftOverlay = window.SMAScoreMatchStart?.loadDraft?.()?.overlaySettings;

      await window.SMAScoreMatchStart.startNewMatch(config, {
        overlaySettings: draftOverlay,
      });

      const roomId = window.SMAScoreFirebase?.getRoomId?.() || "";
      window.location.href = roomId
        ? `../control/?room=${encodeURIComponent(roomId)}`
        : "../control/";
    } catch (error) {
      console.error("[SMAScore Setup] Failed to start match:", error);
      setStarting(false);
      window.alert("試合の開始に失敗しました。もう一度お試しください。");
    }
  });
})();
