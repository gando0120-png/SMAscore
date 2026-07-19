/**
 * Browser verification for throwOrder / SET display / overlay transparency
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "/tmp/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../mock");
const PORT = 8765;
let ROOM = `verify-${Date.now()}`;
let roomSeq = 0;

function nextRoom() {
  roomSeq += 1;
  ROOM = `verify-${Date.now()}-${roomSeq}`;
  return ROOM;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      let filePath = path.join(ROOT, urlPath === "/" ? "/setup/index.html" : urlPath);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(fs.readFileSync(filePath));
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function withPage(browser, url, fn) {
  const page = await browser.newPage();
  page.on("dialog", async (dialog) => {
    await dialog.accept();
  });
  await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

async function seedMatch(page, teamNames, format = "win-2", options = {}) {
  const matchId =
    options.matchId ||
    `match-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.evaluate(
    ({ teamNames, format, room, matchId, tournament, match }) => {
      localStorage.setItem("smascore-room-id", room);
      localStorage.setItem(
        "smascore-match-config",
        JSON.stringify({
          tournament,
          match,
          format,
          teamCount: teamNames.length,
          teamNames,
          matchId,
        })
      );
      localStorage.removeItem("smascore-game-state");
    },
    {
      teamNames,
      format,
      room: options.room || ROOM,
      matchId,
      tournament: options.tournament || "検証大会",
      match: options.match || "検証試合",
    }
  );
  return matchId;
}

async function openControl(browser, teamNames, options = {}) {
  const room = options.room || nextRoom();
  ROOM = room;
  const page = await browser.newPage();
  page.on("dialog", async (dialog) => {
    await dialog.accept();
  });
  await page.goto(`http://127.0.0.1:${PORT}/setup/?room=${room}`, {
    waitUntil: "networkidle0",
  });
  if (!options.reuseState) {
    await seedMatch(page, teamNames, "win-2", {
      room,
      matchId: options.matchId,
      tournament: options.tournament,
      match: options.match,
    });
  } else {
    await page.evaluate(
      ({ teamNames, room, matchId }) => {
        localStorage.setItem("smascore-room-id", room);
        const existing = (() => {
          try {
            return JSON.parse(localStorage.getItem("smascore-match-config") || "null");
          } catch {
            return null;
          }
        })();
        localStorage.setItem(
          "smascore-match-config",
          JSON.stringify({
            tournament: existing?.tournament || "検証大会",
            match: existing?.match || "検証試合",
            format: existing?.format || "win-2",
            teamCount: teamNames.length,
            teamNames,
            matchId: matchId || existing?.matchId || `match-${Date.now()}`,
          })
        );
      },
      { teamNames, room, matchId: options.matchId }
    );
  }
  await page.goto(`http://127.0.0.1:${PORT}/control/?room=${room}`, {
    waitUntil: "networkidle0",
  });
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await page.waitForSelector("#teamBoard .team-card");
  await page.waitForSelector("#throwOrderList .throw-order__row");
  await page.waitForFunction(() => {
    const sync = window.SMAScoreSync;
    return sync && sync.read() && sync.read().teams && Array.isArray(sync.read().throwOrder);
  });
  // bootstrap 完了（suppressPublish 解除）を待つ
  await page.waitForFunction(() => {
    const state = window.SMAScoreSync.read();
    return state && typeof state.revision === "number" && state.revision > 0;
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  return page;
}

async function waitForThrowOrder(page, expected) {
  const expectedJson = JSON.stringify(expected);
  await page.waitForFunction(
    (json) => {
      const state = window.SMAScoreSync?.read();
      return state && JSON.stringify(state.throwOrder) === json;
    },
    { timeout: 10000 },
    expectedJson
  );
}

async function reorderTeam(page, teamIndex, action) {
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  // フッターに隠れる場合があるため DOM click を使う
  await page.evaluate(
    ({ teamIndex, action }) => {
      const btn = document.querySelector(
        `.throw-order__row[data-team-index="${teamIndex}"] [data-action="${action}"]`
      );
      if (!btn || btn.disabled) {
        throw new Error(`throw-order button unavailable: team=${teamIndex} action=${action}`);
      }
      btn.scrollIntoView({ block: "center" });
      btn.click();
    },
    { teamIndex, action }
  );
}

async function openOverlay(browser) {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/overlay/?room=${ROOM}`, {
    waitUntil: "networkidle0",
  });
  await page.waitForSelector("#overlayRoot .team");
  return page;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: "/usr/local/bin/google-chrome",
    headless: true,
    protocolTimeout: 120000,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });

  const results = [];

  try {
    // 1) 2 teams A→B
    {
      const control = await openControl(browser, ["A", "B"]);
      const names = await control.$$eval("#teamBoard .team-card__name", (els) =>
        els.map((el) => el.textContent.trim())
      );
      assert(names.join("|") === "A|B", `1 failed: ${names.join("|")}`);
      const setText = await control.$eval("#setScore", (el) => el.textContent.replace(/\s+/g, ""));
      assert(setText.includes("A") && setText.includes("B") && setText.includes("セット"), `1 set: ${setText}`);
      results.push("1. 2チーム A→B OK");
      await control.close();
    }

    // 2) 2 teams B→A via reorder
    {
      const control = await openControl(browser, ["A", "B"]);
      await reorderTeam(control, 1, "front");
      await waitForThrowOrder(control, [1, 0]);
      const state = await control.evaluate(() => window.SMAScoreSync.read());
      assert(state.activeTeamIndex === 1, "2 active");
      const names = await control.$$eval("#teamBoard .team-card__name", (els) =>
        els.map((el) => el.textContent.trim())
      );
      assert(names.join("|") === "B|A", `2 names ${names}`);
      results.push("2. 2チーム B→A OK");

      const overlay = await openOverlay(browser);
      await overlay.waitForFunction(() => {
        const state = window.SMAScoreSync?.read();
        return state && JSON.stringify(state.throwOrder) === "[1,0]";
      });
      const overlayNames = await overlay.$$eval("#overlayRoot .team__name", (els) =>
        els.map((el) => el.textContent.replace(/失格/g, "").trim())
      );
      assert(overlayNames.join("|") === "B|A", `2 overlay ${overlayNames.join("|")}`);
      await overlay.close();
      await control.close();
    }

    // 3) 3 teams A→B→C
    {
      const control = await openControl(browser, ["A", "B", "C"]);
      const names = await control.$$eval("#teamBoard .team-card__name", (els) =>
        els.map((el) => el.textContent.trim())
      );
      assert(names.join("|") === "A|B|C", `3 names ${names}`);
      const setHtml = await control.$eval("#setScore", (el) => el.innerText);
      assert(
        setHtml.includes("A") && setHtml.includes("B") && setHtml.includes("C"),
        `3 set header missing team: ${setHtml}`
      );
      const overlay = await openOverlay(browser);
      const setNums = await overlay.$$eval(".info__set-num", (els) => els.map((el) => el.textContent));
      assert(setNums.length === 3, `3 overlay set count ${setNums.length}`);
      const cards = await overlay.$$eval("#overlayRoot .team--card", (els) => els.length);
      assert(cards === 3, `3 overlay cards ${cards}`);
      results.push("3. 3チーム A→B→C + SET全表示 OK");
      await overlay.close();
      await control.close();
    }

    // 4) 3 teams C→A→B
    {
      const control = await openControl(browser, ["A", "B", "C"]);
      await reorderTeam(control, 2, "front");
      await waitForThrowOrder(control, [2, 0, 1]);
      const overlay = await openOverlay(browser);
      await overlay.waitForFunction(() => JSON.stringify(window.SMAScoreSync.read()?.throwOrder) === "[2,0,1]");
      const overlayNames = await overlay.$$eval("#overlayRoot .team__name", (els) =>
        els.map((el) => el.textContent.replace(/失格/g, "").trim())
      );
      assert(overlayNames.join("|") === "C|A|B", `4 overlay ${overlayNames}`);
      results.push("4. 3チーム C→A→B OK");
      await overlay.close();
      await control.close();
    }

    // 5) 4 teams D→A→B→C
    {
      const control = await openControl(browser, ["A", "B", "C", "D"]);
      await reorderTeam(control, 3, "front");
      await waitForThrowOrder(control, [3, 0, 1, 2]);
      const setItems = await control.$$eval("#setScore .header__set-item", (els) => els.length);
      assert(setItems === 4, `5 set items ${setItems}`);
      const overlay = await openOverlay(browser);
      await overlay.waitForFunction(() => JSON.stringify(window.SMAScoreSync.read()?.throwOrder) === "[3,0,1,2]");
      const setNums = await overlay.$$eval(".info__set-num", (els) => els.length);
      assert(setNums === 4, `5 overlay sets ${setNums}`);
      results.push("5. 4チーム D→A→B→C OK");
      await overlay.close();
      await control.close();
    }

    // 6-7) manual order + score to correct team
    {
      const control = await openControl(browser, ["A", "B", "C"]);
      await reorderTeam(control, 2, "front");
      await waitForThrowOrder(control, [2, 0, 1]);
      await control.evaluate(() => {
        document.querySelector('.key[data-value="9"]').click();
        document.getElementById("confirmBtn").click();
      });
      await control.waitForFunction(() => {
        const state = window.SMAScoreSync.read();
        return state.teams[2].score === 9 && state.activeTeamIndex === 0;
      });
      const state = await control.evaluate(() => window.SMAScoreSync.read());
      assert(state.teams[0].score === 0 && state.teams[1].score === 0, "7 wrong team scored");
      results.push("6-7. 手動変更後の得点加算 OK");
      await control.close();
    }

    // 8) reload persistence
    {
      const control = await openControl(browser, ["A", "B", "C"]);
      await reorderTeam(control, 2, "front");
      await waitForThrowOrder(control, [2, 0, 1]);
      await control.reload({ waitUntil: "networkidle0" });
      await control.evaluate(() => {
        window.confirm = () => true;
      });
      await control.waitForSelector("#teamBoard .team-card");
      await waitForThrowOrder(control, [2, 0, 1]);
      const names = await control.$$eval("#teamBoard .team-card__name", (els) =>
        els.map((el) => el.textContent.trim())
      );
      assert(names.join("|") === "C|A|B", `8 reload ${names}`);
      results.push("8. リロード後も順番維持 OK");
      await control.close();
    }

    // 9) another page same room
    {
      const control = await openControl(browser, ["A", "B", "C"]);
      const room = ROOM;
      await reorderTeam(control, 1, "front");
      await waitForThrowOrder(control, [1, 0, 2]);
      const other = await openControl(browser, ["A", "B", "C"], { room, reuseState: true });
      await waitForThrowOrder(other, [1, 0, 2]);
      results.push("9. 別端末(別タブ)同じ順番 OK");
      await other.close();
      await control.close();
    }

    // 10) set rotation (C first → after next set A first)
    {
      const control = await openControl(browser, ["A", "B", "C"]);
      await reorderTeam(control, 2, "front");
      await waitForThrowOrder(control, [2, 0, 1]);

      for (let guard = 0; guard < 40; guard += 1) {
        const status = await control.evaluate(() => {
          const state = window.SMAScoreSync.read();
          return {
            ended: !!state.setEnded,
            active: state.activeTeamIndex,
            score: state.teams[2].score,
            revision: state.revision,
          };
        });
        if (status.ended) break;

        // 他チームはミス連打で失格しないよう 1 点を入れる
        let value = "1";
        if (status.active === 2) {
          const need = 50 - status.score;
          value = String(Math.min(12, need));
        }

        await control.evaluate((v) => {
          const key = document.querySelector(`.key[data-value="${v}"]`);
          const confirm = document.getElementById("confirmBtn");
          key.click();
          confirm.click();
        }, value);

        await control.waitForFunction(
          (prevRevision, prevEnded) => {
            const state = window.SMAScoreSync.read();
            return state.setEnded !== prevEnded || state.revision > prevRevision;
          },
          { timeout: 10000 },
          status.revision,
          status.ended
        );
      }

      await control.waitForFunction(() => window.SMAScoreSync.read().setEnded === true, {
        timeout: 15000,
      });
      await control.waitForFunction(() => {
        const btn = document.getElementById("nextSetBtn");
        return btn && !btn.hidden && !btn.disabled;
      });
      await control.evaluate(() => document.getElementById("nextSetBtn").click());
      await control.waitForFunction(() => {
        const state = window.SMAScoreSync.read();
        return state && !state.setEnded && JSON.stringify(state.throwOrder) === "[0,1,2]";
      }, { timeout: 10000 });
      const names = await control.$$eval("#teamBoard .team-card__name", (els) =>
        els.map((el) => el.textContent.trim())
      );
      assert(names.join("|") === "A|B|C", `10 rotate display ${names}`);
      results.push("10. セット切替で先攻回転 OK");
      await control.close();
    }

    // 11) all set wins shown (already covered in 3/5) — reinforce with wins
    {
      const control = await openControl(browser, ["A", "B", "C"]);
      await control.evaluate(() => {
        const state = window.SMAScoreSync.read();
        state.teams[0].setWins = 1;
        state.teams[1].setWins = 2;
        state.teams[2].setWins = 0;
        return window.SMAScoreSync.publish(state, {
          baseRevision: window.SMAScoreSync.getRevision(state),
        });
      });
      await control.reload({ waitUntil: "networkidle0" });
      await control.waitForSelector("#setScore .header__set-item");
      const text = await control.$eval("#setScore", (el) => el.innerText.replace(/\s+/g, " "));
      assert(text.includes("A") && text.includes("B") && text.includes("C"), `11 ${text}`);
      assert((text.match(/セット/g) || []).length >= 3, `11 units ${text}`);
      results.push("11. 全チーム獲得セット数表示 OK");
      await control.close();
    }

    // 12) transparent background
    {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${PORT}/overlay/?room=${ROOM}`, {
        waitUntil: "networkidle0",
      });
      const bg = await page.evaluate(() => {
        const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
        const bodyBg = getComputedStyle(document.body).backgroundColor;
        const hasDebug = document.documentElement.classList.contains("debug-background");
        return { htmlBg, bodyBg, hasDebug };
      });
      assert(!bg.hasDebug, "12 debug class unexpectedly on");
      assert(
        bg.htmlBg === "rgba(0, 0, 0, 0)" || bg.htmlBg === "transparent",
        `12 html bg ${bg.htmlBg}`
      );
      assert(
        bg.bodyBg === "rgba(0, 0, 0, 0)" || bg.bodyBg === "transparent",
        `12 body bg ${bg.bodyBg}`
      );

      await page.goto(`http://127.0.0.1:${PORT}/overlay/?room=${ROOM}&debugBackground=1`, {
        waitUntil: "networkidle0",
      });
      const debugOn = await page.evaluate(() =>
        document.documentElement.classList.contains("debug-background")
      );
      assert(debugOn, "12 debugBackground not applied");
      results.push("12. Overlay背景完全透過 OK");
      await page.close();
    }

    // 13) new match navigates to setup
    {
      const control = await openControl(browser, ["A", "B"]);
      await control.click(".header__settings");
      await control.waitForSelector("#settingsNewMatchBtn");
      await Promise.all([
        control.waitForNavigation({ waitUntil: "networkidle0" }),
        control.click("#settingsNewMatchBtn"),
      ]);
      assert(control.url().includes("/setup/"), `13 url ${control.url()}`);
      results.push("13. 新しい試合を作成 OK");
      await control.close();
    }

    // 14-19) Overlay auto-switches on new match without reload
    {
      const room = nextRoom();
      const control = await openControl(browser, ["旧A", "旧B"], {
        room,
        tournament: "旧大会",
        match: "旧試合",
      });
      const overlay = await openOverlay(browser);

      await control.evaluate(() => {
        document.querySelector('.key[data-value="12"]').click();
        document.getElementById("confirmBtn").click();
      });
      await overlay.waitForFunction(() => window.SMAScoreSync.read()?.teams?.[0]?.score === 12);

      await control.evaluate(() => {
        const state = window.SMAScoreSync.read();
        state.teams[0].score = 50;
        state.teams[0].won = true;
        state.teams[0].setWins = 2;
        state.matchEnded = true;
        state.matchWinnerIndex = 0;
        state.setEnded = false;
        return window.SMAScoreSync.publish(state, {
          baseRevision: window.SMAScoreSync.getRevision(state),
        });
      });
      await overlay.waitForFunction(() => window.SMAScoreSync.read()?.matchEnded === true);
      const oldMatchId = await overlay.evaluate(() => window.SMAScoreSync.read().matchId);
      const oldRevision = await overlay.evaluate(() => window.SMAScoreSync.read().revision);
      assert(!!oldMatchId, "14 old matchId missing");
      assert(oldRevision >= 1, "14 old revision");

      // confirmNewMatch 相当: clear 後に setup へ（Overlay は開いたまま）
      await Promise.all([
        control.waitForNavigation({ waitUntil: "networkidle0" }),
        control.evaluate(async () => {
          window.confirm = () => true;
          await window.SMAScoreSync.clear();
          window.location.href = "../setup/";
        }),
      ]);
      assert(control.url().includes("/setup/"), "14 setup nav");

      const newMatchId = `match-new-${Date.now()}`;
      await seedMatch(control, ["新C", "新A", "新B"], "win-2", {
        room,
        matchId: newMatchId,
        tournament: "新大会",
        match: "新試合",
      });
      await control.goto(`http://127.0.0.1:${PORT}/control/?room=${room}`, {
        waitUntil: "networkidle0",
      });
      await control.evaluate(() => {
        window.confirm = () => true;
      });
      await control.waitForSelector("#teamBoard .team-card");
      await control.waitForFunction(
        (id) => {
          const state = window.SMAScoreSync.read();
          return state && state.matchId === id && state.revision > 0;
        },
        { timeout: 20000 },
        newMatchId
      );

      // Overlay must switch without reload
      await overlay.waitForFunction(
        (id) => {
          const state = window.SMAScoreSync.read();
          return state && state.matchId === id && state.matchEnded !== true;
        },
        { timeout: 15000 },
        newMatchId
      );

      const overlaySnap = await overlay.evaluate(() => {
        const state = window.SMAScoreSync.read();
        const names = [...document.querySelectorAll("#overlayRoot .team__name")].map((el) =>
          el.textContent.replace(/失格/g, "").trim()
        );
        const body = document.body.innerText;
        return {
          matchId: state.matchId,
          tournament: state.tournament,
          match: state.match,
          names,
          scores: state.teams.map((t) => t.score),
          setWins: state.teams.map((t) => t.setWins),
          misses: state.teams.map((t) => t.misses),
          matchEnded: state.matchEnded,
          throwOrder: state.throwOrder,
          bodyHasMatchEnd: body.includes("試合終了"),
        };
      });

      assert(overlaySnap.matchId === newMatchId, `15 matchId ${overlaySnap.matchId}`);
      assert(overlaySnap.tournament === "新大会", `15 tournament ${overlaySnap.tournament}`);
      assert(overlaySnap.match === "新試合", `15 match ${overlaySnap.match}`);
      assert(overlaySnap.names.join("|") === "新C|新A|新B", `15 names ${overlaySnap.names}`);
      assert(overlaySnap.scores.every((s) => s === 0), `15 scores ${overlaySnap.scores}`);
      assert(overlaySnap.setWins.every((s) => s === 0), `15 setWins ${overlaySnap.setWins}`);
      assert(overlaySnap.misses.every((s) => s === 0), `15 misses ${overlaySnap.misses}`);
      assert(!overlaySnap.matchEnded, "15 matchEnded still true");
      assert(!overlaySnap.bodyHasMatchEnd, "15 still shows 試合終了");
      assert(JSON.stringify(overlaySnap.throwOrder) === "[0,1,2]", "15 throwOrder");
      results.push("14-15. Overlay再読込なしで新試合へ切替 OK");

      await control.evaluate(() => {
        document.querySelector('.key[data-value="7"]').click();
        document.getElementById("confirmBtn").click();
      });
      await overlay.waitForFunction(() => window.SMAScoreSync.read()?.teams?.[0]?.score === 7, {
        timeout: 10000,
      });
      results.push("16. 新試合の得点がOverlayへ反映 OK");

      // 旧試合 revision が大きくても新 matchId を受け入れる
      const lowRevMatchId = `match-lowrev-${Date.now()}`;
      await control.evaluate(({ lowRevMatchId }) => {
        const payload = {
          matchId: lowRevMatchId,
          tournament: "低rev大会",
          match: "低rev試合",
          format: "win-2",
          teamCount: 2,
          teams: [
            { name: "X", score: 0, total: 0, misses: 0, won: false, disqualified: false, setWins: 0 },
            { name: "Y", score: 0, total: 0, misses: 0, won: false, disqualified: false, setWins: 0 },
          ],
          throwOrder: [1, 0],
          activeTeamIndex: 1,
          setStartTeamIndex: 1,
          setEnded: false,
          setWinnerIndex: null,
          matchEnded: false,
          matchWinnerIndex: null,
          pendingSelection: null,
          throwLog: [],
        };
        return window.SMAScoreSync.publish(payload, { baseRevision: 0 });
      }, { lowRevMatchId });

      await overlay.waitForFunction(
        (id) => {
          const state = window.SMAScoreSync.read();
          const names = [...document.querySelectorAll("#overlayRoot .team__name")].map((el) =>
            el.textContent.replace(/失格/g, "").trim()
          );
          return state?.matchId === id && names.join("|") === "Y|X";
        },
        { timeout: 15000 },
        lowRevMatchId
      );
      results.push("17. 旧revisionが大きくても新matchIdを受容 OK");

      const overlay2 = await openOverlay(browser);
      await overlay2.waitForFunction(
        (id) => window.SMAScoreSync.read()?.matchId === id,
        { timeout: 15000 },
        lowRevMatchId
      );
      const names2 = await overlay2.$$eval("#overlayRoot .team__name", (els) =>
        els.map((el) => el.textContent.replace(/失格/g, "").trim())
      );
      assert(names2.join("|") === "Y|X", `18 other tab ${names2}`);
      results.push("18. 別タブでも新試合状態を共有 OK");

      await overlay2.close();
      await overlay.close();
      await control.close();
      results.push("19. 新試合作成後のOverlay自動切替一式 OK");
    }

    // 20-28) edit view separation, set history, editCursor (非破壊の戻る)
    {
      const control = await openControl(browser, ["SMA", "TEAM B"]);
      const overlay = await openOverlay(browser);

      async function tapConfirm(value) {
        const before = await control.evaluate(() => window.SMAScoreSync.read()?.throwLog?.length || 0);
        await control.evaluate((v) => {
          document.querySelector(`#keypad .key[data-value="${v}"]`).click();
          document.getElementById("confirmBtn").click();
        }, value);
        await control.waitForFunction(
          (prev) => (window.SMAScoreSync.read()?.throwLog?.length || 0) > prev,
          { timeout: 10000 },
          before
        );
      }

      await tapConfirm("8");
      await tapConfirm("12");
      await tapConfirm("5");

      await control.evaluate(() => document.getElementById("backBtn").click());
      await control.waitForFunction(() =>
        document.querySelector('#keypad .key[data-value="5"]')?.classList.contains("key--selected")
      );
      assert(
        await control.evaluate(() => window.SMAScoreSync.read().throwLog.length === 3),
        "20 log kept"
      );
      results.push("20. 戻るで5点が選択状態になり履歴は保持 OK");

      await control.evaluate(() => {
        document.querySelector('#keypad .key[data-value="7"]').click();
        document.getElementById("confirmBtn").click();
      });
      await control.waitForFunction(() => {
        const log = window.SMAScoreSync.read().throwLog.map((e) => e.selection);
        return JSON.stringify(log) === JSON.stringify([8, 12, 7]);
      });
      await control.waitForFunction(() => {
        const s = window.SMAScoreSync.read();
        return s.teams[0].score === 15 && s.teams[1].score === 12;
      });
      results.push("21. 戻る後に7点へ変更しても後続を保持して再計算 OK");

      await control.evaluate(() => document.getElementById("backBtn").click());
      await control.waitForFunction(() =>
        document.querySelector('#keypad .key[data-value="7"]')?.classList.contains("key--selected")
      );
      await control.evaluate(() => document.getElementById("backBtn").click());
      await control.waitForFunction(() =>
        document.querySelector('#keypad .key[data-value="12"]')?.classList.contains("key--selected")
      );
      await control.evaluate(() => document.getElementById("backBtn").click());
      await control.waitForFunction(() =>
        document.querySelector('#keypad .key[data-value="8"]')?.classList.contains("key--selected")
      );
      assert(
        await control.evaluate(() => window.SMAScoreSync.read().throwLog.length === 3),
        "22 log kept after multi-back"
      );
      results.push("22. 複数回戻っても履歴を破棄せず各入力値が復元 OK");

      await control.evaluate(() => document.getElementById("cancelEditBtn").click());
      await control.waitForFunction(() => document.getElementById("inputEditCursor")?.hidden !== false);
      await tapConfirm("0");
      await control.evaluate(() => document.getElementById("backBtn").click());
      await control.waitForFunction(() =>
        document.querySelector('#keypad .key[data-value="0"]')?.classList.contains("key--selected")
      );
      assert(
        await control.evaluate(() => window.SMAScoreSync.read().throwLog.at(-1)?.selection === 0),
        "23 last kept"
      );
      results.push("23. 0を戻すと0が選択状態で履歴保持 OK");

      await control.evaluate(() => document.getElementById("cancelEditBtn").click());
      await control.waitForFunction(() => !document.querySelector(".control--past-edit"));
      await tapConfirm("F");
      await control.evaluate(() => document.getElementById("backBtn").click());
      await control.waitForFunction(() =>
        document.querySelector('#keypad .key[data-value="F"]')?.classList.contains("key--selected")
      );
      results.push("24. Fを戻すとFが選択状態で履歴保持 OK");

      await control.evaluate(() => document.getElementById("cancelEditBtn").click());
      await tapConfirm("3");
      await tapConfirm("4");

      await control.evaluate(() => document.getElementById("editModeBtn").click());
      await control.waitForFunction(() => document.getElementById("editView")?.hidden === false);
      assert(await control.evaluate(() => document.getElementById("inputView").hidden === true), "25 input hidden");
      assert(await control.evaluate(() => document.querySelectorAll(".history-set").length >= 1), "25 sets");
      assert(await control.evaluate(() => !!document.querySelector(".history-set--current")), "25 current");
      results.push("25. 修正画面を開きセット別履歴表示 OK");

      // Finish set 1 then start set 2
      await control.evaluate(() => document.getElementById("editModeBtn").click());
      await control.waitForFunction(() => document.getElementById("editView").hidden === true);

      for (let i = 0; i < 30; i += 1) {
        const status = await control.evaluate(() => {
          const s = window.SMAScoreSync.read();
          return { ended: !!s.setEnded, active: s.activeTeamIndex, score: s.teams[0].score, rev: s.revision };
        });
        if (status.ended) break;
        const value = status.active === 0 ? String(Math.min(12, Math.max(1, 50 - status.score))) : "1";
        await control.evaluate((v) => {
          document.querySelector(`#keypad .key[data-value="${v}"]`).click();
          document.getElementById("confirmBtn").click();
        }, value);
        await control.waitForFunction((prev) => window.SMAScoreSync.read().revision > prev, { timeout: 10000 }, status.rev);
      }
      await control.waitForFunction(() => window.SMAScoreSync.read().setEnded === true, { timeout: 15000 });
      await control.evaluate(() => document.getElementById("nextSetBtn").click());
      await control.waitForFunction(() => !window.SMAScoreSync.read().setEnded);

      await control.evaluate(() => document.getElementById("editModeBtn").click());
      await control.waitForFunction(() => document.getElementById("editView")?.hidden === false);
      const setCount = await control.evaluate(() => document.querySelectorAll(".history-set").length);
      assert(setCount >= 2, `26 set groups ${setCount}`);
      assert(
        await control.evaluate(() => document.querySelectorAll(".history-set--collapsed").length >= 1),
        "26 collapsed"
      );
      await control.evaluate(() => document.querySelector(".history-set--collapsed .history-set__header")?.click());
      await control.waitForFunction(() => document.querySelectorAll(".history-set:not(.history-set--collapsed)").length >= 2);
      results.push("26. 過去セットを開閉できる OK");

      await control.evaluate(() => {
        const item = document.querySelector(
          '.history-set[data-set-number="1"] .history-item:not(.history-item--order)'
        );
        item?.click();
      });
      await control.waitForFunction(() => !!document.querySelector(".history-item--selected"));
      await control.waitForFunction(() => document.getElementById("editControls")?.hidden === false);
      const beforeEdit = await control.evaluate(() => window.SMAScoreSync.read().teams.map((t) => t.score));
      await control.evaluate(() => {
        document.querySelector('#editKeypad .key[data-value="9"]').click();
        document.getElementById("confirmBtn").click();
      });
      await control.waitForFunction((prev) => {
        const scores = window.SMAScoreSync.read().teams.map((t) => t.score);
        return JSON.stringify(scores) !== JSON.stringify(prev);
      }, { timeout: 10000 }, beforeEdit);

      await control.evaluate(() => document.getElementById("editModeBtn").click());
      await control.waitForFunction(() => document.getElementById("editView").hidden === true);
      assert(await control.evaluate(() => document.getElementById("inputView").hidden === false), "27 input");
      assert(await control.evaluate(() => document.getElementById("historyList").innerHTML.trim() === ""), "27 hist");
      assert(
        await control.evaluate(() => {
          const editHidden = document.getElementById("editView").hidden;
          const keypad = document.getElementById("keypad");
          return editHidden && !!keypad && !keypad.closest("[hidden]");
        }),
        "27 keypad usable"
      );
      results.push("27. 通常入力へ戻り履歴が消える OK");

      const beforeContinue = await control.evaluate(() => window.SMAScoreSync.read().throwLog.length);
      await control.evaluate(() => {
        document.querySelector('#keypad .key[data-value="2"]').click();
        document.getElementById("confirmBtn").click();
      });
      await control.waitForFunction((prev) => window.SMAScoreSync.read().throwLog.length > prev, {}, beforeContinue);
      await overlay.waitForFunction((prev) => window.SMAScoreSync.read()?.throwLog?.length > prev, {}, beforeContinue);
      results.push("28. 修正後も通常入力を継続できOverlay同期 OK");

      await overlay.close();
      await control.close();
    }

    // 29-34) edit view vertical scroll on phone viewport
    {
      const control = await openControl(browser, ["SMA", "TEAM B"]);
      await control.setViewport({ width: 390, height: 700, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

      async function tapConfirm(value) {
        const before = await control.evaluate(() => window.SMAScoreSync.read()?.throwLog?.length || 0);
        await control.evaluate((v) => {
          document.querySelector(`#keypad .key[data-value="${v}"]`).click();
          document.getElementById("confirmBtn").click();
        }, value);
        await control.waitForFunction(
          (prev) => (window.SMAScoreSync.read()?.throwLog?.length || 0) > prev,
          { timeout: 10000 },
          before
        );
      }

      for (const v of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]) {
        await tapConfirm(v);
      }

      await control.evaluate(() => document.getElementById("editModeBtn").click());
      await control.waitForFunction(() => document.getElementById("editView")?.hidden === false);

      const scrollInfo = await control.evaluate(() => {
        const scroll = document.getElementById("historyScroll");
        const list = document.getElementById("historyList");
        if (!scroll || !list) return null;
        const before = scroll.scrollTop;
        scroll.scrollTop = scroll.scrollHeight;
        return {
          canScroll: scroll.scrollHeight > scroll.clientHeight + 8,
          scrolled: scroll.scrollTop > before,
          scrollTop: scroll.scrollTop,
          scrollHeight: scroll.scrollHeight,
          clientHeight: scroll.clientHeight,
          itemCount: list.querySelectorAll(".history-item").length,
        };
      });
      assert(scrollInfo && scrollInfo.itemCount >= 10, `29 items ${scrollInfo?.itemCount}`);
      assert(scrollInfo.canScroll, `29 canScroll ${JSON.stringify(scrollInfo)}`);
      assert(scrollInfo.scrolled, `29 scrolled ${JSON.stringify(scrollInfo)}`);
      results.push("29. スマホviewportで履歴を最下部までスクロールできる OK");

      await control.evaluate(() => {
        document.querySelectorAll(".history-set--collapsed .history-set__header").forEach((el) => el.click());
      });

      const fifthOk = await control.evaluate(() => {
        const items = [...document.querySelectorAll(".history-item:not(.history-item--order)")];
        const fifth = items[4];
        if (!fifth) return false;
        fifth.scrollIntoView({ block: "center" });
        fifth.click();
        return fifth.classList.contains("history-item--selected") || !!document.querySelector(".history-item--selected");
      });
      assert(fifthOk, "30 select 5th");
      await control.waitForFunction(() => document.getElementById("editControls")?.hidden === false);
      results.push("30. 5投目以降の履歴を選択できる OK");

      await control.evaluate(() => {
        const items = [...document.querySelectorAll(".history-item:not(.history-item--order)")];
        const last = items[items.length - 1];
        last?.scrollIntoView({ block: "center" });
        last?.click();
      });
      await control.waitForFunction(() => document.getElementById("editControls")?.hidden === false);
      const beforeLast = await control.evaluate(() =>
        window.SMAScoreSync.read().throwLog.map((e) => e.selection)
      );
      await control.evaluate(() => {
        document.querySelector('#editKeypad .key[data-value="1"]').click();
        document.getElementById("confirmBtn").click();
      });
      await control.waitForFunction((prev) => {
        const next = window.SMAScoreSync.read().throwLog.map((e) => e.selection);
        return JSON.stringify(next) !== JSON.stringify(prev);
      }, {}, beforeLast);
      results.push("31. 最下部の履歴も修正・確定できる OK");

      await control.evaluate(() => document.getElementById("editModeBtn").click());
      await control.waitForFunction(() => document.getElementById("editView").hidden === true);
      const beforeInput = await control.evaluate(() => window.SMAScoreSync.read().throwLog.length);
      await control.evaluate(() => {
        document.querySelector('#keypad .key[data-value="2"]').click();
        document.getElementById("confirmBtn").click();
      });
      await control.waitForFunction((prev) => window.SMAScoreSync.read().throwLog.length > prev, {}, beforeInput);
      results.push("32. 通常入力へ戻った後も入力画面が使える OK");

      await control.close();
    }

    // 33-40) back keeps later throws; overwrite + replay
    {
      const control = await openControl(browser, ["SMA", "TEAM B"]);
      const overlay = await openOverlay(browser);

      async function tapConfirm(value) {
        const before = await control.evaluate(() => window.SMAScoreSync.read()?.throwLog?.length || 0);
        await control.evaluate((v) => {
          document.querySelector(`#keypad .key[data-value="${v}"]`).click();
          document.getElementById("confirmBtn").click();
        }, value);
        await control.waitForFunction(
          (prev) => (window.SMAScoreSync.read()?.throwLog?.length || 0) > prev,
          { timeout: 10000 },
          before
        );
      }

      await tapConfirm("8");
      await tapConfirm("12");
      await tapConfirm("5");
      await tapConfirm("7");

      for (let i = 0; i < 4; i += 1) {
        await control.evaluate(() => document.getElementById("backBtn").click());
      }
      await control.waitForFunction(() =>
        document.querySelector('#keypad .key[data-value="8"]')?.classList.contains("key--selected")
      );
      assert(
        await control.evaluate(() => {
          const log = window.SMAScoreSync.read().throwLog.map((e) => e.selection);
          return JSON.stringify(log) === JSON.stringify([8, 12, 5, 7]);
        }),
        "33 later kept"
      );
      assert(
        await control.evaluate(() => {
          const cursor = document.getElementById("inputEditCursor");
          return cursor && !cursor.hidden && /修正中/.test(cursor.textContent || "");
        }),
        "33 banner"
      );
      results.push("33. 4回戻っても後続12,5,7が残る OK");

      await control.evaluate(() => {
        document.querySelector('#keypad .key[data-value="6"]').click();
        document.getElementById("confirmBtn").click();
      });
      await control.waitForFunction(() => {
        const log = window.SMAScoreSync.read().throwLog.map((e) => e.selection);
        return JSON.stringify(log) === JSON.stringify([6, 12, 5, 7]);
      });
      await control.waitForFunction(() => {
        const s = window.SMAScoreSync.read();
        return s.teams[0].score === 11 && s.teams[1].score === 19;
      });
      await overlay.waitForFunction(() => {
        const s = window.SMAScoreSync.read();
        return s?.teams?.[0]?.score === 11 && s?.teams?.[1]?.score === 19;
      });
      results.push("34. 1投目を6へ変更後も6,12,5,7で再計算・Overlay反映 OK");

      const beforeNew = await control.evaluate(() => window.SMAScoreSync.read().throwLog.length);
      await control.evaluate(() => {
        document.querySelector('#keypad .key[data-value="1"]').click();
        document.getElementById("confirmBtn").click();
      });
      await control.waitForFunction((prev) => window.SMAScoreSync.read().throwLog.length > prev, {}, beforeNew);
      assert(
        await control.evaluate(() => {
          const log = window.SMAScoreSync.read().throwLog.map((e) => e.selection);
          return log.length === 5 && log[0] === 6 && log[4] === 1;
        }),
        "35 append after edit"
      );
      results.push("35. 過去修正後に最新地点へ戻り新規入力できる OK");

      // 0 と F を含む履歴でも後続保持
      await control.evaluate(() => {
        for (let i = 0; i < 20; i += 1) {
          const btn = document.getElementById("backBtn");
          if (btn?.disabled) break;
          btn.click();
        }
      });
      await control.waitForFunction(() => document.querySelector(".control--past-edit"));
      await control.evaluate(() => document.getElementById("cancelEditBtn").click());

      const control2 = await openControl(browser, ["A", "B"]);
      async function tap2(value) {
        const before = await control2.evaluate(() => window.SMAScoreSync.read()?.throwLog?.length || 0);
        await control2.evaluate((v) => {
          document.querySelector(`#keypad .key[data-value="${v}"]`).click();
          document.getElementById("confirmBtn").click();
        }, value);
        await control2.waitForFunction(
          (prev) => (window.SMAScoreSync.read()?.throwLog?.length || 0) > prev,
          { timeout: 10000 },
          before
        );
      }
      await tap2("8");
      await tap2("0");
      await tap2("F");
      await tap2("5");
      for (let i = 0; i < 4; i += 1) {
        await control2.evaluate(() => document.getElementById("backBtn").click());
      }
      await control2.waitForFunction(() =>
        document.querySelector('#keypad .key[data-value="8"]')?.classList.contains("key--selected")
      );
      assert(
        await control2.evaluate(() => {
          const log = window.SMAScoreSync.read().throwLog.map((e) => e.selection);
          return JSON.stringify(log) === JSON.stringify([8, 0, "F", 5]);
        }),
        "36 0F kept"
      );
      await control2.evaluate(() => {
        document.querySelector('#keypad .key[data-value="6"]').click();
        document.getElementById("confirmBtn").click();
      });
      await control2.waitForFunction(() => {
        const log = window.SMAScoreSync.read().throwLog.map((e) => e.selection);
        return JSON.stringify(log) === JSON.stringify([6, 0, "F", 5]);
      });
      results.push("36. 0とFを含む履歴でも後続入力が保持される OK");

      // セットをまたぐ位置まで戻って修正
      for (let i = 0; i < 40; i += 1) {
        const status = await control2.evaluate(() => {
          const s = window.SMAScoreSync.read();
          return { ended: !!s.setEnded, active: s.activeTeamIndex, score: s.teams[0].score, rev: s.revision };
        });
        if (status.ended) break;
        const value = status.active === 0 ? String(Math.min(12, Math.max(1, 50 - status.score))) : "1";
        await control2.evaluate((v) => {
          document.querySelector(`#keypad .key[data-value="${v}"]`).click();
          document.getElementById("confirmBtn").click();
        }, value);
        await control2.waitForFunction((prev) => window.SMAScoreSync.read().revision > prev, { timeout: 10000 }, status.rev);
      }
      await control2.waitForFunction(() => window.SMAScoreSync.read().setEnded === true, { timeout: 15000 });
      await control2.evaluate(() => document.getElementById("nextSetBtn").click());
      await control2.waitForFunction(() => !window.SMAScoreSync.read().setEnded);
      await tap2("3");
      await tap2("4");

      const lenBeforeCross = await control2.evaluate(() => window.SMAScoreSync.read().throwLog.length);
      for (let i = 0; i < 30; i += 1) {
        const atFirst = await control2.evaluate(() => document.getElementById("backBtn")?.disabled);
        if (atFirst) break;
        await control2.evaluate(() => document.getElementById("backBtn").click());
      }
      await control2.waitForFunction(() => document.querySelector(".control--past-edit"));
      assert(
        await control2.evaluate((prev) => window.SMAScoreSync.read().throwLog.length === prev, lenBeforeCross),
        "37 cross-set keep"
      );
      await control2.evaluate(() => {
        document.querySelector('#keypad .key[data-value="9"]').click();
        document.getElementById("confirmBtn").click();
      });
      await control2.waitForFunction((prev) => {
        const s = window.SMAScoreSync.read();
        return s.throwLog.length >= 2 && s.revision > 0;
      }, { timeout: 10000 }, lenBeforeCross);
      assert(
        await control2.evaluate(() => window.SMAScoreSync.read().throwLog.length >= 2),
        "37 after edit"
      );
      results.push("37. セットをまたぐ位置まで戻って修正しても後続履歴を保持 OK");

      await overlay.close();
      await control.close();
      await control2.close();
    }

    console.log("\nBROWSER VERIFY RESULTS");
    results.forEach((line) => console.log("✔", line));
    console.log("ALL BROWSER CHECKS PASSED");
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => {
  console.error("BROWSER VERIFY FAILED:", error);
  process.exit(1);
});
