/**
 * SMAScore Setup — 設定保存と管理画面へ遷移
 */
(function () {
  const form = document.querySelector(".setup__form");

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const tournament = document.getElementById("tournament").value.trim();
    const match = document.getElementById("match").value.trim();
    const format = form.querySelector('input[name="format"]:checked')?.value ?? "win-2";
    const teamCount = Number(form.querySelector('input[name="teams"]:checked')?.value ?? 2);

    const teamNames = [];
    for (let i = 1; i <= teamCount; i += 1) {
      const name = document.getElementById(`team${i}`).value.trim();
      teamNames.push(name || `チーム ${i}`);
    }

    SMAScoreMatchConfig.save({
      tournament,
      match,
      format,
      teamCount,
      teamNames,
      matchId: SMAScoreMatchConfig.createMatchId(),
    });

    window.location.href = "../control/";
  });
})();
