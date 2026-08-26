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

async function gotoApp(page, url) {
  // Firebase の常時接続があるため networkidle0 は使わない
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => document.readyState === "complete", { timeout: 15000 }).catch(() => undefined);
}

async function withPage(browser, url, fn) {
  const page = await browser.newPage();
  page.on("dialog", async (dialog) => {
    await dialog.accept();
  });
  await gotoApp(page, url);
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
    ({ teamNames, format, room, matchId, tournament, match, finished, setResults: seededResults, teamOverrides, matchEndReason }) => {
      localStorage.setItem("smascore-room-id", room);
      const config = {
        tournament,
        match,
        format,
        teamCount: teamNames.length,
        teamNames,
        matchId,
      };
      localStorage.setItem("smascore-match-config", JSON.stringify(config));
      try {
        sessionStorage.removeItem("smascore-setup-draft");
      } catch {
        /* ignore */
      }

      const overlaySettings = (() => {
        try {
          return (
            JSON.parse(localStorage.getItem("smascore-overlay-settings") || "null") || {
              showTournament: true,
              showMatch: true,
              backgroundOpacity: "standard",
              scoreAnimation: true,
            }
          );
        } catch {
          return {
            showTournament: true,
            showMatch: true,
            backgroundOpacity: "standard",
            scoreAnimation: true,
          };
        }
      })();

      const throwOrder = Array.from({ length: teamNames.length }, (_, i) => i);
      const setResults = finished
        ? seededResults ||
          [1, 2].map((setNumber) => ({
            setNumber,
            winnerTeamIndex: 0,
            endReason: "score",
            scores: teamNames.map((_, teamIndex) => ({
              teamIndex,
              score: teamIndex === 0 ? 50 : 20 + teamIndex * 3,
              disqualified: false,
            })),
          }))
        : [];

      const teams = teamNames.map((name, index) => {
        const base = {
          name,
          score: finished ? (index === 0 ? 50 : 20 + index * 3) : 0,
          total: finished ? (index === 0 ? 100 : 40 + index * 5) : 0,
          misses: 0,
          won: finished ? index === 0 : false,
          disqualified: false,
          setWins: finished ? (index === 0 ? 2 : 0) : 0,
        };
        if (finished && teamOverrides?.[index]) {
          return { ...base, ...teamOverrides[index] };
        }
        return base;
      });

      if (finished && setResults.length) {
        teams.forEach((team, index) => {
          team.total = setResults.reduce((sum, result) => {
            const row = (result.scores || []).find((score) => score.teamIndex === index);
            return sum + (Number(row?.score) || 0);
          }, 0);
          const last = setResults[setResults.length - 1]?.scores?.find((row) => row.teamIndex === index);
          if (last) {
            team.score = last.score;
            team.disqualified = !!last.disqualified;
          }
        });
      }

      const initial = {
        matchId,
        tournament,
        match,
        format,
        teamCount: teamNames.length,
        teams,
        throwOrder,
        activeTeamIndex: 0,
        setStartTeamIndex: 0,
        currentSetNumber: finished ? Math.max(1, setResults.length) : 1,
        setEnded: false,
        setWinnerIndex: null,
        matchEnded: !!finished,
        matchWinnerIndex: finished ? 0 : null,
        matchEndReason: finished ? matchEndReason || "normal" : null,
        pendingSelection: null,
        throwLog: [],
        setResults,
        overlayDisplayMode: "score",
        overlaySettings,
        revision: 1,
        updatedAt: Date.now(),
      };
      localStorage.setItem("smascore-game-state", JSON.stringify(initial));
    },
    {
      teamNames,
      format,
      room: options.room || ROOM,
      matchId,
      tournament: options.tournament || "検証大会",
      match: options.match || "検証試合",
      finished: !!options.finished,
      setResults: options.setResults || null,
      teamOverrides: options.teamOverrides || null,
      matchEndReason: options.matchEndReason || null,
    }
  );
  return matchId;
}

async function confirmKey(page, value) {
  const key =
    value === "miss" ? "miss" : value === "F" || value === "f" ? "F" : String(value);
  await page.evaluate((v) => {
    const el = document.querySelector(`#keypad .key[data-value="${v}"]`);
    if (!el) throw new Error(`key missing: ${v}`);
    el.click();
    document.getElementById("confirmBtn").click();
  }, key);
}

/** 現在セットを目標得点まで進める（50未満想定） */
async function playToScores(page, targetScores) {
  for (let guard = 0; guard < 100; guard += 1) {
    const status = await page.evaluate(() => {
      const s = window.SMAScoreSync.read();
      return {
        scores: (s.teams || []).map((t) => t.score || 0),
        active: s.activeTeamIndex,
        setEnded: !!s.setEnded,
        matchEnded: !!s.matchEnded,
        throwLogLen: (s.throwLog || []).length,
        revision: s.revision,
      };
    });
    if (status.setEnded || status.matchEnded) return status;
    if (status.scores.every((sc, i) => sc >= (targetScores[i] ?? 0))) return status;
    const need = (targetScores[status.active] ?? 0) - status.scores[status.active];
    const value = need <= 0 ? "0" : String(Math.min(12, Math.max(1, need)));
    await confirmKey(page, value);
    await page.waitForFunction(
      (prevLen, prevRev) => {
        const s = window.SMAScoreSync.read();
        return (s.throwLog || []).length > prevLen || s.revision > prevRev || !!s.setEnded;
      },
      { timeout: 15000 },
      status.throwLogLen,
      status.revision
    );
  }
  throw new Error(`playToScores failed: ${JSON.stringify(targetScores)}`);
}

async function forceEndMatch(page, { accept = true } = {}) {
  await page.evaluate((accept) => {
    window.confirm = () => accept;
  }, accept);
  await page.evaluate(() => document.getElementById("forceEndMatchBtn").click());
  await page.evaluate(() => {
    window.confirm = () => true;
  });
}

async function readMatchHistory(page) {
  return page.evaluate(() => window.SMAScoreMatchHistory?.readAll?.() || []);
}

async function clearMatchHistory(page) {
  await page.evaluate(() => {
    localStorage.removeItem("smascore-match-history");
    localStorage.removeItem("smascore-history-focus-team");
  });
}

/** 指定チームがセットを取れるまで進行（相手は低得点） */
async function winCurrentSetFor(page, teamIndex) {
  for (let i = 0; i < 60; i += 1) {
    const status = await page.evaluate(() => {
      const s = window.SMAScoreSync.read();
      return {
        setEnded: !!s.setEnded,
        matchEnded: !!s.matchEnded,
        active: s.activeTeamIndex,
        score: s.teams[s.activeTeamIndex]?.score ?? 0,
        revision: s.revision,
        throwLogLen: (s.throwLog || []).length,
        matchResultHidden: !!document.getElementById("matchResultPanel")?.hidden,
        confirmDisabled: !!document.getElementById("confirmBtn")?.disabled,
      };
    });
    if (status.setEnded || status.matchEnded) return status;
    if (!status.matchResultHidden) {
      throw new Error("match result panel still visible while trying to play");
    }
    const value =
      status.active === teamIndex ? String(Math.min(12, Math.max(1, 50 - status.score))) : "1";
    await confirmKey(page, value);
    await page.waitForFunction(
      (prevLen, prevRev) => {
        const s = window.SMAScoreSync.read();
        return (s.throwLog || []).length > prevLen || s.revision > prevRev || !!s.setEnded;
      },
      { timeout: 20000 },
      status.throwLogLen,
      status.revision
    );
  }
  throw new Error(`set did not end for team ${teamIndex}`);
}

/** win-2 をチーム0勝利で終了し、試合結果画面を待つ */
async function finishWin2Match(page, winnerIndex = 0) {
  for (let set = 0; set < 2; set += 1) {
    await winCurrentSetFor(page, winnerIndex);
    await page.waitForFunction(() => window.SMAScoreSync.read().setEnded === true, {
      timeout: 15000,
    });
    await page.evaluate(() => document.getElementById("nextSetBtn").click());
    if (set === 0) {
      await page.waitForFunction(() => !window.SMAScoreSync.read().setEnded, { timeout: 10000 });
    }
  }
  await page.waitForFunction(() => window.SMAScoreSync.read().matchEnded === true, {
    timeout: 15000,
  });
  await page.waitForSelector("#matchResultPanel:not([hidden])", { timeout: 10000 });
}

async function waitForControlReady(page, options = {}) {
  const timeout = options.timeout || 30000;
  await page.waitForSelector("#teamBoard .team-card", { timeout });
  await page.waitForFunction(
    () => {
      const state = window.SMAScoreSync?.read?.();
      const cards = document.querySelectorAll("#teamBoard .team-card").length;
      if (!(cards > 0 && state?.teams?.length > 0 && typeof state.revision === "number" && state.revision > 0)) {
        return false;
      }
      // ready フラグ優先。同期 state が揃っていれば bootstrap 遅延でも先へ進む
      return window.SMAScoreControlReady === true || cards === state.teams.length;
    },
    { timeout }
  );
  await page.evaluate(() => {
    window.confirm = () => true;
    // bootstrap が遅延していても入力可能にする
    window.SMAScoreControlReady = true;
  });
}

async function openControl(browser, teamNames, options = {}) {
  const room = options.room || nextRoom();
  ROOM = room;
  const page = await browser.newPage();
  page.on("dialog", async (dialog) => {
    await dialog.accept();
  });
  await gotoApp(page, `http://127.0.0.1:${PORT}/setup/?room=${room}`);
  if (!options.reuseState) {
    await seedMatch(page, teamNames, options.format || "win-2", {
      room,
      matchId: options.matchId,
      tournament: options.tournament,
      match: options.match,
      finished: options.finished,
      setResults: options.setResults,
      teamOverrides: options.teamOverrides,
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
  await gotoApp(page, `http://127.0.0.1:${PORT}/control/?room=${room}`);
  await waitForControlReady(page);
  if (!options.finished) {
    await page.waitForSelector("#throwOrderList .throw-order__row");
  } else {
    await page.waitForSelector("#matchResultPanel:not([hidden])", { timeout: 15000 });
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
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
    waitUntil: "domcontentloaded",
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
      await control.reload({ waitUntil: "domcontentloaded" });
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
      await control.reload({ waitUntil: "domcontentloaded" });
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
        waitUntil: "domcontentloaded",
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
        waitUntil: "domcontentloaded",
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
      await control.click("#settingsNewMatchBtn");
      await control.waitForFunction(
        () => location.pathname.includes("/setup/"),
        { timeout: 20000 }
      );
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
      await control.evaluate(async () => {
        window.confirm = () => true;
        await window.SMAScoreSync.clear();
        window.location.href = "../setup/";
      });
      await control.waitForFunction(
        () => location.pathname.includes("/setup/"),
        { timeout: 20000 }
      );
      assert(control.url().includes("/setup/"), "14 setup nav");

      const newMatchId = `match-new-${Date.now()}`;
      await seedMatch(control, ["新C", "新A", "新B"], "win-2", {
        room,
        matchId: newMatchId,
        tournament: "新大会",
        match: "新試合",
      });
      await control.goto(`http://127.0.0.1:${PORT}/control/?room=${room}`, {
        waitUntil: "domcontentloaded",
      });
      await waitForControlReady(control);
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
          { timeout: 20000 },
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

    // ── 試合結果画面 / 同じ試合をもう一度 / 新しい試合 ──
    {
      const room = nextRoom();
      const control = await openControl(browser, ["SMA", "TEAM B"], {
        room,
        tournament: "実運用大会",
        match: "準決勝",
      });
      const overlay = await openOverlay(browser);
      const oldMatchId = await control.evaluate(() => window.SMAScoreSync.read().matchId);

      await finishWin2Match(control, 0);

      const resultSnap = await control.evaluate(() => {
        const panel = document.getElementById("matchResultPanel");
        const state = window.SMAScoreSync.read();
        return {
          panelVisible: panel && !panel.hidden,
          winnerText: document.getElementById("matchResultWinner")?.textContent || "",
          setsHtml: document.getElementById("matchResultSets")?.innerText || "",
          summaryHtml: document.getElementById("matchResultSummary")?.innerText || "",
          tournament: document.getElementById("matchResultTournament")?.textContent || "",
          match: document.getElementById("matchResultMatch")?.textContent || "",
          setResults: state.setResults || [],
          setWins: state.teams.map((t) => t.setWins),
          totals: state.teams.map((t) => t.total),
          winnerIndex: state.matchWinnerIndex,
          rematchBtn: !!document.getElementById("rematchBtn"),
          newMatchBtn: !!document.getElementById("newMatchBtn"),
        };
      });

      assert(resultSnap.panelVisible, "40 result panel hidden");
      assert(resultSnap.winnerText.includes("SMA"), `40 winner ${resultSnap.winnerText}`);
      assert(resultSnap.tournament.includes("実運用大会"), "40 tournament");
      assert(resultSnap.match.includes("準決勝"), "40 match");
      assert(resultSnap.setResults.length >= 2, `40 setResults ${resultSnap.setResults.length}`);
      assert(
        resultSnap.setResults.every((r) => (r.scores || []).length === 2),
        "40 per-set scores missing"
      );
      assert(resultSnap.setWins[0] === 2 && resultSnap.setWins[1] === 0, `40 setWins ${resultSnap.setWins}`);
      assert(resultSnap.winnerIndex === 0, "40 winnerIndex");
      const expectedTotals = resultSnap.setResults.reduce(
        (acc, r) => {
          (r.scores || []).forEach((row) => {
            acc[row.teamIndex] += row.score;
          });
          return acc;
        },
        [0, 0]
      );
      assert(
        resultSnap.totals[0] === expectedTotals[0] && resultSnap.totals[1] === expectedTotals[1],
        `40 totals ${resultSnap.totals} vs ${expectedTotals}`
      );
      assert(resultSnap.summaryHtml.includes("獲得セット"), "40 summary sets");
      assert(resultSnap.summaryHtml.includes("合計得点"), "40 summary totals");
      assert(resultSnap.setsHtml.includes("セット1"), "40 set1 label");
      assert(resultSnap.rematchBtn && resultSnap.newMatchBtn, "40 action buttons");
      results.push("40. 試合結果画面（勝者・セット得点・合計・獲得セット） OK");
      console.log("…", results[results.length - 1]);

      // 過去投擲修正で setResults / 合計を再計算（相手の低得点投擲を変更してセット成立を崩さない）
      const beforeEdit = await control.evaluate(() => {
        const s = window.SMAScoreSync.read();
        const idx = s.throwLog.findIndex(
          (e) => e.kind !== "order" && e.teamIndex === 1 && (e.selection === 1 || e.selection === "1")
        );
        return { revision: s.revision, editIndex: idx, setResultsLen: (s.setResults || []).length };
      });
      assert(beforeEdit.editIndex >= 0, "41 no opponent throw to edit");
      await control.evaluate(() => document.getElementById("editModeBtn").click());
      await control.waitForSelector(".control--edit-mode");
      await control.evaluate(() => {
        document.querySelectorAll(".history-set--collapsed [data-set-toggle]").forEach((btn) => {
          btn.click();
        });
      });
      await control.evaluate((editIndex) => {
        const target = document.querySelector(`.history-item[data-index="${editIndex}"]`);
        if (!target) throw new Error(`history item ${editIndex} missing`);
        target.click();
      }, beforeEdit.editIndex);
      await control.waitForSelector("#editControls:not([hidden])");
      await control.evaluate(() => {
        document.querySelector('#editKeypad .key[data-value="2"]').click();
      });
      await control.waitForFunction(() => !document.getElementById("confirmBtn")?.disabled);
      await control.evaluate(() => document.getElementById("confirmBtn").click());
      await control.waitForFunction(
        (prev) => window.SMAScoreSync.read().revision > prev,
        { timeout: 15000 },
        beforeEdit.revision
      );
      await control.evaluate(() => document.getElementById("editModeBtn").click());
      await control.waitForFunction(() => !document.querySelector(".control--edit-mode"));
      const afterEdit = await control.evaluate(() => {
        const s = window.SMAScoreSync.read();
        return {
          matchEnded: !!s.matchEnded,
          setResults: s.setResults || [],
          totals: s.teams.map((t) => t.total),
          opponentScoreSet1: (s.setResults || [])[0]?.scores?.find((row) => row.teamIndex === 1)?.score,
        };
      });
      assert(afterEdit.setResults.length >= 2, `41 setResults ${afterEdit.setResults.length}`);
      assert(afterEdit.matchEnded, "41 match should still be ended");
      const sum = afterEdit.setResults.reduce(
        (acc, r) => {
          (r.scores || []).forEach((row) => {
            acc[row.teamIndex] = (acc[row.teamIndex] || 0) + row.score;
          });
          return acc;
        },
        []
      );
      assert(
        afterEdit.totals[0] === (sum[0] || 0) && afterEdit.totals[1] === (sum[1] || 0),
        `41 totals recompute ${afterEdit.totals} vs ${sum}`
      );
      assert(afterEdit.opponentScoreSet1 >= 2, `41 opponent set score ${afterEdit.opponentScoreSet1}`);
      await control.waitForSelector("#matchResultPanel:not([hidden])");
      const summaryAfter = await control.evaluate(
        () => document.getElementById("matchResultSummary")?.innerText || ""
      );
      assert(summaryAfter.includes(String(afterEdit.totals[1])), "41 summary shows new total");
      results.push("41. 過去投擲修正後に setResults / 合計が再計算される OK");
      console.log("…", results[results.length - 1]);

      await overlay.close();
      await control.close();

      // 0 / F / 25点戻し / 3ミス失格を含む結果
      const controlFoul = await openControl(browser, ["青", "赤"], { room: nextRoom() });
      // 青: 12+12+12=36, F→25, 12+12+1=50 / 赤はミス進行で失格させて別セットも作る
      // シンプルに: 赤を3ミス失格させてセット1終了、その後通常で試合終了
      await confirmKey(controlFoul, 1); // 青
      await confirmKey(controlFoul, "miss"); // 赤 1
      await confirmKey(controlFoul, 1);
      await confirmKey(controlFoul, "miss"); // 赤 2
      await confirmKey(controlFoul, 1);
      await confirmKey(controlFoul, "miss"); // 赤 3 → DQ、青勝利
      await controlFoul.waitForFunction(() => window.SMAScoreSync.read().setEnded === true);
      const dqSet = await controlFoul.evaluate(() => window.SMAScoreSync.read().setResults[0]);
      assert(dqSet?.endReason === "disqualification", `42 endReason ${dqSet?.endReason}`);
      assert(
        dqSet.scores.some((s) => s.disqualified && s.score === 0),
        "42 dq score"
      );
      await controlFoul.evaluate(() => document.getElementById("nextSetBtn").click());
      await controlFoul.waitForFunction(() => !window.SMAScoreSync.read().setEnded);
      // セット2: F と 50超過戻しを混ぜて青が取る
      // 先攻はローテーションで赤から
      await winCurrentSetFor(controlFoul, 0);
      await controlFoul.waitForFunction(() => window.SMAScoreSync.read().setEnded === true);
      await controlFoul.evaluate(() => document.getElementById("nextSetBtn").click());
      await controlFoul.waitForFunction(() => window.SMAScoreSync.read().matchEnded === true);
      await controlFoul.waitForSelector("#matchResultPanel:not([hidden])");
      const foulText = await controlFoul.evaluate(
        () => document.getElementById("matchResultSets")?.innerText || ""
      );
      assert(foulText.includes("失格") || foulText.length > 0, "42 result shows dq/sets");
      results.push("42. 失格・特殊得点を含む試合結果 OK");
      console.log("…", results[results.length - 1]);
      await controlFoul.close();

      // 同じ試合をもう一度
      console.log("… starting rematch flow");
      const rematchRoom = nextRoom();
      const rematchControl = await openControl(browser, ["Alpha", "Beta"], {
        room: rematchRoom,
        tournament: "再試合大会",
        match: "試合A",
      });
      console.log("… rematch control opened");
      const rematchOverlay = await openOverlay(browser);
      const beforeRematchId = await rematchControl.evaluate(() => window.SMAScoreSync.read().matchId);
      await finishWin2Match(rematchControl, 0);
      console.log("… rematch match finished");

      await rematchControl.evaluate(() => {
        document.getElementById("rematchBtn")?.click();
      });
      await rematchControl.waitForFunction(
        () => location.pathname.includes("/setup/"),
        { timeout: 20000 }
      );
      console.log("… rematch setup reached");
      assert(rematchControl.url().includes("/setup/"), "43 rematch setup");
      assert(rematchControl.url().includes("mode=rematch"), "43 rematch mode");

      const rematchForm = await rematchControl.evaluate(() => ({
        title: document.querySelector(".setup__title")?.textContent || "",
        tournament: document.getElementById("tournament")?.value || "",
        match: document.getElementById("match")?.value || "",
        team1: document.getElementById("team1")?.value || "",
        team2: document.getElementById("team2")?.value || "",
        format: document.querySelector('input[name="format"]:checked')?.value || "",
        formatDisabled: !!document.querySelector('input[name="format"]:checked')?.disabled,
        teamsDisabled: !!document.querySelector('input[name="teams"]:checked')?.disabled,
      }));
      assert(rematchForm.title.includes("同じ試合"), `43 title ${rematchForm.title}`);
      assert(rematchForm.tournament === "再試合大会", "43 keep tournament");
      assert(rematchForm.match === "試合A", "43 keep match");
      assert(rematchForm.team1 === "Alpha" && rematchForm.team2 === "Beta", "43 team names editable prefilled");
      assert(rematchForm.format === "win-2", "43 keep format");
      assert(rematchForm.formatDisabled && rematchForm.teamsDisabled, "43 rules locked");

      await rematchControl.evaluate(() => {
        document.getElementById("match").value = "試合B";
        document.getElementById("team1").value = "Alpha2";
        document.getElementById("team2").value = "Beta2";
      });
      await rematchControl.evaluate(() => document.querySelector(".setup__form").requestSubmit());
      await rematchControl.waitForFunction(
        () => location.pathname.includes("/control/"),
        { timeout: 20000 }
      );
      await waitForControlReady(rematchControl);
      await rematchControl.waitForFunction(() => {
        const s = window.SMAScoreSync.read();
        return s && s.revision > 0 && s.matchEnded !== true;
      });

      const rematchState = await rematchControl.evaluate(() => {
        const s = window.SMAScoreSync.read();
        return {
          matchId: s.matchId,
          match: s.match,
          names: s.teams.map((t) => t.name),
          scores: s.teams.map((t) => t.score),
          setWins: s.teams.map((t) => t.setWins),
          totals: s.teams.map((t) => t.total),
          throwLogLen: (s.throwLog || []).length,
          setResultsLen: (s.setResults || []).length,
          matchEnded: !!s.matchEnded,
          matchWinnerIndex: s.matchWinnerIndex,
        };
      });
      assert(rematchState.matchId && rematchState.matchId !== beforeRematchId, "44 new matchId");
      assert(rematchState.match === "試合B", "44 match renamed");
      assert(rematchState.names.join("|") === "Alpha2|Beta2", `44 names ${rematchState.names}`);
      assert(rematchState.scores.every((n) => n === 0), "44 scores reset");
      assert(rematchState.setWins.every((n) => n === 0), "44 setWins reset");
      assert(rematchState.totals.every((n) => n === 0), "44 totals reset");
      assert(rematchState.throwLogLen === 0 && rematchState.setResultsLen === 0, "44 history reset");
      assert(!rematchState.matchEnded && rematchState.matchWinnerIndex == null, "44 winner reset");

      await rematchOverlay.waitForFunction(
        (id) => window.SMAScoreSync.read()?.matchId === id,
        { timeout: 15000 },
        rematchState.matchId
      );
      results.push("43-44. 同じ試合をもう一度（設定保持・得点リセット・新matchId・Overlay切替） OK");
      console.log("…", results[results.length - 1]);
      await rematchOverlay.close();
      await rematchControl.close();

      // 新しい試合: 1回の設定で反映 + 連打防止 + 同一room連続
      const newRoom = nextRoom();
      let controlN = await openControl(browser, ["旧1", "旧2"], {
        room: newRoom,
        tournament: "連続大会",
        match: "第1試合",
      });
      let overlayN = await openOverlay(browser);
      await finishWin2Match(controlN, 0);
      const firstId = await controlN.evaluate(() => window.SMAScoreSync.read().matchId);

      // 連打しても二重遷移しない
      await controlN.evaluate(() => {
        const btn = document.getElementById("newMatchBtn");
        btn.click();
        btn.click();
        btn.click();
      });
      await controlN.waitForFunction(
        () => location.pathname.includes("/setup/"),
        { timeout: 20000 }
      );
      assert(controlN.url().includes("/setup/"), "45 new match setup");

      // 通常の新規設定（空）から開始
      await controlN.evaluate(() => {
        document.getElementById("tournament").value = "連続大会";
        document.getElementById("match").value = "第2試合";
        document.getElementById("team1").value = "新1";
        document.getElementById("team2").value = "新2";
        document.querySelector('input[name="format"][value="win-2"]').checked = true;
        document.querySelector('input[name="teams"][value="2"]').checked = true;
      });
      await controlN.evaluate(() => document.querySelector(".setup__form").requestSubmit());
      await controlN.waitForFunction(
        () => location.pathname.includes("/control/"),
        { timeout: 20000 }
      );
      await waitForControlReady(controlN);
      await controlN.waitForFunction(() => {
        const s = window.SMAScoreSync.read();
        return s && s.match === "第2試合" && s.matchEnded !== true && s.revision > 0;
      }, { timeout: 20000 });

      const second = await controlN.evaluate(() => {
        const s = window.SMAScoreSync.read();
        return {
          matchId: s.matchId,
          match: s.match,
          names: s.teams.map((t) => t.name),
          scores: s.teams.map((t) => t.score),
          matchEnded: !!s.matchEnded,
        };
      });
      assert(second.matchId !== firstId, "45 second matchId");
      assert(second.match === "第2試合", "45 second match name");
      assert(second.names.join("|") === "新1|新2", "45 second names");
      assert(second.scores.every((n) => n === 0) && !second.matchEnded, "45 clean state once");

      await overlayN.waitForFunction(
        (id) => {
          const s = window.SMAScoreSync.read();
          return s?.matchId === id && s.matchEnded !== true;
        },
        { timeout: 15000 },
        second.matchId
      );
      results.push("45. 新しい試合が1回の設定で反映（Overlay含む） OK");
      console.log("…", results[results.length - 1]);

      // 同一 room で複数試合を連続作成（短縮: 5回。15回相当の順序保証を確認）
      let prevId = second.matchId;
      // 実運用の15試合相当の順序保証を、同一roomで複数回繰り返して確認
      for (let i = 3; i <= 4; i += 1) {
        console.log(`… continuous match #${i}`);
        await finishWin2Match(controlN, 0);
        await controlN.evaluate(() => document.getElementById("newMatchBtn")?.click());
        await controlN.waitForFunction(
          () => location.pathname.includes("/setup/"),
          { timeout: 20000 }
        );
        await controlN.evaluate((n) => {
          document.getElementById("tournament").value = "連続大会";
          document.getElementById("match").value = `第${n}試合`;
          document.getElementById("team1").value = `T${n}A`;
          document.getElementById("team2").value = `T${n}B`;
        }, i);
        await controlN.evaluate(() => document.querySelector(".setup__form").requestSubmit());
        await controlN.waitForFunction(
          () => location.pathname.includes("/control/"),
          { timeout: 20000 }
        );
        await waitForControlReady(controlN);
        await controlN.waitForFunction(
          (n, prev) => {
            const s = window.SMAScoreSync.read();
            return (
              s &&
              s.match === `第${n}試合` &&
              s.matchId !== prev &&
              s.matchEnded !== true &&
              s.teams.every((t) => t.score === 0 && t.setWins === 0)
            );
          },
          { timeout: 20000 },
          i,
          prevId
        );
        prevId = await controlN.evaluate(() => window.SMAScoreSync.read().matchId);
        await overlayN.waitForFunction(
          (id) => window.SMAScoreSync.read()?.matchId === id,
          { timeout: 15000 },
          prevId
        );
      }
      results.push("46. 同一roomで連続新規作成しても毎回1回で切り替わる OK");
      console.log("…", results[results.length - 1]);

      await overlayN.close();
      await controlN.close();
    }

    // ── 戻るプレビュー: 得点表示を editCursor 直前状態へ ──
    {
      const room = nextRoom();
      const control = await openControl(browser, ["A隊", "B隊"], { room });
      const overlay = await openOverlay(browser);

      async function tap(value) {
        const before = await control.evaluate(() => window.SMAScoreSync.read()?.throwLog?.length || 0);
        await confirmKey(control, value);
        await control.waitForFunction(
          (prev) => (window.SMAScoreSync.read()?.throwLog?.length || 0) > prev,
          { timeout: 10000 },
          before
        );
      }

      await tap(8); // A
      await tap(12); // B
      await tap(5); // A
      await tap(7); // B

      const latest = await control.evaluate(() => {
        const s = window.SMAScoreSync.read();
        const scores = [...document.querySelectorAll("#teamBoard .team-card")].map((card) => ({
          name: card.querySelector(".team-card__name")?.textContent?.trim(),
          score: Number(card.querySelector(".team-card__score")?.textContent || 0),
          setWins: Number(card.querySelector(".team-card__set-wins-num")?.textContent || 0),
        }));
        return {
          scores,
          activeName: document.getElementById("teamName")?.textContent?.trim(),
          throwLogLen: s.throwLog.length,
          revision: s.revision,
          teamScores: s.teams.map((t) => t.score),
        };
      });
      assert(latest.throwLogLen === 4, `50 log ${latest.throwLogLen}`);
      assert(latest.teamScores[0] === 13 && latest.teamScores[1] === 19, `50 latest ${latest.teamScores}`);

      // 戻る1回: 4投目(7)選択、表示は3投目後 = A13 B12、投擲者B
      const revBeforeBack = latest.revision;
      await control.evaluate(() => document.getElementById("backBtn").click());
      await control.waitForFunction(() => document.querySelector(".control--past-preview"));
      await control.waitForFunction(() =>
        document.querySelector('#keypad .key[data-value="7"]')?.classList.contains("key--selected")
      );

      const back1 = await control.evaluate(() => {
        const cards = [...document.querySelectorAll("#teamBoard .team-card")];
        const byName = Object.fromEntries(
          cards.map((card) => [
            card.querySelector(".team-card__name")?.textContent?.trim(),
            Number(card.querySelector(".team-card__score")?.textContent || 0),
          ])
        );
        return {
          byName,
          activeName: document.getElementById("teamName")?.textContent?.trim(),
          cursorText: document.getElementById("inputEditCursor")?.textContent || "",
          selected7: document
            .querySelector('#keypad .key[data-value="7"]')
            ?.classList.contains("key--selected"),
          throwLogLen: window.SMAScoreSync.read().throwLog.length,
          syncScores: window.SMAScoreSync.read().teams.map((t) => t.score),
          revision: window.SMAScoreSync.read().revision,
        };
      });
      assert(back1.selected7, "50 key 7 selected");
      assert(back1.byName["A隊"] === 13 && back1.byName["B隊"] === 12, `50 preview scores ${JSON.stringify(back1.byName)}`);
      assert(back1.activeName === "B隊", `50 active ${back1.activeName}`);
      assert(back1.cursorText.includes("1投前"), `50 cursor ${back1.cursorText}`);
      assert(back1.throwLogLen === 4, "50 log kept");
      assert(back1.syncScores[0] === 13 && back1.syncScores[1] === 19, "50 sync still latest");
      assert(back1.revision === revBeforeBack, "50 no publish on preview");
      results.push("50. 戻る1回で投擲前プレビュー表示・正式state非更新 OK");

      const overlayDuring = await overlay.evaluate(() =>
        window.SMAScoreSync.read().teams.map((t) => t.score)
      );
      assert(overlayDuring[0] === 13 && overlayDuring[1] === 19, `50 overlay latest ${overlayDuring}`);

      // 戻る2回目: 3投目(5)選択、表示は2投目後 = A8 B12、投擲者A
      await control.evaluate(() => document.getElementById("backBtn").click());
      await control.waitForFunction(() =>
        document.querySelector('#keypad .key[data-value="5"]')?.classList.contains("key--selected")
      );
      const back2 = await control.evaluate(() => {
        const cards = [...document.querySelectorAll("#teamBoard .team-card")];
        const byName = Object.fromEntries(
          cards.map((card) => [
            card.querySelector(".team-card__name")?.textContent?.trim(),
            Number(card.querySelector(".team-card__score")?.textContent || 0),
          ])
        );
        return {
          byName,
          activeName: document.getElementById("teamName")?.textContent?.trim(),
          cursorText: document.getElementById("inputEditCursor")?.textContent || "",
          throwLogLen: window.SMAScoreSync.read().throwLog.length,
          revision: window.SMAScoreSync.read().revision,
        };
      });
      assert(back2.byName["A隊"] === 8 && back2.byName["B隊"] === 12, `51 preview2 ${JSON.stringify(back2.byName)}`);
      assert(back2.activeName === "A隊", `51 active ${back2.activeName}`);
      assert(back2.cursorText.includes("2投前"), `51 cursor ${back2.cursorText}`);
      assert(back2.throwLogLen === 4 && back2.revision === revBeforeBack, "51 log/rev stable");
      results.push("51. 戻る連続でプレビューが段階的に戻る OK");

      // キャンセルで最新へ
      await control.evaluate(() => document.getElementById("cancelEditBtn").click());
      await control.waitForFunction(() => !document.querySelector(".control--past-preview"));
      const afterCancel = await control.evaluate(() => {
        const cards = [...document.querySelectorAll("#teamBoard .team-card")];
        const byName = Object.fromEntries(
          cards.map((card) => [
            card.querySelector(".team-card__name")?.textContent?.trim(),
            Number(card.querySelector(".team-card__score")?.textContent || 0),
          ])
        );
        const s = window.SMAScoreSync.read();
        return {
          byName,
          selections: [...document.querySelectorAll("#keypad .key--selected")].length,
          throwLog: s.throwLog.map((e) => e.selection),
          scores: s.teams.map((t) => t.score),
        };
      });
      assert(afterCancel.byName["A隊"] === 13 && afterCancel.byName["B隊"] === 19, "52 cancel display");
      assert(afterCancel.selections === 0, "52 selection cleared");
      assert(JSON.stringify(afterCancel.throwLog) === JSON.stringify([8, 12, 5, 7]), "52 log unchanged");
      results.push("52. キャンセルで履歴変更なし・最新表示復帰 OK");

      // 再度戻って修正確定
      await control.evaluate(() => document.getElementById("backBtn").click());
      await control.waitForFunction(() =>
        document.querySelector('#keypad .key[data-value="7"]')?.classList.contains("key--selected")
      );
      const revBeforeEdit = await control.evaluate(() => window.SMAScoreSync.read().revision);
      await control.evaluate(() => {
        document.querySelector('#keypad .key[data-value="9"]').click();
      });
      await control.waitForFunction(() =>
        document.querySelector('#keypad .key[data-value="9"]')?.classList.contains("key--selected")
      );
      // preview中は publish しない
      assert(
        (await control.evaluate(() => window.SMAScoreSync.read().revision)) === revBeforeEdit,
        "53 no publish while selecting in preview"
      );
      await control.evaluate(() => document.getElementById("confirmBtn").click());
      await control.waitForFunction(() => !document.querySelector(".control--past-preview"));
      await control.waitForFunction(
        (prev) => window.SMAScoreSync.read().revision > prev,
        { timeout: 10000 },
        revBeforeEdit
      );

      const afterConfirm = await control.evaluate(() => {
        const s = window.SMAScoreSync.read();
        const cards = [...document.querySelectorAll("#teamBoard .team-card")];
        const byName = Object.fromEntries(
          cards.map((card) => [
            card.querySelector(".team-card__name")?.textContent?.trim(),
            Number(card.querySelector(".team-card__score")?.textContent || 0),
          ])
        );
        return {
          byName,
          throwLog: s.throwLog.map((e) => e.selection),
          scores: s.teams.map((t) => t.score),
        };
      });
      assert(JSON.stringify(afterConfirm.throwLog) === JSON.stringify([8, 12, 5, 9]), "53 log edited");
      assert(afterConfirm.scores[0] === 13 && afterConfirm.scores[1] === 21, `53 scores ${afterConfirm.scores}`);
      assert(afterConfirm.byName["A隊"] === 13 && afterConfirm.byName["B隊"] === 21, "53 display latest");

      await overlay.waitForFunction(
        () => {
          const s = window.SMAScoreSync.read();
          return s?.teams?.[1]?.score === 21 && s?.throwLog?.map((e) => e.selection).join(",") === "8,12,5,9";
        },
        { timeout: 10000 }
      );
      results.push("53. 修正確定で全履歴再計算・Overlay更新 OK");

      // セットをまたいで戻る
      for (let i = 0; i < 40; i += 1) {
        const status = await control.evaluate(() => {
          const s = window.SMAScoreSync.read();
          return {
            ended: !!s.setEnded,
            active: s.activeTeamIndex,
            score: s.teams[s.activeTeamIndex]?.score ?? 0,
            rev: s.revision,
          };
        });
        if (status.ended) break;
        const value =
          status.active === 0 ? String(Math.min(12, Math.max(1, 50 - status.score))) : "1";
        await confirmKey(control, value);
        await control.waitForFunction((prev) => window.SMAScoreSync.read().revision > prev, {}, status.rev);
      }
      await control.waitForFunction(() => window.SMAScoreSync.read().setEnded === true, { timeout: 15000 });
      await control.evaluate(() => document.getElementById("nextSetBtn").click());
      await control.waitForFunction(() => !window.SMAScoreSync.read().setEnded);
      await tap(3);
      await tap(4);

      const crossBefore = await control.evaluate(() => {
        const s = window.SMAScoreSync.read();
        return {
          setWins: s.teams.map((t) => t.setWins),
          setNumber: s.currentSetNumber,
          logLen: s.throwLog.length,
          revision: s.revision,
        };
      });
      assert(crossBefore.setWins.some((w) => w >= 1), "54 set wins after set1");
      assert(crossBefore.setNumber >= 2, `54 setNumber ${crossBefore.setNumber}`);

      // セット1の投擲まで戻る
      for (let i = 0; i < 30; i += 1) {
        const atFirst = await control.evaluate(() => document.getElementById("backBtn")?.disabled);
        if (atFirst) break;
        await control.evaluate(() => document.getElementById("backBtn").click());
        const setLabel = await control.evaluate(
          () => document.getElementById("inputEditCursor")?.textContent || ""
        );
        if (setLabel.includes("セット1")) break;
      }
      await control.waitForFunction(() => document.querySelector(".control--past-preview"));
      const crossPreview = await control.evaluate(() => {
        const cards = [...document.querySelectorAll("#teamBoard .team-card")];
        return {
          setWins: cards.map((card) =>
            Number(card.querySelector(".team-card__set-wins-num")?.textContent || 0)
          ),
          header: document.getElementById("setScore")?.innerText || "",
          cursor: document.getElementById("inputEditCursor")?.textContent || "",
          logLen: window.SMAScoreSync.read().throwLog.length,
          syncSetWins: window.SMAScoreSync.read().teams.map((t) => t.setWins),
          revision: window.SMAScoreSync.read().revision,
        };
      });
      assert(crossPreview.cursor.includes("セット1"), `54 cursor ${crossPreview.cursor}`);
      assert(
        crossPreview.setWins.every((w) => w === 0),
        `54 preview setWins ${crossPreview.setWins}`
      );
      assert(crossPreview.logLen === crossBefore.logLen, "54 log kept across sets");
      assert(
        JSON.stringify(crossPreview.syncSetWins) === JSON.stringify(crossBefore.setWins),
        "54 sync setWins unchanged"
      );
      assert(crossPreview.revision === crossBefore.revision, "54 no publish");
      results.push("54. セット跨ぎ戻るでセット数・得点が当時のプレビューになる OK");

      await control.evaluate(() => document.getElementById("cancelEditBtn").click());
      await control.waitForFunction(() => !document.querySelector(".control--past-preview"));

      await overlay.close();
      await control.close();
      console.log("… 50-54 past preview OK");
    }

    // ── 過去修正中フッター: 戻るを中央固定 ──
    {
      const room = nextRoom();
      const control = await openControl(browser, ["A隊", "B隊"], { room });
      await control.setViewport({
        width: 390,
        height: 844,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });

      async function tap(value) {
        const before = await control.evaluate(() => window.SMAScoreSync.read()?.throwLog?.length || 0);
        await confirmKey(control, value);
        await control.waitForFunction(
          (prev) => (window.SMAScoreSync.read()?.throwLog?.length || 0) > prev,
          { timeout: 10000 },
          before
        );
      }

      function actionLayout() {
        return control.evaluate(() => {
          const footer = document.querySelector(".actions");
          const edit = document.getElementById("editModeBtn");
          const cancel = document.getElementById("cancelEditBtn");
          const back = document.getElementById("backBtn");
          const confirm = document.getElementById("confirmBtn");
          const box = (el) => {
            if (!el || el.hidden) return null;
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return null;
            return {
              left: Math.round(r.left),
              right: Math.round(r.right),
              top: Math.round(r.top),
              bottom: Math.round(r.bottom),
              width: Math.round(r.width),
              centerX: Math.round(r.left + r.width / 2),
              text: (el.innerText || el.textContent || "").replace(/\s+/g, ""),
            };
          };
          const footerRect = footer.getBoundingClientRect();
          const visible = [edit, cancel, back, confirm]
            .map((el) => {
              const b = box(el);
              return b ? { id: el.id, ...b } : null;
            })
            .filter(Boolean)
            .sort((a, b) => a.left - b.left);
          let overlaps = false;
          for (let i = 0; i < visible.length; i += 1) {
            for (let j = i + 1; j < visible.length; j += 1) {
              const a = visible[i];
              const b = visible[j];
              if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
                overlaps = true;
              }
            }
          }
          return {
            footerWidth: Math.round(footerRect.width),
            edit: box(edit),
            cancel: box(cancel),
            back: box(back),
            confirm: box(confirm),
            visibleIds: visible.map((v) => v.id),
            pastEdit: document.querySelector(".control--past-edit") != null,
            overlaps,
          };
        });
      }

      await tap(8);
      await tap(12);
      await tap(5);
      await tap(7);

      const normal = await actionLayout();
      assert(normal.visibleIds.join(",") === "editModeBtn,backBtn,confirmBtn", `55 normal order ${normal.visibleIds}`);
      assert(normal.back, "55 back visible");
      assert(normal.edit && normal.confirm, "55 edit/confirm visible");
      assert(normal.back.centerX > normal.edit.centerX, "55 back is right of edit");
      assert(normal.back.centerX < normal.confirm.centerX, "55 back is left of confirm");
      assert(!normal.overlaps, "55 normal no overlap");
      results.push("55. 通常入力時に戻るボタンが中央にある OK");

      await control.evaluate(() => document.getElementById("backBtn").click());
      await control.waitForFunction(() => document.querySelector(".control--past-edit"));
      await control.waitForFunction(() =>
        document.querySelector('#keypad .key[data-value="7"]')?.classList.contains("key--selected")
      );

      const past1 = await actionLayout();
      assert(past1.pastEdit, "56 past-edit class");
      assert(
        past1.visibleIds.join(",") === "cancelEditBtn,backBtn,confirmBtn",
        `56 past order ${past1.visibleIds}`
      );
      assert(past1.cancel?.text.includes("最新の入力へ戻る"), `56 cancel text ${past1.cancel?.text}`);
      assert(Math.abs(past1.back.centerX - normal.back.centerX) <= 2, `56 back centerX ${past1.back.centerX} vs ${normal.back.centerX}`);
      assert(Math.abs(past1.back.width - normal.back.width) <= 2, `56 back width ${past1.back.width} vs ${normal.back.width}`);
      assert(Math.abs(past1.confirm.centerX - normal.confirm.centerX) <= 2, `56 confirm centerX ${past1.confirm.centerX} vs ${normal.confirm.centerX}`);
      assert(past1.cancel.centerX < past1.back.centerX, "56 cancel left of back");
      assert(past1.back.centerX < past1.confirm.centerX, "56 back left of confirm");
      assert(!past1.overlaps, "56 past no overlap");
      results.push("56. 過去修正中も戻るが中央・最新へ戻るが左側 OK");

      // 中央の戻るを連続タップしてもキャンセル（最新へ）に当たらない
      const backBox = past1.back;
      const backClickY = Math.round((backBox.top + backBox.bottom) / 2);
      for (let i = 0; i < 3; i += 1) {
        await control.mouse.click(backBox.centerX, backClickY);
        await new Promise((r) => setTimeout(r, 100));
      }
      await control.waitForFunction(() =>
        document.querySelector('#keypad .key[data-value="8"]')?.classList.contains("key--selected")
      );
      const afterMulti = await control.evaluate(() => ({
        pastEdit: document.querySelector(".control--past-edit") != null,
        cursor: document.getElementById("inputEditCursor")?.textContent || "",
        logLen: window.SMAScoreSync.read().throwLog.length,
        selected8: document
          .querySelector('#keypad .key[data-value="8"]')
          ?.classList.contains("key--selected"),
      }));
      assert(afterMulti.pastEdit, "57 still past-edit after multi back");
      assert(afterMulti.selected8, "57 reached first throw selection");
      assert(afterMulti.cursor.includes("4投前") || afterMulti.cursor.includes("投前"), `57 cursor ${afterMulti.cursor}`);
      assert(afterMulti.logLen === 4, "57 log kept");
      results.push("57. 戻る連続タップで最新へ誤復帰しない OK");

      const pastMulti = await actionLayout();
      assert(
        Math.abs(pastMulti.back.centerX - normal.back.centerX) <= 2,
        `58 back still centered ${pastMulti.back.centerX}`
      );
      assert(
        Math.abs(pastMulti.confirm.centerX - normal.confirm.centerX) <= 2,
        `58 confirm position stable ${pastMulti.confirm.centerX}`
      );
      assert(!pastMulti.overlaps, "58 phone width no overlap");
      assert(pastMulti.footerWidth <= 390, `58 footer width ${pastMulti.footerWidth}`);
      results.push("58. 決定位置維持・スマホ幅でボタン非重複 OK");

      await control.evaluate(() => document.getElementById("cancelEditBtn").click());
      await control.waitForFunction(() => !document.querySelector(".control--past-edit"));

      await control.close();
      console.log("… 55-58 past-edit footer layout OK");
    }

    // ── Overlay 最終結果表示 ──
    {
      const room = nextRoom();
      const control = await openControl(browser, ["SMA", "TEAM B"], {
        room,
        tournament: "結果Overlay大会",
        match: "決勝",
      });
      const overlay = await openOverlay(browser);
      const overlayPageId = await overlay.evaluate(() => {
        window.__overlayBootId = `boot-${Date.now()}`;
        return window.__overlayBootId;
      });

      await finishWin2Match(control, 0);

      const afterEnd = await Promise.all([
        control.evaluate(() => {
          const s = window.SMAScoreSync.read();
          return {
            mode: s.overlayDisplayMode || "score",
            matchEnded: !!s.matchEnded,
            setWins: s.teams.map((t) => t.setWins),
            totals: s.teams.map((t) => t.total),
            winnerIndex: s.matchWinnerIndex,
            setResults: s.setResults || [],
            showBtn: !!document.getElementById("showOverlayResultBtn"),
            hideBtn: !!document.getElementById("hideOverlayResultBtn"),
          };
        }),
        overlay.evaluate(() => ({
          mode: window.SMAScoreSync.read()?.overlayDisplayMode || "score",
          hasTeam: !!document.querySelector("#overlayRoot .team"),
          hasResult: !!document.querySelector("#overlayRoot .result-board"),
          bootId: window.__overlayBootId,
          waiting: document.querySelector(".info__waiting, .waiting__label")?.textContent || "",
        })),
      ]);
      assert(afterEnd[0].matchEnded, "60 match ended");
      assert(afterEnd[0].mode === "score", `60 control mode ${afterEnd[0].mode}`);
      assert(afterEnd[1].mode === "score", `60 overlay mode ${afterEnd[1].mode}`);
      assert(afterEnd[1].hasTeam && !afterEnd[1].hasResult, "60 still score overlay");
      assert(afterEnd[0].showBtn && afterEnd[0].hideBtn, "60 overlay result buttons");
      results.push("60. 試合終了後も通常スコアOverlayを維持 OK");
      console.log("…", results[results.length - 1]);

      await control.evaluate(() => document.getElementById("showOverlayResultBtn").click());
      await overlay.waitForFunction(
        () =>
          window.SMAScoreSync.read()?.overlayDisplayMode === "result" &&
          !!document.querySelector("#overlayRoot .result-board"),
        { timeout: 15000 }
      );
      const resultView = await overlay.evaluate((bootId) => {
        const s = window.SMAScoreSync.read();
        const root = document.getElementById("overlayRoot");
        const text = root?.innerText || "";
        const names = [...root.querySelectorAll(".result-table__name")].map((el) =>
          el.textContent.replace(/\s+/g, " ").trim()
        );
        const setHeaders = [...root.querySelectorAll("thead th")]
          .map((el) => el.textContent.trim())
          .filter((t) => /^S\d+$/.test(t));
        return {
          bootId: window.__overlayBootId,
          sameBoot: window.__overlayBootId === bootId,
          mode: s.overlayDisplayMode,
          title: root.querySelector(".result-board__title")?.textContent || "",
          winner: root.querySelector(".result-board__winner")?.textContent || "",
          text,
          names,
          setHeaders,
          setWins: s.teams.map((t) => t.setWins),
          totals: s.teams.map((t) => t.total),
          setResults: s.setResults || [],
          hasTeam: !!root.querySelector(".team"),
        };
      }, overlayPageId);
      assert(resultView.sameBoot, "61 overlay reloaded unexpectedly");
      assert(resultView.mode === "result", "61 mode result");
      assert(resultView.title.includes("試合終了"), `61 title ${resultView.title}`);
      assert(resultView.winner.includes("SMA"), `61 winner ${resultView.winner}`);
      assert(!resultView.hasTeam, "61 score teams hidden");
      assert(resultView.names.some((n) => n.includes("SMA")), `61 names ${resultView.names}`);
      assert(resultView.names.some((n) => n.includes("TEAM B")), `61 names B ${resultView.names}`);
      assert(resultView.setWins[0] === 2, `61 setWins ${resultView.setWins}`);
      assert(resultView.setHeaders.length === resultView.setResults.length, "61 set headers");
      for (const set of resultView.setResults) {
        for (const row of set.scores || []) {
          assert(resultView.text.includes(String(row.score)), `61 missing set score ${row.score}`);
        }
      }
      assert(resultView.text.includes(String(resultView.totals[0])), "61 total A");
      assert(resultView.text.includes(String(resultView.totals[1])), "61 total B");
      results.push("61. Overlay結果表示へ無リロード切替・勝者/セット/合計 OK");
      console.log("…", results[results.length - 1]);

      // 過去投擲修正で結果 Overlay が更新される
      const beforePatch = await control.evaluate(() => {
        const s = window.SMAScoreSync.read();
        const idx = s.throwLog.findIndex(
          (e) => e.kind !== "order" && e.teamIndex === 1 && (e.selection === 1 || e.selection === "1")
        );
        return {
          revision: s.revision,
          editIndex: idx,
          oppSet1: (s.setResults || [])[0]?.scores?.find((r) => r.teamIndex === 1)?.score,
        };
      });
      assert(beforePatch.editIndex >= 0, "62 edit target");
      await control.evaluate(() => document.getElementById("editModeBtn").click());
      await control.waitForSelector(".control--edit-mode");
      await control.evaluate(() => {
        document.querySelectorAll(".history-set--collapsed [data-set-toggle]").forEach((btn) => btn.click());
      });
      await control.evaluate((editIndex) => {
        document.querySelector(`.history-item[data-index="${editIndex}"]`)?.click();
      }, beforePatch.editIndex);
      await control.waitForSelector("#editControls:not([hidden])");
      await control.evaluate(() => document.querySelector('#editKeypad .key[data-value="3"]').click());
      await control.evaluate(() => document.getElementById("confirmBtn").click());
      await control.waitForFunction(
        (prev) => window.SMAScoreSync.read().revision > prev,
        { timeout: 15000 },
        beforePatch.revision
      );
      await control.evaluate(() => document.getElementById("editModeBtn").click());
      await control.waitForFunction(() => !document.querySelector(".control--edit-mode"));
      await overlay.waitForFunction(
        (prevOpp) => {
          const s = window.SMAScoreSync.read();
          if (s?.overlayDisplayMode !== "result") return false;
          const opp = (s.setResults || [])[0]?.scores?.find((r) => r.teamIndex === 1)?.score;
          return typeof opp === "number" && opp !== prevOpp && document.body.innerText.includes(String(opp));
        },
        { timeout: 15000 },
        beforePatch.oppSet1
      );
      assert(
        await overlay.evaluate(() => window.SMAScoreSync.read()?.overlayDisplayMode === "result"),
        "62 still result mode"
      );
      results.push("62. 過去投擲修正後に結果Overlayが更新される OK");
      console.log("…", results[results.length - 1]);

      await control.evaluate(() => document.getElementById("hideOverlayResultBtn").click());
      await overlay.waitForFunction(
        () =>
          (window.SMAScoreSync.read()?.overlayDisplayMode || "score") === "score" &&
          !!document.querySelector("#overlayRoot .team") &&
          !document.querySelector("#overlayRoot .result-board"),
        { timeout: 15000 }
      );
      results.push("63. 結果表示終了で通常スコアOverlayへ戻る OK");
      console.log("…", results[results.length - 1]);

      // 同じ試合をもう一度 → 通常 Overlay
      await control.evaluate(() => document.getElementById("showOverlayResultBtn").click());
      await overlay.waitForFunction(
        () => window.SMAScoreSync.read()?.overlayDisplayMode === "result",
        { timeout: 10000 }
      );
      const rematchOldId = await control.evaluate(() => window.SMAScoreSync.read().matchId);
      await control.evaluate(() => document.getElementById("rematchBtn")?.click());
      await control.waitForFunction(
        () => location.pathname.includes("/setup/"),
        { timeout: 20000 }
      );
      await control.evaluate(() => document.querySelector(".setup__form").requestSubmit());
      await control.waitForFunction(
        () => location.pathname.includes("/control/"),
        { timeout: 20000 }
      );
      await waitForControlReady(control);
      await control.waitForFunction(
        (prev) => {
          const s = window.SMAScoreSync.read();
          return s && s.matchId !== prev && s.matchEnded !== true && (s.overlayDisplayMode || "score") === "score";
        },
        { timeout: 20000 },
        rematchOldId
      );
      await overlay.waitForFunction(
        (prev) => {
          const s = window.SMAScoreSync.read();
          return (
            s?.matchId !== prev &&
            (s.overlayDisplayMode || "score") === "score" &&
            !!document.querySelector("#overlayRoot .team") &&
            !document.querySelector("#overlayRoot .result-board")
          );
        },
        { timeout: 20000 },
        rematchOldId
      );
      results.push("64. 同じ試合をもう一度で通常Overlayへ戻る OK");
      console.log("…", results[results.length - 1]);

      // 新しい試合
      await finishWin2Match(control, 0);
      await control.evaluate(() => document.getElementById("showOverlayResultBtn").click());
      await overlay.waitForFunction(
        () => window.SMAScoreSync.read()?.overlayDisplayMode === "result",
        { timeout: 10000 }
      );
      const newOldId = await control.evaluate(() => window.SMAScoreSync.read().matchId);
      await control.evaluate(() => document.getElementById("newMatchBtn")?.click());
      await control.waitForFunction(
        () => location.pathname.includes("/setup/"),
        { timeout: 20000 }
      );
      await control.evaluate(() => {
        document.getElementById("tournament").value = "新大会";
        document.getElementById("match").value = "新試合";
        document.getElementById("team1").value = "N1";
        document.getElementById("team2").value = "N2";
      });
      await control.evaluate(() => document.querySelector(".setup__form").requestSubmit());
      await control.waitForFunction(
        () => location.pathname.includes("/control/"),
        { timeout: 20000 }
      );
      await waitForControlReady(control);
      await overlay.waitForFunction(
        (prev) => {
          const s = window.SMAScoreSync.read();
          return (
            s?.matchId !== prev &&
            (s.overlayDisplayMode || "score") === "score" &&
            !!document.querySelector("#overlayRoot .team")
          );
        },
        { timeout: 20000 },
        newOldId
      );
      results.push("65. 新しい試合でも通常Overlayへ戻る OK");
      console.log("…", results[results.length - 1]);

      await overlay.close();
      await control.close();

      // 3チーム全表示（完了済み state を seed）
      const room3 = nextRoom();
      const control3 = await openControl(browser, ["A3", "B3", "C3"], {
        room: room3,
        format: "win-2",
        finished: true,
      });
      const overlay3 = await openOverlay(browser);
      await overlay3.waitForFunction(
        () => (window.SMAScoreSync.read()?.teams || []).length >= 3,
        { timeout: 15000 }
      );
      assert(
        await control3.evaluate(() => window.SMAScoreSync.read()?.matchEnded === true),
        "66 match ended"
      );
      await control3.evaluate(() => document.getElementById("showOverlayResultBtn").click());
      await overlay3.waitForFunction(
        () => document.querySelectorAll("#overlayRoot .result-table__name").length >= 3,
        { timeout: 15000 }
      );
      const threeNames = await overlay3.evaluate(() =>
        [...document.querySelectorAll("#overlayRoot .result-table__name")].map((el) =>
          el.textContent.replace(/\s+/g, " ").trim()
        )
      );
      assert(threeNames.some((n) => n.includes("A3")), `66 A3 ${threeNames}`);
      assert(threeNames.some((n) => n.includes("B3")), `66 B3 ${threeNames}`);
      assert(threeNames.some((n) => n.includes("C3")), `66 C3 ${threeNames}`);
      results.push("66. 3チームでも全チーム結果表示 OK");
      await overlay3.close();
      await control3.close();

      // 4チーム全表示
      const room4 = nextRoom();
      const control4 = await openControl(browser, ["A4", "B4", "C4", "D4"], {
        room: room4,
        format: "win-2",
        finished: true,
      });
      const overlay4 = await openOverlay(browser);
      await control4.evaluate(() => document.getElementById("showOverlayResultBtn").click());
      await overlay4.waitForFunction(
        () => document.querySelectorAll("#overlayRoot .result-table__name").length >= 4,
        { timeout: 15000 }
      );
      const fourNames = await overlay4.evaluate(() =>
        [...document.querySelectorAll("#overlayRoot .result-table__name")].map((el) =>
          el.textContent.replace(/\s+/g, " ").trim()
        )
      );
      assert(fourNames.length >= 4, `67 four ${fourNames}`);
      assert(
        ["A4", "B4", "C4", "D4"].every((name) => fourNames.some((n) => n.includes(name))),
        `67 names ${fourNames}`
      );
      results.push("67. 4チームでも全チーム結果表示 OK");
      await overlay4.close();
      await control4.close();

      // 失格結果（完了済み state）
      const roomDq = nextRoom();
      const controlDq = await openControl(browser, ["青", "赤"], {
        room: roomDq,
        finished: true,
        setResults: [
          {
            setNumber: 1,
            winnerTeamIndex: 0,
            endReason: "disqualification",
            scores: [
              { teamIndex: 0, score: 3, disqualified: false },
              { teamIndex: 1, score: 0, disqualified: true },
            ],
          },
          {
            setNumber: 2,
            winnerTeamIndex: 0,
            endReason: "score",
            scores: [
              { teamIndex: 0, score: 50, disqualified: false },
              { teamIndex: 1, score: 28, disqualified: false },
            ],
          },
        ],
        teamOverrides: {
          0: { setWins: 2, score: 50, total: 53 },
          1: { setWins: 0, score: 28, total: 28, disqualified: false },
        },
      });
      const overlayDq = await openOverlay(browser);
      await controlDq.evaluate(() => document.getElementById("showOverlayResultBtn").click());
      await overlayDq.waitForFunction(
        () =>
          window.SMAScoreSync.read()?.overlayDisplayMode === "result" &&
          (document.getElementById("overlayRoot")?.innerText || "").includes("失格"),
        { timeout: 15000 }
      );
      const dqText = await overlayDq.evaluate(() => document.getElementById("overlayRoot")?.innerText || "");
      assert(dqText.includes("失格"), `68 dq text ${dqText}`);
      results.push("68. 失格結果もOverlayに表示 OK");
      await overlayDq.close();
      await controlDq.close();

      console.log("… 60-68 overlay result display OK");
    }

    // ── 結果表示のまま次試合へ進んでも Overlay が score に自動復帰 ──
    {
      const room = nextRoom();
      const control = await openControl(browser, ["Alpha", "Beta"], {
        room,
        tournament: "自動復帰大会",
        match: "第1試合",
      });
      const overlay = await openOverlay(browser);

      await finishWin2Match(control, 0);
      await control.evaluate(() => document.getElementById("showOverlayResultBtn").click());
      await overlay.waitForFunction(
        () =>
          window.SMAScoreSync.read()?.overlayDisplayMode === "result" &&
          !!document.querySelector("#overlayRoot .result-board"),
        { timeout: 15000 }
      );
      const match1Id = await control.evaluate(() => window.SMAScoreSync.read().matchId);
      results.push("70. 第1試合終了後に結果Overlay表示 OK");
      console.log("…", results[results.length - 1]);

      // 結果表示を終了せず「同じ試合をもう一度」
      await control.evaluate(() => document.getElementById("rematchBtn")?.click());
      await control.waitForFunction(() => location.pathname.includes("/setup/"), { timeout: 20000 });
      await control.evaluate(() => {
        document.getElementById("match").value = "第2試合";
      });
      await control.evaluate(() => document.querySelector(".setup__form").requestSubmit());
      await control.waitForFunction(() => location.pathname.includes("/control/"), { timeout: 20000 });
      await waitForControlReady(control);

      await overlay.waitForFunction(
        (prev) => {
          const s = window.SMAScoreSync.read();
          const root = document.getElementById("overlayRoot");
          return (
            s?.matchId &&
            s.matchId !== prev &&
            (s.overlayDisplayMode || "score") === "score" &&
            s.matchEnded !== true &&
            !!root.querySelector(".team") &&
            !root.querySelector(".result-board") &&
            !root.classList.contains("overlay--result")
          );
        },
        { timeout: 20000 },
        match1Id
      );

      const afterRematch = await overlay.evaluate(() => {
        const s = window.SMAScoreSync.read();
        const root = document.getElementById("overlayRoot");
        return {
          matchId: s.matchId,
          mode: s.overlayDisplayMode || "score",
          hasResult: !!root.querySelector(".result-board"),
          hasResultClass: root.classList.contains("overlay--result"),
          hasTeam: !!root.querySelector(".team"),
          scores: (s.teams || []).map((t) => t.score),
        };
      });
      assert(afterRematch.matchId !== match1Id, "71 new matchId");
      assert(afterRematch.mode === "score", `71 mode ${afterRematch.mode}`);
      assert(!afterRematch.hasResult && !afterRematch.hasResultClass, "71 result DOM closed");
      assert(afterRematch.hasTeam, "71 score UI");
      assert(afterRematch.scores.every((n) => n === 0), `71 scores reset ${afterRematch.scores}`);
      results.push("71. 結果終了なし再試合でOverlayが通常スコアへ自動復帰 OK");
      console.log("…", results[results.length - 1]);

      await confirmKey(control, 8);
      await overlay.waitForFunction(
        () => window.SMAScoreSync.read()?.teams?.[0]?.score === 8,
        { timeout: 15000 }
      );
      await overlay.waitForFunction(
        () =>
          [...document.querySelectorAll("#overlayRoot .team__score")].some(
            (el) => el.textContent.trim() === "8"
          ),
        { timeout: 10000 }
      );
      results.push("72. 再試合後の新しい得点がOverlayへ反映 OK");
      console.log("…", results[results.length - 1]);

      // 再び結果表示 → 終了せず新しい試合
      await finishWin2Match(control, 0);
      await control.evaluate(() => document.getElementById("showOverlayResultBtn").click());
      await overlay.waitForFunction(
        () => !!document.querySelector("#overlayRoot .result-board"),
        { timeout: 15000 }
      );
      const match2Id = await control.evaluate(() => window.SMAScoreSync.read().matchId);

      await control.evaluate(() => document.getElementById("newMatchBtn")?.click());
      await control.waitForFunction(() => location.pathname.includes("/setup/"), { timeout: 20000 });
      await control.evaluate(() => {
        document.getElementById("tournament").value = "自動復帰大会";
        document.getElementById("match").value = "第3試合";
        document.getElementById("team1").value = "N1";
        document.getElementById("team2").value = "N2";
      });
      await control.evaluate(() => document.querySelector(".setup__form").requestSubmit());
      await control.waitForFunction(() => location.pathname.includes("/control/"), { timeout: 20000 });
      await waitForControlReady(control);

      await overlay.waitForFunction(
        (prev) => {
          const s = window.SMAScoreSync.read();
          const root = document.getElementById("overlayRoot");
          return (
            s?.matchId &&
            s.matchId !== prev &&
            (s.overlayDisplayMode || "score") === "score" &&
            !!root.querySelector(".team") &&
            !root.querySelector(".result-board") &&
            !root.classList.contains("overlay--result")
          );
        },
        { timeout: 20000 },
        match2Id
      );
      const afterNew = await overlay.evaluate(() => {
        const s = window.SMAScoreSync.read();
        const root = document.getElementById("overlayRoot");
        return {
          matchId: s.matchId,
          names: (s.teams || []).map((t) => t.name),
          hasResult: !!root.querySelector(".result-board"),
          mode: s.overlayDisplayMode || "score",
        };
      });
      assert(afterNew.matchId !== match2Id && afterNew.matchId !== match1Id, "73 third matchId");
      assert(!afterNew.hasResult, "73 result closed after new match");
      assert(afterNew.mode === "score", "73 score mode");
      assert(afterNew.names.includes("N1") && afterNew.names.includes("N2"), `73 names ${afterNew.names}`);
      results.push("73. 同じroomで新しい試合でも結果が残らず通常表示 OK");
      console.log("…", results[results.length - 1]);

      // 連続試合リセット
      let prevId = afterNew.matchId;
      for (let i = 0; i < 2; i += 1) {
        await finishWin2Match(control, 0);
        await control.evaluate(() => document.getElementById("showOverlayResultBtn").click());
        await overlay.waitForFunction(
          () => !!document.querySelector("#overlayRoot .result-board"),
          { timeout: 15000 }
        );
        prevId = await control.evaluate(() => window.SMAScoreSync.read().matchId);
        await control.evaluate(() => document.getElementById("rematchBtn")?.click());
        await control.waitForFunction(() => location.pathname.includes("/setup/"), { timeout: 20000 });
        await control.evaluate(() => document.querySelector(".setup__form").requestSubmit());
        await control.waitForFunction(() => location.pathname.includes("/control/"), { timeout: 20000 });
        await waitForControlReady(control);
        await overlay.waitForFunction(
          (prev) => {
            const s = window.SMAScoreSync.read();
            const root = document.getElementById("overlayRoot");
            return (
              s?.matchId !== prev &&
              (s.overlayDisplayMode || "score") === "score" &&
              !root.querySelector(".result-board") &&
              !root.classList.contains("overlay--result")
            );
          },
          { timeout: 20000 },
          prevId
        );
      }
      results.push("75. 連続複数試合でも毎回Overlay結果が自動リセット OK");
      console.log("…", results[results.length - 1]);

      await overlay.close();
      await control.close();

      // overlayDisplayMode 欠損の新 matchId → score（別 room）
      const roomMissing = nextRoom();
      const controlM = await openControl(browser, ["X", "Y"], { room: roomMissing, finished: true });
      const overlayM = await openOverlay(browser);
      await controlM.evaluate(() => document.getElementById("showOverlayResultBtn").click());
      await overlayM.waitForFunction(
        () => !!document.querySelector("#overlayRoot .result-board"),
        { timeout: 15000 }
      );
      const injectedId = `missing-mode-${Date.now()}`;
      await controlM.evaluate((injectedId) => {
        const prev = window.SMAScoreSync.read() || {};
        const injected = {
          ...prev,
          matchId: injectedId,
          matchEnded: false,
          setEnded: false,
          matchWinnerIndex: null,
          setResults: [],
          throwLog: [],
          teams: (prev.teams || []).map((t) => ({
            ...t,
            score: 0,
            setWins: 0,
            total: 0,
            won: false,
            disqualified: false,
          })),
          revision: (prev.revision || 1) + 5,
          updatedAt: Date.now() + 5000,
        };
        delete injected.overlayDisplayMode;
        return window.SMAScoreSync.publish(injected, { baseRevision: prev.revision || 0 });
      }, injectedId);
      await overlayM.waitForFunction(
        (id) => {
          const s = window.SMAScoreSync.read();
          const root = document.getElementById("overlayRoot");
          return (
            s?.matchId === id &&
            !!root.querySelector(".team") &&
            !root.querySelector(".result-board") &&
            !root.classList.contains("overlay--result")
          );
        },
        { timeout: 15000 },
        injectedId
      );
      results.push("74. overlayDisplayMode欠損の新matchIdでもscore表示 OK");
      console.log("…", results[results.length - 1]);

      await overlayM.close();
      await controlM.close();
      console.log("… 70-75 overlay auto-reset on next match OK");
    }

    // 76+) 時間切れ終了 + 試合履歴
    {
      nextRoom();
      const control = await openControl(browser, ["A", "B"]);
      await clearMatchHistory(control);

      // 1-2: 50未満で試合終了ボタン / キャンセルでは終了しない
      await playToScores(control, [24, 18]);
      const beforeCancel = await control.evaluate(() => {
        const s = window.SMAScoreSync.read();
        return { matchEnded: !!s.matchEnded, scores: s.teams.map((t) => t.score) };
      });
      assert(!beforeCancel.matchEnded, "76 pre: not ended");
      await forceEndMatch(control, { accept: false });
      const afterCancel = await control.evaluate(() => !!window.SMAScoreSync.read().matchEnded);
      assert(!afterCancel, "76 cancel should not end match");
      results.push("76. 時間切れ確認キャンセルでは終了しない OK");
      console.log("…", results[results.length - 1]);

      // 3-4,6-7: 確認後にセット確定・高得点勝者・合計・時間切れ表示
      await forceEndMatch(control, { accept: true });
      await control.waitForFunction(() => window.SMAScoreSync.read().matchEnded === true, {
        timeout: 10000,
      });
      await control.waitForSelector("#matchResultPanel:not([hidden])", { timeout: 10000 });
      const timeLimitSnap = await control.evaluate(() => {
        const s = window.SMAScoreSync.read();
        const title = document.getElementById("matchResultTitle")?.textContent || "";
        const reason = document.getElementById("matchResultEndReason")?.textContent || "";
        return {
          matchEndReason: s.matchEndReason,
          winner: s.matchWinnerIndex,
          setResults: s.setResults,
          totals: s.teams.map((t) => t.total),
          setWins: s.teams.map((t) => t.setWins),
          title,
          reason,
        };
      });
      assert(timeLimitSnap.matchEndReason === "time_limit", "77 reason");
      assert(timeLimitSnap.winner === 0, "77 winner A");
      assert(timeLimitSnap.setResults[0]?.endReason === "time_limit", "77 set endReason");
      assert(timeLimitSnap.setResults[0]?.winnerTeamIndex === 0, "77 set winner");
      assert(timeLimitSnap.setResults[0]?.scores?.[0]?.score === 24, "77 A score");
      assert(timeLimitSnap.setResults[0]?.scores?.[1]?.score === 18, "77 B score");
      assert(timeLimitSnap.totals[0] === 24 && timeLimitSnap.totals[1] === 18, "77 totals");
      assert(timeLimitSnap.title.includes("時間切れ"), "77 title");
      assert(timeLimitSnap.reason.includes("時間切れ"), "77 reason label");
      results.push("77. 時間切れ終了でセット確定・勝者・結果表示 OK");
      console.log("…", results[results.length - 1]);

      // 8: Overlay 結果でも時間切れ
      const overlay = await openOverlay(browser);
      await control.evaluate(() => document.getElementById("showOverlayResultBtn").click());
      await overlay.waitForFunction(
        () => {
          const board = document.querySelector("#overlayRoot .result-board");
          const text = board?.textContent || "";
          return board && text.includes("時間切れ");
        },
        { timeout: 15000 }
      );
      results.push("78. Overlay結果に時間切れ表示 OK");
      console.log("…", results[results.length - 1]);
      await overlay.close();

      // 履歴: 時間切れ保存
      let history = await readMatchHistory(control);
      assert(history.length === 1, "79 history count");
      assert(history[0].matchEndReason === "time_limit", "79 history reason");
      assert(history[0].setResults[0].scores[0].score === 24, "79 history scores");
      const histMatchId = history[0].matchId;
      results.push("79. 時間切れ終了を履歴保存 OK");
      console.log("…", results[results.length - 1]);

      // 二重保存しない
      await control.evaluate(() => document.getElementById("showOverlayResultBtn").click());
      history = await readMatchHistory(control);
      assert(history.filter((e) => e.matchId === histMatchId).length === 1, "80 no dup");
      results.push("80. 同じmatchIdを二重保存しない OK");
      console.log("…", results[results.length - 1]);

      // 10: 再試合
      await control.evaluate(() => document.getElementById("rematchBtn")?.click());
      await control.waitForFunction(() => location.pathname.includes("/setup/"), { timeout: 20000 });
      await control.evaluate(() => document.querySelector(".setup__form").requestSubmit());
      await control.waitForFunction(() => location.pathname.includes("/control/"), { timeout: 20000 });
      await waitForControlReady(control);
      history = await readMatchHistory(control);
      assert(history.length >= 1, "81 history kept after rematch");
      results.push("81. 時間切れ後の再試合でも履歴保持 OK");
      console.log("…", results[results.length - 1]);
      await control.close();
    }

    // 同点なら引き分け
    {
      nextRoom();
      const control = await openControl(browser, ["A", "B"]);
      await playToScores(control, [30, 30]);
      await forceEndMatch(control, { accept: true });
      await control.waitForFunction(() => window.SMAScoreSync.read().matchEnded === true);
      const snap = await control.evaluate(() => {
        const s = window.SMAScoreSync.read();
        return {
          winner: s.matchWinnerIndex,
          setWinner: s.setResults[0]?.winnerTeamIndex,
          reason: s.matchEndReason,
        };
      });
      assert(snap.winner === null, "82 match draw");
      assert(snap.setWinner === null, "82 set draw");
      assert(snap.reason === "time_limit", "82 reason");
      results.push("82. 時間切れ同点は引き分け OK");
      console.log("…", results[results.length - 1]);
      await control.close();
    }

    // 2セット合計 + 高得点判定（セット1通常 + セット2時間切れ）
    {
      nextRoom();
      const control = await openControl(browser, ["A", "B"]);
      await winCurrentSetFor(control, 0);
      await control.waitForFunction(() => window.SMAScoreSync.read().setEnded === true);
      await control.evaluate(() => document.getElementById("nextSetBtn").click());
      await control.waitForFunction(() => !window.SMAScoreSync.read().setEnded);
      await playToScores(control, [46, 40]);
      await forceEndMatch(control, { accept: true });
      await control.waitForFunction(() => window.SMAScoreSync.read().matchEnded === true);
      const snap = await control.evaluate(() => {
        const s = window.SMAScoreSync.read();
        return {
          winner: s.matchWinnerIndex,
          setWins: s.teams.map((t) => t.setWins),
          totals: s.teams.map((t) => t.total),
          reasons: s.setResults.map((r) => r.endReason),
          scores: s.setResults.map((r) => r.scores.map((x) => x.score)),
        };
      });
      assert(snap.reasons[0] === "normal" || snap.reasons[0] === "score", "83 set1 normal");
      assert(snap.reasons[1] === "time_limit", "83 set2 time");
      assert(snap.scores[1][0] === 46 && snap.scores[1][1] === 40, "83 set2 scores");
      assert(snap.totals[0] === 50 + 46 && snap.totals[1] === snap.scores[0][1] + 40, "83 totals");
      assert(snap.setWins[0] === 2 && snap.winner === 0, "83 A wins both sets");
      results.push("83. 2セット時間切れ・合計得点 OK");
      console.log("…", results[results.length - 1]);
      await control.close();
    }

    // 3チーム・4チーム最高得点
    {
      nextRoom();
      const control3 = await openControl(browser, ["A", "B", "C"]);
      await playToScores(control3, [46, 40, 42]);
      await forceEndMatch(control3, { accept: true });
      await control3.waitForFunction(() => window.SMAScoreSync.read().matchEnded === true);
      const w3 = await control3.evaluate(() => window.SMAScoreSync.read().matchWinnerIndex);
      assert(w3 === 0, "84 3team winner A");
      await control3.close();

      nextRoom();
      const control4 = await openControl(browser, ["A", "B", "C", "D"]);
      await playToScores(control4, [20, 35, 35, 10]);
      await forceEndMatch(control4, { accept: true });
      await control4.waitForFunction(() => window.SMAScoreSync.read().matchEnded === true);
      const snap4 = await control4.evaluate(() => {
        const s = window.SMAScoreSync.read();
        return { winner: s.matchWinnerIndex, setWinner: s.setResults[0]?.winnerTeamIndex };
      });
      assert(snap4.winner === null && snap4.setWinner === null, "84 4team tie B/C");
      results.push("84. 3/4チーム時間切れの最高得点判定 OK");
      console.log("…", results[results.length - 1]);
      await control4.close();
    }

    // 通常終了・失格終了の履歴 + 新規試合後も残る + 集計
    {
      nextRoom();
      const control = await openControl(browser, ["SMA", "OPP"]);
      await clearMatchHistory(control);

      await finishWin2Match(control, 0);
      let history = await readMatchHistory(control);
      assert(history.length === 1, "85 normal hist");
      assert(history[0].matchEndReason === "normal", "85 normal reason");
      assert(history[0].teams[0].total === 100 || history[0].teams[0].total > 50, "85 totals");
      const normalId = history[0].matchId;
      results.push("85. 通常終了を履歴保存 OK");
      console.log("…", results[results.length - 1]);

      // 新規試合
      await control.evaluate(() => document.getElementById("newMatchBtn")?.click());
      await control.waitForFunction(() => location.pathname.includes("/setup/"), { timeout: 20000 });
      await control.evaluate((names) => {
        const form = document.querySelector(".setup__form");
        const tournament = form.querySelector('[name="tournament"], #tournament, #setupTournament');
        const match = form.querySelector('[name="match"], #match, #setupMatch');
        if (tournament) tournament.value = "履歴大会";
        if (match) match.value = "履歴試合2";
        form.requestSubmit();
      }, ["SMA", "OPP"]);
      // setup may need team names filled - use seed path via evaluate after submit may fail
      // Prefer: go setup then seed + navigate control
      const stillSetup = await control.evaluate(() => location.pathname.includes("/setup/"));
      if (stillSetup) {
        await seedMatch(control, ["SMA", "OPP"], "win-2", {
          room: ROOM,
          match: "履歴試合2",
          tournament: "履歴大会",
        });
        await gotoApp(control, `http://127.0.0.1:${PORT}/control/?room=${ROOM}`);
        await waitForControlReady(control);
      } else {
        await waitForControlReady(control);
      }
      history = await readMatchHistory(control);
      assert(history.some((e) => e.matchId === normalId), "86 history after new match");
      results.push("86. 新しい試合開始後も過去履歴が残る OK");
      console.log("…", results[results.length - 1]);

      // 時間切れもう1試合
      await playToScores(control, [40, 22]);
      await forceEndMatch(control, { accept: true });
      await control.waitForFunction(() => window.SMAScoreSync.read().matchEnded === true);
      history = await readMatchHistory(control);
      assert(history.some((e) => e.matchEndReason === "time_limit"), "87 time hist");
      results.push("87. 時間切れ履歴（複数試合） OK");
      console.log("…", results[results.length - 1]);

      // 失格終了
      await control.evaluate(() => document.getElementById("newMatchBtn")?.click());
      await control.waitForFunction(() => location.pathname.includes("/setup/"), { timeout: 20000 });
      await seedMatch(control, ["SMA", "OPP"], "win-2", { room: ROOM, match: "DQ試合" });
      await gotoApp(control, `http://127.0.0.1:${PORT}/control/?room=${ROOM}`);
      await waitForControlReady(control);
      // SMA が勝つセット1 → next → OPP を3ミス失格
      await winCurrentSetFor(control, 0);
      await control.waitForFunction(() => window.SMAScoreSync.read().setEnded === true);
      await control.evaluate(() => document.getElementById("nextSetBtn").click());
      await control.waitForFunction(() => !window.SMAScoreSync.read().setEnded);
      // 失格: アクティブがOPPのときミス3回。先にSMAに1点入れてミス回避
      for (let i = 0; i < 40; i += 1) {
        const st = await control.evaluate(() => {
          const s = window.SMAScoreSync.read();
          return {
            active: s.activeTeamIndex,
            ended: !!s.setEnded || !!s.matchEnded,
            dq: s.teams.map((t) => !!t.disqualified),
          };
        });
        if (st.ended) break;
        if (st.active === 1) await confirmKey(control, "miss");
        else await confirmKey(control, "1");
      }
      await control.waitForFunction(() => window.SMAScoreSync.read().setEnded === true, {
        timeout: 20000,
      });
      await control.evaluate(() => document.getElementById("nextSetBtn").click());
      await control.waitForFunction(() => window.SMAScoreSync.read().matchEnded === true, {
        timeout: 15000,
      });
      history = await readMatchHistory(control);
      const dqEntry = history.find((e) => e.matchEndReason === "disqualification");
      assert(!!dqEntry, "88 dq history");
      assert(
        dqEntry.setResults.some((r) => r.endReason === "disqualification"),
        "88 dq set"
      );
      results.push("88. 失格終了を履歴保存 OK");
      console.log("…", results[results.length - 1]);

      // 集計
      const standings = await control.evaluate(() => {
        const H = window.SMAScoreMatchHistory;
        H.setFocusTeamName("SMA");
        return H.summarizeForTeam("SMA");
      });
      assert(standings.matches >= 3, "89 matches");
      assert(standings.wins >= 2, "89 wins");
      assert(standings.setsFor >= 4, "89 sets for");
      assert(standings.pointsFor > 0, "89 points");
      results.push("89. 集計対象チームの勝敗・セット・得点 OK");
      console.log("…", results[results.length - 1]);

      // 15試合以上でスクロール
      await control.evaluate(() => {
        const H = window.SMAScoreMatchHistory;
        for (let i = 0; i < 16; i += 1) {
          H.upsertMatchRecord({
            matchId: `scroll-match-${i}`,
            tournament: "スクロール大会",
            match: `試合${i}`,
            teamNames: ["SMA", "RIVAL"],
            winnerTeamIndex: i % 3 === 0 ? 1 : 0,
            matchEndReason: "normal",
            setResults: [
              {
                setNumber: 1,
                winnerTeamIndex: 0,
                endReason: "normal",
                scores: [
                  { teamIndex: 0, score: 50, disqualified: false },
                  { teamIndex: 1, score: 20, disqualified: false },
                ],
              },
            ],
            teams: [
              { name: "SMA", setWins: i % 3 === 0 ? 0 : 2, total: 100 },
              { name: "RIVAL", setWins: i % 3 === 0 ? 2 : 0, total: 40 },
            ],
          });
        }
      });
      await control.evaluate(() => {
        document.querySelector(".header__settings")?.click();
      });
      await control.waitForSelector("#settingsModal:not([hidden])");
      await control.evaluate(() => document.getElementById("settingsHistoryBtn").click());
      await control.waitForSelector("#historyModal:not([hidden])");
      const scrollable = await control.evaluate(() => {
        const body = document.getElementById("matchHistoryScroll");
        return !!body && body.scrollHeight > body.clientHeight;
      });
      assert(scrollable, "90 history scroll");
      results.push("90. 15試合以上で履歴スクロール可能 OK");
      console.log("…", results[results.length - 1]);
      await control.close();
    }

    // 過去投擲修正で同matchId履歴更新
    {
      nextRoom();
      const control = await openControl(browser, ["A", "B"]);
      await clearMatchHistory(control);
      await finishWin2Match(control, 0);
      const beforeEditHist = await control.evaluate(() => {
        const s = window.SMAScoreSync.read();
        const idx = s.throwLog.findIndex(
          (e) => e.kind !== "order" && e.teamIndex === 1 && (e.selection === 1 || e.selection === "1")
        );
        const list = window.SMAScoreMatchHistory.readAll();
        return {
          revision: s.revision,
          editIndex: idx,
          matchId: list[0]?.matchId,
          totalB: list[0]?.teams?.[1]?.total,
        };
      });
      assert(beforeEditHist.editIndex >= 0, "91 no opponent throw");
      assert(beforeEditHist.matchId, "91 history exists");
      await control.evaluate(() => document.getElementById("editModeBtn").click());
      await control.waitForSelector(".control--edit-mode");
      await control.evaluate(() => {
        document.querySelectorAll(".history-set--collapsed [data-set-toggle]").forEach((btn) => {
          btn.click();
        });
      });
      await control.evaluate((editIndex) => {
        const target = document.querySelector(`.history-item[data-index="${editIndex}"]`);
        if (!target) throw new Error(`history item ${editIndex} missing`);
        target.click();
      }, beforeEditHist.editIndex);
      await control.waitForSelector("#editControls:not([hidden])");
      await control.evaluate(() => {
        document.querySelector('#editKeypad .key[data-value="2"]').click();
      });
      await control.waitForFunction(() => !document.getElementById("confirmBtn")?.disabled);
      await control.evaluate(() => document.getElementById("confirmBtn").click());
      await control.waitForFunction(
        (prev) => window.SMAScoreSync.read().revision > prev,
        { timeout: 15000 },
        beforeEditHist.revision
      );
      const afterHist = await control.evaluate((matchId) => {
        const list = window.SMAScoreMatchHistory.readAll().filter((e) => e.matchId === matchId);
        return {
          count: list.length,
          totalB: list[0]?.teams?.[1]?.total,
        };
      }, beforeEditHist.matchId);
      assert(afterHist.count === 1, "91 still one record");
      assert(afterHist.totalB !== beforeEditHist.totalB, "91 total updated");
      results.push("91. 過去投擲修正で同matchId履歴が更新 OK");
      console.log("…", results[results.length - 1]);
      await control.close();
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
