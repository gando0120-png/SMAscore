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

async function seedMatch(page, teamNames, format = "win-2") {
  await page.evaluate(
    ({ teamNames, format, room }) => {
      localStorage.setItem("smascore-room-id", room);
      localStorage.setItem(
        "smascore-match-config",
        JSON.stringify({
          tournament: "検証大会",
          match: "検証試合",
          format,
          teamCount: teamNames.length,
          teamNames,
        })
      );
      localStorage.removeItem("smascore-game-state");
    },
    { teamNames, format, room: ROOM }
  );
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
    await seedMatch(page, teamNames);
  } else {
    await page.evaluate(
      ({ teamNames, room }) => {
        localStorage.setItem("smascore-room-id", room);
        localStorage.setItem(
          "smascore-match-config",
          JSON.stringify({
            tournament: "検証大会",
            match: "検証試合",
            format: "win-2",
            teamCount: teamNames.length,
            teamNames,
          })
        );
      },
      { teamNames, room }
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

    // 13) new match flow
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
