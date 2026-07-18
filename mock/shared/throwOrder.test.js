/**
 * Node tests for throwOrder + control-equivalent scoring flow
 */
const assert = require("assert");
const ThrowOrder = require("./throwOrder.js");

function createTeams(names) {
  return names.map((name) => ({
    name,
    score: 0,
    total: 0,
    misses: 0,
    won: false,
    disqualified: false,
    setWins: 0,
  }));
}

function createMatch(names, order) {
  const teams = createTeams(names);
  let throwOrder = ThrowOrder.normalize(order, teams.length);
  let activeTeamIndex = ThrowOrder.startIndexOf(throwOrder);
  let setStartTeamIndex = activeTeamIndex;

  function sync() {
    setStartTeamIndex = ThrowOrder.startIndexOf(throwOrder);
  }

  function applyOrder(next, resetActive = true) {
    throwOrder = ThrowOrder.normalize(next, teams.length);
    sync();
    if (resetActive) activeTeamIndex = setStartTeamIndex;
  }

  function getNext(from) {
    return ThrowOrder.getNextActiveIndex(throwOrder, from, teams);
  }

  function displayNames() {
    return throwOrder.map((i) => teams[i].name);
  }

  function throwScore(value) {
    const team = teams[activeTeamIndex];
    if (value >= 1 && value <= 12) {
      team.score += value;
      if (team.score > 50) team.score = 25;
      if (team.score === 50) team.won = true;
      team.misses = 0;
    }
    const scoredIndex = activeTeamIndex;
    if (!team.won) {
      activeTeamIndex = getNext(activeTeamIndex);
    }
    return scoredIndex;
  }

  function nextSetRotate() {
    applyOrder(ThrowOrder.rotateForNextSet(throwOrder));
  }

  return {
    teams,
    get throwOrder() {
      return throwOrder;
    },
    get activeTeamIndex() {
      return activeTeamIndex;
    },
    get setStartTeamIndex() {
      return setStartTeamIndex;
    },
    applyOrder,
    displayNames,
    throwScore,
    nextSetRotate,
    serialize() {
      return {
        teams: teams.map((t) => ({ ...t })),
        throwOrder: [...throwOrder],
        activeTeamIndex,
        setStartTeamIndex,
      };
    },
    restore(state) {
      teams.forEach((t, i) => Object.assign(t, state.teams[i]));
      applyOrder(state.throwOrder, false);
      activeTeamIndex = state.activeTeamIndex;
      setStartTeamIndex = state.setStartTeamIndex;
    },
  };
}

function testNormalize() {
  assert.deepStrictEqual(ThrowOrder.normalize(undefined, 3), [0, 1, 2]);
  assert.deepStrictEqual(ThrowOrder.normalize([2, 0], 3), [2, 0, 1]);
  assert.deepStrictEqual(ThrowOrder.normalize([2, 0, 1, 9, 0], 3), [2, 0, 1]);
}

function testTwoTeamAB() {
  const m = createMatch(["A", "B"], [0, 1]);
  assert.deepStrictEqual(m.displayNames(), ["A", "B"]);
  assert.strictEqual(m.activeTeamIndex, 0);
  const scored = m.throwScore(10);
  assert.strictEqual(scored, 0);
  assert.strictEqual(m.teams[0].score, 10);
  assert.strictEqual(m.activeTeamIndex, 1);
}

function testTwoTeamBA() {
  const m = createMatch(["A", "B"], [1, 0]);
  assert.deepStrictEqual(m.displayNames(), ["B", "A"]);
  assert.strictEqual(m.activeTeamIndex, 1);
  m.throwScore(7);
  assert.strictEqual(m.teams[1].score, 7);
  assert.strictEqual(m.teams[0].score, 0);
  assert.strictEqual(m.activeTeamIndex, 0);
}

function testThreeABC() {
  const m = createMatch(["A", "B", "C"], [0, 1, 2]);
  assert.deepStrictEqual(m.displayNames(), ["A", "B", "C"]);
  m.throwScore(1);
  assert.strictEqual(m.activeTeamIndex, 1);
  m.throwScore(2);
  assert.strictEqual(m.activeTeamIndex, 2);
  m.throwScore(3);
  assert.strictEqual(m.activeTeamIndex, 0);
  assert.strictEqual(m.teams[0].score, 1);
  assert.strictEqual(m.teams[1].score, 2);
  assert.strictEqual(m.teams[2].score, 3);
}

function testThreeCAB() {
  const m = createMatch(["A", "B", "C"], [2, 0, 1]);
  assert.deepStrictEqual(m.displayNames(), ["C", "A", "B"]);
  assert.strictEqual(m.activeTeamIndex, 2);
  m.throwScore(5);
  assert.strictEqual(m.teams[2].score, 5);
  assert.strictEqual(m.activeTeamIndex, 0);
}

function testFourDABC() {
  const m = createMatch(["A", "B", "C", "D"], [3, 0, 1, 2]);
  assert.deepStrictEqual(m.displayNames(), ["D", "A", "B", "C"]);
  assert.strictEqual(m.activeTeamIndex, 3);
  m.throwScore(12);
  assert.strictEqual(m.teams[3].score, 12);
  assert.strictEqual(m.activeTeamIndex, 0);
}

function testManualReorder() {
  const m = createMatch(["A", "B", "C"], [0, 1, 2]);
  m.applyOrder(ThrowOrder.moveToFront(m.throwOrder, 2));
  assert.deepStrictEqual(m.displayNames(), ["C", "A", "B"]);
  assert.strictEqual(m.setStartTeamIndex, 2);
  assert.strictEqual(m.activeTeamIndex, 2);
  m.throwScore(4);
  assert.strictEqual(m.teams[2].score, 4);
  assert.strictEqual(m.teams[0].score, 0);
}

function testPersistReload() {
  const m = createMatch(["A", "B", "C"], [2, 0, 1]);
  m.throwScore(8);
  const saved = m.serialize();
  const m2 = createMatch(["A", "B", "C"], [0, 1, 2]);
  m2.restore(saved);
  assert.deepStrictEqual(m2.displayNames(), ["C", "A", "B"]);
  assert.strictEqual(m2.activeTeamIndex, 0);
  assert.strictEqual(m2.teams[2].score, 8);
}

function testLegacyWithoutThrowOrder() {
  const order = ThrowOrder.fromStartIndex(3, 2);
  assert.deepStrictEqual(order, [2, 0, 1]);
}

function testNextSetRotation() {
  const m = createMatch(["A", "B", "C"], [2, 0, 1]);
  assert.deepStrictEqual(m.displayNames(), ["C", "A", "B"]);
  m.nextSetRotate();
  assert.deepStrictEqual(m.displayNames(), ["A", "B", "C"]);
  assert.strictEqual(m.setStartTeamIndex, 0);
  assert.strictEqual(m.activeTeamIndex, 0);
  m.nextSetRotate();
  assert.deepStrictEqual(m.displayNames(), ["B", "C", "A"]);
}

function testSetWinsAllTeamsVisible() {
  const teams = createTeams(["A", "B", "C", "D"]);
  teams[0].setWins = 1;
  teams[1].setWins = 0;
  teams[2].setWins = 2;
  teams[3].setWins = 1;
  const order = [3, 0, 1, 2];
  const labels = order.map((i) => `${teams[i].name} ${teams[i].setWins}セット`);
  assert.deepStrictEqual(labels, ["D 1セット", "A 1セット", "B 0セット", "C 2セット"]);
}

function testMoveLeftRight() {
  let order = [0, 1, 2];
  order = ThrowOrder.move(order, 1, -1);
  assert.deepStrictEqual(order, [1, 0, 2]);
  order = ThrowOrder.move(order, 2, 1);
  assert.deepStrictEqual(order, [1, 0, 2]);
  order = ThrowOrder.move(order, 0, 1);
  assert.deepStrictEqual(order, [1, 2, 0]);
}

function run() {
  testNormalize();
  testTwoTeamAB();
  testTwoTeamBA();
  testThreeABC();
  testThreeCAB();
  testFourDABC();
  testManualReorder();
  testPersistReload();
  testLegacyWithoutThrowOrder();
  testNextSetRotation();
  testSetWinsAllTeamsVisible();
  testMoveLeftRight();
  console.log("throwOrder.test.js: all passed");
}

run();
