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

test("accumulator を逐次加算した結果は batchBenchmark と一致する（チャンク化の健全性）", () => {
  maze.state.width = 21;
  maze.state.height = 15;
  maze.state.floorCount = 1;
  maze.state.braid = 0;
  maze.state.generationAttempts = 1;

  const seeds = [101, 202, 303, 404];
  // avgTime は計測ごとに揺れるため、決定的な指標だけを比較する。
  const stripTime = (s) => ({
    runs: s.runs,
    avgOptimal: s.avgOptimal,
    rows: s.rows.map(({ avgTime, ...rest }) => rest),
  });

  const whole = maze.batchBenchmark(seeds);

  const acc = maze.createBatchAccumulator();
  for (const s of seeds) maze.batchAccumulateOne(acc, s);
  const chunked = maze.finalizeBatch(acc);

  assert.deepEqual(stripTime(whole), stripTime(chunked), "incremental accumulation must equal one-shot benchmark");
});

test("batchToCsv は迷路数分のメタ情報と全解法の行を出力する", () => {
  maze.state.width = 21;
  maze.state.height = 15;
  maze.state.floorCount = 1;
  maze.state.generationAttempts = 1;

  const stats = maze.batchBenchmark([1, 2, 3]);
  const csv = maze.batchToCsv(stats);
  const lines = csv.trim().split("\n");

  assert.match(lines[0], /^# runs=3/);
  assert.equal(lines[1], "solver,solveRate,shortestRate,avgPath,avgVisited,avgTime");
  assert.equal(lines.length, 2 + 6, "meta + header + 6 solver rows");
});

// --- パラメータ掃引 ----------------------------------------------------------

test("sweepValues は braid を等分し stairDensity を整数列にする", () => {
  const braid = maze.sweepValues("braid", 5);
  assert.equal(braid.length, 5);
  assert.equal(braid[0], 0);
  assert.equal(braid[braid.length - 1], 0.6);

  const stairs = maze.sweepValues("stairDensity", 4);
  assert.deepEqual(stairs, [1, 2, 3, 4]);
});

test("parameterSweep は各パラメータ値の集計点を返し、元の値を復元する", () => {
  maze.state.width = 21;
  maze.state.height = 15;
  maze.state.floorCount = 1;
  maze.state.generationAttempts = 1;
  maze.state.braid = 0.25; // 復元されるべき元の値

  const values = [0, 0.3, 0.6];
  const sweep = maze.parameterSweep("braid", values, 2);

  assert.equal(sweep.param, "braid");
  assert.equal(sweep.points.length, 3);
  sweep.points.forEach((p, i) => {
    assert.equal(p.value, values[i]);
    assert.equal(p.batch.runs, 2);
    assert.equal(p.batch.rows.length, 6);
  });
  assert.equal(maze.state.braid, 0.25, "sweep must restore the original parameter value");

  const csv = maze.sweepToCsv(sweep);
  assert.match(csv.split("\n")[0], /^braid,solver,/);
  assert.equal(csv.trim().split("\n").length, 1 + 3 * 6, "header + values*solvers rows");
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

// --- アニメーション速度のサイズ相対化 ----------------------------------------

// 指定サイズの迷路を複数シードで生成し、推定アニメーション時間（累積待機 ms と
// 描画回数）の平均を返す。シードを変えて平均化することで、開始/ゴール配置や
// 迷路構造のばらつきを均す。
function averageAnimation(width, height, floorCount, solver, speed, applyPacing, seeds) {
  let totalSleep = 0;
  let draws = 0;
  for (let s = 0; s < seeds; s += 1) {
    maze.setSeed(1000 + s);
    setupMaze(width, height, floorCount);
    const est = maze.estimateAnimationDuration(solver, speed, applyPacing);
    totalSleep += est.totalSleep;
    draws += est.draws;
  }
  return { totalSleep: totalSleep / seeds, draws: draws / seeds };
}

const ANIM_SIZES = [
  [81, 61],
  [121, 91],
  [151, 111],
  [201, 151],
];
const FLOORS = 3;
const SEEDS = 8;

function spread(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return max / min;
}

test("animationSizeRatio は最小サイズで 1、大きい迷路ほど増える", () => {
  assert.equal(maze.animationSizeRatio(81, 61, 1), 1, "基準（最小）サイズで 1");
  assert.ok(maze.animationSizeRatio(201, 151, 3) > 10, "大きい迷路では 1 を大きく超える");
  assert.ok(
    maze.animationSizeRatio(121, 91, 3) > maze.animationSizeRatio(81, 61, 3),
    "大きい迷路ほど比が大きい",
  );
});

test("animationPacing は大きい迷路でバッチ増・基準サイズは等倍", () => {
  const big = maze.animationPacing(maze.animationSizeRatio(201, 151, 3));
  const ref = maze.animationPacing(maze.animationSizeRatio(81, 61, 1));

  assert.ok(big.batchSize >= 10, "大きい迷路は多数ステップをまとめる");
  assert.equal(ref.batchSize, 1, "基準サイズはバッチ 1");
  assert.equal(ref.sleepFactor, 1, "基準サイズは待機等倍");
  // 総再生時間が一定になるよう batchSize と sleepFactor が補い合う。
  assert.ok(
    Math.abs(big.batchSize / big.sleepFactor - maze.animationSizeRatio(201, 151, 3)) < 1,
    "batchSize / sleepFactor は基準比に一致する",
  );
});

test("ペース配分により normal の総待機時間が迷路サイズによらずほぼ一定", () => {
  const scaled = ANIM_SIZES.map(
    ([w, h]) => averageAnimation(w, h, FLOORS, "bfs", "normal", true, SEEDS).totalSleep,
  );
  const unscaled = ANIM_SIZES.map(
    ([w, h]) => averageAnimation(w, h, FLOORS, "bfs", "normal", false, SEEDS).totalSleep,
  );

  const scaledSpread = spread(scaled);
  const unscaledSpread = spread(unscaled);

  // 従来（等倍）は迷路サイズに比例して総時間が大きくばらつく。
  assert.ok(unscaledSpread > 2.5, `従来の総待機時間は大きくばらつくはず (実測 ${unscaledSpread.toFixed(2)}x)`);
  // ペース配分後はサイズ差が大幅に縮む。
  assert.ok(scaledSpread < 1.6, `ペース配分後の総待機時間は均一化されるはず (実測 ${scaledSpread.toFixed(2)}x)`);
  assert.ok(
    scaledSpread < unscaledSpread,
    `ペース配分は均一性を改善するはず (${scaledSpread.toFixed(2)}x < ${unscaledSpread.toFixed(2)}x)`,
  );
});

test("ペース配分により fast の描画回数が迷路サイズによらずほぼ一定", () => {
  // fast は flood=0 のため待機では均一化できず、バッチ（描画回数）で均一化する。
  const scaled = ANIM_SIZES.map(
    ([w, h]) => averageAnimation(w, h, FLOORS, "bfs", "fast", true, SEEDS).draws,
  );
  const unscaled = ANIM_SIZES.map(
    ([w, h]) => averageAnimation(w, h, FLOORS, "bfs", "fast", false, SEEDS).draws,
  );

  const scaledSpread = spread(scaled);
  const unscaledSpread = spread(unscaled);

  assert.ok(unscaledSpread > 2.5, `従来の描画回数は大きくばらつくはず (実測 ${unscaledSpread.toFixed(2)}x)`);
  assert.ok(scaledSpread < 1.6, `ペース配分後の描画回数は均一化されるはず (実測 ${scaledSpread.toFixed(2)}x)`);
});

// --- 階層遷移（ルート再生） --------------------------------------------------

test("pathCrossesFloors は階段を含む経路だけ true を返す", () => {
  assert.equal(maze.pathCrossesFloors(null), false, "null は false");
  assert.equal(
    maze.pathCrossesFloors([
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 1, z: 0 },
    ]),
    false,
    "同一階のみは false",
  );
  assert.equal(
    maze.pathCrossesFloors([
      { x: 1, y: 1, z: 0 },
      { x: 1, y: 1, z: 1 },
    ]),
    true,
    "階をまたぐと true",
  );
});

test("複数階の解答ルートは階段で階をまたぐ（遷移演出の対象になる）", () => {
  maze.setSeed(42);
  setupMaze(81, 61, 3);
  const result = maze.solveBfsInstant();
  assert.ok(result.path, "経路が見つかること");
  assert.equal(
    maze.pathCrossesFloors(result.path),
    true,
    "3 階構成では解答が階をまたぐはず",
  );
});

// --- マイクロマウス視点（霧）と探索アルゴリズム ------------------------------

test("computeVisibleCells は現在地を含み、視線が壁で止まる（壁の先は見えない）", () => {
  maze.setSeed(7);
  setupMaze(21, 15, 1);
  const start = maze.state.start;
  const z = start.z;
  const layer = maze.state.layers[z];
  const vis = maze.computeVisibleCells(start);

  assert.ok(vis.has(maze.keyFromXYZ(start.x, start.y, z)), "現在地は可視");

  // +x 方向の最初の壁を探し、その先のセルが可視に含まれないこと
  let firstWallX = null;
  for (let x = start.x + 1; x < maze.state.width; x += 1) {
    if (layer[start.y][x] === 1) {
      firstWallX = x;
      break;
    }
  }
  assert.ok(firstWallX !== null, "右方向に壁が存在する");
  assert.ok(vis.has(maze.keyFromXYZ(firstWallX, start.y, z)), "視線を遮る壁面は見える");
  for (let x = firstWallX + 1; x < maze.state.width; x += 1) {
    assert.ok(
      !vis.has(maze.keyFromXYZ(x, start.y, z)),
      `壁の先 (${x},${start.y}) は見えない`,
    );
  }
});

test("revealFrom は判明済みセルを単調に増やす（再呼び出しで減らない）", () => {
  maze.setSeed(11);
  setupMaze(21, 15, 1);
  maze.state.fog = true;
  maze.state.revealed = new Set();

  maze.revealFrom(maze.state.start);
  const first = maze.state.revealed.size;
  assert.ok(first > 0, "初回で何らかのセルが判明する");

  maze.revealFrom(maze.state.start);
  assert.equal(maze.state.revealed.size, first, "同地点の再呼び出しでは増減しない");

  // 別セルから見ると（通常は）判明数が増える
  const other = maze.solveBfsInstant().path[1];
  maze.revealFrom(other);
  assert.ok(maze.state.revealed.size >= first, "別地点を加えると減らない");

  maze.state.fog = false;
});

test("マイクロマウス探索は妥当な経路でゴールへ到達する（単一・複数階）", () => {
  for (const [w, h, f] of [
    [31, 21, 1],
    [31, 21, 3],
  ]) {
    for (let s = 0; s < 5; s += 1) {
      maze.setSeed(200 + s);
      setupMaze(w, h, f);
      const result = maze.solveMicromouseInstant();
      assertValidPath(result.path, maze.state.start, maze.state.goal);
      if (f > 1) {
        const usesStairs = result.path.some((p, i) => i > 0 && p.z !== result.path[i - 1].z);
        assert.ok(usesStairs, "複数階では階段を使ってゴールへ到達する");
      }
    }
  }
});

test("マイクロマウスは既知の壁情報だけで進み、壁を通り抜けない", () => {
  maze.setSeed(42);
  setupMaze(31, 21, 1);
  const result = maze.solveMicromouseInstant();
  for (const cell of result.path) {
    assert.ok(maze.isOpen(cell.x, cell.y, cell.z), `経路セル ${maze.posKey(cell)} は通路`);
  }
});
