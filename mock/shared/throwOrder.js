/**
 * SMAScore — 投擲順（throwOrder）ユーティリティ
 * teams[] は並べ替えず、チームインデックス配列で投擲・表示順を管理する
 */
(function (root) {
  function createDefault(teamCount) {
    const n = Math.max(0, Number(teamCount) || 0);
    return Array.from({ length: n }, (_, i) => i);
  }

  function normalize(order, teamCount) {
    const n = Math.max(0, Number(teamCount) || 0);
    const fallback = createDefault(n);
    if (!Array.isArray(order) || n === 0) return fallback;

    const seen = new Set();
    const result = [];

    order.forEach((raw) => {
      const index = Number(raw);
      if (!Number.isInteger(index) || index < 0 || index >= n || seen.has(index)) return;
      seen.add(index);
      result.push(index);
    });

    fallback.forEach((index) => {
      if (!seen.has(index)) result.push(index);
    });

    return result;
  }

  function fromStartIndex(teamCount, startIndex) {
    const base = createDefault(teamCount);
    return rotateToStarter(base, startIndex);
  }

  function rotateToStarter(order, starterIndex) {
    const normalized = Array.isArray(order) ? [...order] : [];
    const idx = normalized.indexOf(starterIndex);
    if (idx <= 0) return normalized;
    return [...normalized.slice(idx), ...normalized.slice(0, idx)];
  }

  /** 次セット用: 現在の相対順を維持したまま、先頭の次を新しい先攻にする */
  function rotateForNextSet(order) {
    if (!Array.isArray(order) || order.length <= 1) {
      return Array.isArray(order) ? [...order] : [];
    }
    return [...order.slice(1), order[0]];
  }

  function move(order, teamIndex, delta) {
    const next = Array.isArray(order) ? [...order] : [];
    const from = next.indexOf(teamIndex);
    if (from < 0) return next;

    const to = from + delta;
    if (to < 0 || to >= next.length) return next;

    const tmp = next[from];
    next[from] = next[to];
    next[to] = tmp;
    return next;
  }

  function moveToFront(order, teamIndex) {
    const next = Array.isArray(order) ? [...order] : [];
    const from = next.indexOf(teamIndex);
    if (from <= 0) return next;
    next.splice(from, 1);
    next.unshift(teamIndex);
    return next;
  }

  function getNextActiveIndex(order, fromTeamIndex, teams) {
    const list = Array.isArray(order) ? order : [];
    const total = list.length;
    if (total === 0) return fromTeamIndex;

    let pos = list.indexOf(fromTeamIndex);
    if (pos < 0) pos = -1;

    for (let step = 1; step <= total; step += 1) {
      const index = list[(pos + step) % total];
      if (!teams?.[index]?.disqualified) {
        return index;
      }
    }

    return fromTeamIndex;
  }

  function startIndexOf(order) {
    return Array.isArray(order) && order.length > 0 ? order[0] : 0;
  }

  const api = {
    createDefault,
    normalize,
    fromStartIndex,
    rotateToStarter,
    rotateForNextSet,
    move,
    moveToFront,
    getNextActiveIndex,
    startIndexOf,
  };

  root.SMAScoreThrowOrder = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
