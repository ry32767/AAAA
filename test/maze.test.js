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

// --- シード（再現性） --------------------------------------------------------

function countOpen(layer, width, height) {
  let n = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (layer[y][x] === 0) n += 1;
    }
  }
  return n;
}

test("同じシードからは同一の迷路が再現される", () => {
  const make = () => {
    maze.setSeed(123456);
    return maze.generateDfsMaze(21, 15);
  };
  const a = make();
  const b = make();
  assert.deepEqual(a, b, "same seed must reproduce the same maze");

  maze.setSeed(987654);
  const c = maze.generateDfsMaze(21, 15);
  assert.notDeepEqual(a, c, "different seed should (almost surely) differ");
});

// --- braiding（ループ生成） --------------------------------------------------

test("braiding は通路を増やしつつ連結性を保つ", () => {
  const width = 21;
  const height = 15;

  maze.setSeed(42);
  const perfect = maze.generateDfsMaze(width, height);
  const perfectOpen = countOpen(perfect, width, height);

  maze.setSeed(42);
  const braided = maze.braidMaze(maze.generateDfsMaze(width, height), width, height, 1);
  const braidedOpen = countOpen(braided, width, height);

  assert.ok(braidedOpen > perfectOpen, "braiding should open additional passages");

  // 連結性は保たれる（壁を開けるだけなので分断されない）。
  maze.state.width = width;
  maze.state.height = height;
  maze.state.floorCount = 1;
  maze.state.layers = [braided];
  maze.state.stairsByKey = new Map();
  const distances = maze.bfsDistances({ x: 1, y: 1, z: 0 });
  assert.equal(distances.size, braidedOpen, "braided maze must stay connected");
});

// --- 全解法比較 --------------------------------------------------------------

test("solverComparison は全解法を集計し最短保証の解法を最短と判定する", () => {
  maze.setSeed(2024);
  setupMaze(21, 15, 1);
  const stats = maze.solverComparison();

  assert.equal(typeof stats.optimal, "number");
  assert.equal(stats.rows.length, 6, "all six solvers should be reported");

  const byName = Object.fromEntries(stats.rows.map((r) => [r.name, r]));
  for (const name of ["bfs", "astar"]) {
    assert.ok(byName[name].solved, `${name} should solve`);
    assert.ok(byName[name].isShortest, `${name} should find the shortest path`);
    assert.equal(byName[name].pathLength, stats.optimal);
  }
  for (const row of stats.rows) {
    assert.ok(row.solved, `${row.name} should reach the goal`);
  }
});

// --- バッチ検証 --------------------------------------------------------------

test("batchBenchmark は複数迷路の平均統計を返す", () => {
  // 現在設定を単一階層に固定して buildMaze を使えるようにする。
  maze.state.width = 21;
  maze.state.height = 15;
  maze.state.floorCount = 1;
  maze.state.braid = 0;
  maze.state.stairDensity = 3;
  maze.state.generationAttempts = 1;

  const seeds = [1, 2, 3, 4, 5];
  const stats = maze.batchBenchmark(seeds);

  assert.equal(stats.runs, seeds.length);
  assert.ok(stats.avgOptimal > 0, "average optimal length should be positive");
  assert.equal(stats.rows.length, 6);

  const byName = Object.fromEntries(stats.rows.map((r) => [r.name, r]));
  // BFS / A* は常に最短 → 最短率 100%、平均経路長は平均最短長と一致。
  for (const name of ["bfs", "astar"]) {
    assert.equal(byName[name].shortestRate, 1, `${name} should always be shortest`);
    assert.ok(Math.abs(byName[name].avgPath - stats.avgOptimal) < 1e-9);
  }
  for (const row of stats.rows) {
    assert.equal(row.solveRate, 1, `${row.name} should solve every maze`);
    assert.ok(row.avgVisited > 0);
  }
});

test("batchBenchmark は同じシード列で再現可能", () => {
  maze.state.width = 21;
  maze.state.height = 15;
  maze.state.floorCount = 1;
  maze.state.braid = 0;
  maze.state.generationAttempts = 1;

  const seeds = [11, 22, 33];
  const a = maze.batchBenchmark(seeds);
  const b = maze.batchBenchmark(seeds);
  assert.deepEqual(
    a.rows.map((r) => [r.name, r.avgPath, r.shortestRate]),
    b.rows.map((r) => [r.name, r.avgPath, r.shortestRate]),
  );
});

// --- 探索順（ヒートマップ） --------------------------------------------------

test("solverVisitOrder は探索順を 0..total-1 で連番付けする", () => {
  maze.setSeed(7);
  setupMaze(21, 15, 1);
  const visit = maze.solverVisitOrder("bfs");

  assert.ok(visit.total > 1, "should record multiple cells");
  assert.ok(visit.order.has(maze.posKey(maze.state.start)), "start must be recorded");

  const indices = [...visit.order.values()].sort((x, y) => x - y);
  assert.equal(indices[0], 0, "ordering starts at 0");
  assert.equal(indices[indices.length - 1], visit.total - 1, "ordering ends at total-1");
  // 連番（重複なし）であること。
  assert.equal(new Set(indices).size, indices.length, "indices must be unique");
});
