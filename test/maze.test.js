"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const maze = require("../app.js");

// --- ヘルパー ----------------------------------------------------------------

// generateGame() の DOM 非依存部分を再現し、共有 state を構成する。
function setupMaze(width, height, floorCount) {
  const layers = Array.from({ length: floorCount }, () =>
    maze.generateDfsMaze(width, height),
  );
  maze.state.width = width;
  maze.state.height = height;
  maze.state.floorCount = floorCount;
  maze.state.layers = layers;
  maze.state.stairsByKey = maze.buildStairs(layers, width, height, floorCount);

  const endpoints = maze.chooseStartAndGoal();
  maze.state.start = endpoints.start;
  maze.state.goal = endpoints.goal;
  maze.state.player = { ...endpoints.start };
  return endpoints;
}

// path が「スタートからゴールまで、各ステップが隣接（平面 or 階段）」であることを検証。
function assertValidPath(path, start, goal) {
  assert.ok(Array.isArray(path) && path.length > 0, "path should be a non-empty array");
  assert.ok(maze.samePos(path[0], start), "path should start at the start cell");
  assert.ok(maze.samePos(path[path.length - 1], goal), "path should end at the goal cell");

  for (let i = 1; i < path.length; i += 1) {
    const prev = path[i - 1];
    const cur = path[i];
    assert.ok(
      maze.isOpen(cur.x, cur.y, cur.z),
      `path cell ${maze.posKey(cur)} should be open`,
    );
    const neighbors = maze.getNeighbors(prev).map(maze.posKey);
    assert.ok(
      neighbors.includes(maze.posKey(cur)),
      `step ${maze.posKey(prev)} -> ${maze.posKey(cur)} should be a valid move`,
    );
  }
}

// 平面（単一階層）の最短距離を BFS で求める。
function shortestLength(start, goal) {
  const distances = maze.bfsDistances(start);
  return distances.get(maze.posKey(goal));
}

// --- 迷路生成 ----------------------------------------------------------------

test("generateDfsMaze は外周が壁の完全迷路を生成する", () => {
  const width = 21;
  const height = 15;
  const grid = maze.generateDfsMaze(width, height);

  // 外周はすべて壁
  for (let x = 0; x < width; x += 1) {
    assert.equal(grid[0][x], 1, "top border is wall");
    assert.equal(grid[height - 1][x], 1, "bottom border is wall");
  }
  for (let y = 0; y < height; y += 1) {
    assert.equal(grid[y][0], 1, "left border is wall");
    assert.equal(grid[y][width - 1], 1, "right border is wall");
  }

  // 奇数座標のセルはすべて通路
  for (let y = 1; y < height; y += 2) {
    for (let x = 1; x < width; x += 2) {
      assert.equal(grid[y][x], 0, `cell (${x},${y}) should be open`);
    }
  }
});

test("生成した迷路は全通路が連結している（完全迷路）", () => {
  setupMaze(21, 15, 1);
  const layer = maze.state.layers[0];

  let openCount = 0;
  for (let y = 0; y < maze.state.height; y += 1) {
    for (let x = 0; x < maze.state.width; x += 1) {
      if (layer[y][x] === 0) openCount += 1;
    }
  }

  // 任意の通路セルから到達できるセル数が全通路数と一致すれば連結。
  const distances = maze.bfsDistances({ x: 1, y: 1, z: 0 });
  assert.equal(distances.size, openCount, "all open cells must be reachable");
});

// --- 解法アルゴリズム（単一階層） --------------------------------------------

test("BFS は妥当な最短経路を返す", () => {
  for (let i = 0; i < 5; i += 1) {
    setupMaze(21, 15, 1);
    const result = maze.solveBfsInstant();
    assertValidPath(result.path, maze.state.start, maze.state.goal);

    const optimal = shortestLength(maze.state.start, maze.state.goal);
    assert.equal(result.path.length - 1, optimal, "BFS path must be shortest");
  }
});

test("A* は許容的ヒューリスティックで最短経路を返す", () => {
  for (let i = 0; i < 5; i += 1) {
    setupMaze(21, 15, 1);
    const astar = maze.solveAstarInstant();
    assertValidPath(astar.path, maze.state.start, maze.state.goal);

    const optimal = shortestLength(maze.state.start, maze.state.goal);
    assert.equal(astar.path.length - 1, optimal, "A* path must be shortest");
  }
});

test("DFS は妥当な経路を返す", () => {
  setupMaze(21, 15, 1);
  const result = maze.solveDfsInstant();
  assertValidPath(result.path, maze.state.start, maze.state.goal);
});

test("Paintbrush は妥当な経路を返す", () => {
  setupMaze(21, 15, 1);
  const result = maze.solvePaintbrushInstant();
  assertValidPath(result.path, maze.state.start, maze.state.goal);
});

test("右手法・左手法は（フォールバック込みで）ゴールに到達する", () => {
  setupMaze(21, 15, 1);
  for (const leftHand of [false, true]) {
    const result = maze.solveWallFollowerInstant(leftHand);
    assertValidPath(result.path, maze.state.start, maze.state.goal);
  }
});

// --- 複数階層 ----------------------------------------------------------------

test("階段が上下階を相互に接続する", () => {
  setupMaze(21, 15, 3);
  const stairs = maze.state.stairsByKey;
  assert.ok(stairs.size > 0, "multi-floor maze should have stairs");

  for (const [key, targets] of stairs.entries()) {
    for (const target of targets) {
      const back = stairs.get(maze.posKey(target)) || [];
      assert.ok(
        back.some((p) => maze.posKey(p) === key),
        "stairs must connect reciprocally",
      );
    }
  }
});

test("複数階層でも各解法が階をまたいでゴールに到達する", () => {
  setupMaze(21, 15, 3);
  assert.notEqual(maze.state.start.z, maze.state.goal.z, "start and goal on different floors");

  for (const solve of [
    maze.solveBfsInstant,
    maze.solveAstarInstant,
    maze.solvePaintbrushInstant,
  ]) {
    const result = solve();
    assertValidPath(result.path, maze.state.start, maze.state.goal);
    const usesStairs = result.path.some((p, i) => i > 0 && p.z !== result.path[i - 1].z);
    assert.ok(usesStairs, "multi-floor path must change floors");
  }
});
