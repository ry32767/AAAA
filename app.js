"use strict";

const COLORS = {
  wall: "#1e293b",
  path: "#ffffff",
  start: "#10b981",
  goal: "#f43f5e",
  player: "#f59e0b",
  candidate: "#fb923c",
  tempBlock: "#dc2626",
  flood: "#7dd3fc",
  rejected: "#94a3b8",
  confirmed: "#059669",
  solution: "#fde047",
  stairUp: "#2563eb",
  stairDown: "#7c3aed",
  stairBoth: "#0891b2",
};

const DIRECTIONS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

const SPEEDS = {
  slow: { flood: 26, step: 170 },
  normal: { flood: 7, step: 60 },
  fast: { flood: 0, step: 12 },
};

const GENERATION_ATTEMPTS = 3;
const FLOOR_HEURISTIC_COST = 18;

const dom = {
  canvas: document.querySelector("#mazeCanvas"),
  status: document.querySelector("#statusText"),
  size: document.querySelector("#sizeSelect"),
  floorCount: document.querySelector("#floorCountSelect"),
  floorLabel: document.querySelector("#floorLabel"),
  floorDown: document.querySelector("#floorDownButton"),
  floorUp: document.querySelector("#floorUpButton"),
  speed: document.querySelector("#speedSelect"),
  animate: document.querySelector("#animateToggle"),
  generate: document.querySelector("#generateButton"),
  reset: document.querySelector("#resetButton"),
  stop: document.querySelector("#stopButton"),
  visitedMetric: document.querySelector("#visitedMetric"),
  pathMetric: document.querySelector("#pathMetric"),
  timeMetric: document.querySelector("#timeMetric"),
};

const ctx = dom.canvas.getContext("2d", { alpha: false });

const state = {
  width: 121,
  height: 91,
  floorCount: 3,
  visibleFloor: 0,
  cellSize: 5,
  layers: [],
  stairsByKey: new Map(),
  start: { x: 1, y: 1, z: 0 },
  goal: { x: 1, y: 1, z: 0 },
  player: { x: 1, y: 1, z: 0 },
  visited: new Set(),
  rejected: new Set(),
  path: [],
  pathKeys: new Set(),
  currentKey: null,
  candidateKey: null,
  tempBlock: null,
  finalPathMode: false,
  running: false,
  runToken: 0,
};

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(item) {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    if (this.items.length === 0) return null;
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return first;
  }

  get size() {
    return this.items.length;
  }

  bubbleUp(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].priority <= this.items[index].priority) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  bubbleDown(index) {
    const length = this.items.length;
    while (true) {
      let smallest = index;
      const left = index * 2 + 1;
      const right = left + 1;

      if (left < length && this.items[left].priority < this.items[smallest].priority) {
        smallest = left;
      }

      if (right < length && this.items[right].priority < this.items[smallest].priority) {
        smallest = right;
      }

      if (smallest === index) break;
      [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
      index = smallest;
    }
  }
}

function keyFromXYZ(x, y, z) {
  return `${x},${y},${z}`;
}

function posKey(pos) {
  return keyFromXYZ(pos.x, pos.y, pos.z);
}

function posFromKey(value) {
  const [x, y, z] = value.split(",").map(Number);
  return { x, y, z };
}

function samePos(a, b) {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function edgeKey(a, b) {
  const ka = posKey(a);
  const kb = posKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function randomOdd(limit) {
  const count = Math.floor((limit - 1) / 2);
  return 1 + Math.floor(Math.random() * count) * 2;
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseSize(value) {
  const [rawWidth, rawHeight] = value.split("x").map(Number);
  const width = rawWidth % 2 === 1 ? rawWidth : rawWidth - 1;
  const height = rawHeight % 2 === 1 ? rawHeight : rawHeight - 1;
  return { width, height };
}

function cellSizeFor(width) {
  if (width >= 190) return 4;
  if (width >= 145) return 5;
  if (width >= 110) return 6;
  return 8;
}

function setStatus(text) {
  dom.status.textContent = text;
}

function setMetrics(visitedCount = 0, pathCount = 0, duration = 0) {
  dom.visitedMetric.textContent = visitedCount.toLocaleString("ja-JP");
  dom.pathMetric.textContent = pathCount.toLocaleString("ja-JP");
  dom.timeMetric.textContent = `${duration.toFixed(duration < 10 ? 2 : 1)} ms`;
}

function floorName(index) {
  return `Floor ${index + 1}`;
}

function updateFloorUi() {
  dom.floorLabel.textContent = `${floorName(state.visibleFloor)} / ${state.floorCount}`;
  dom.floorDown.disabled = state.running || state.visibleFloor === 0;
  dom.floorUp.disabled = state.running || state.visibleFloor === state.floorCount - 1;
}

function setVisibleFloor(floor, redraw = true) {
  state.visibleFloor = clamp(floor, 0, state.floorCount - 1);
  updateFloorUi();
  if (redraw) drawMaze();
}

function setPath(path) {
  state.path = path || [];
  state.pathKeys = new Set(state.path.map(posKey));
}

function clearVisualization() {
  state.visited = new Set();
  state.rejected = new Set();
  setPath([]);
  state.currentKey = null;
  state.candidateKey = null;
  state.tempBlock = null;
  state.finalPathMode = false;
  setMetrics();
}

function resetPlayerAndView() {
  state.player = { ...state.start };
  setVisibleFloor(state.player.z, false);
  clearVisualization();
  drawMaze();
  setStatus("手動操作モード");
  dom.canvas.focus({ preventScroll: true });
}

function setControlsRunning(isRunning) {
  state.running = isRunning;
  dom.stop.disabled = !isRunning;
  dom.generate.disabled = isRunning;
  dom.reset.disabled = isRunning;
  dom.size.disabled = isRunning;
  dom.floorCount.disabled = isRunning;

  document.querySelectorAll("[data-solver]").forEach((button) => {
    button.disabled = isRunning;
  });
  document.querySelectorAll("[data-move]").forEach((button) => {
    button.disabled = isRunning;
  });
  updateFloorUi();
}

function isOpen(x, y, z) {
  return (
    z >= 0 &&
    z < state.floorCount &&
    y >= 0 &&
    y < state.height &&
    x >= 0 &&
    x < state.width &&
    state.layers[z][y][x] === 0
  );
}

function planarNeighbors(pos) {
  const result = [];
  for (const dir of DIRECTIONS) {
    const nx = pos.x + dir.x;
    const ny = pos.y + dir.y;
    if (isOpen(nx, ny, pos.z)) {
      result.push({ x: nx, y: ny, z: pos.z });
    }
  }
  return result;
}

function getStairsFrom(pos) {
  return state.stairsByKey.get(posKey(pos)) || [];
}

function getNeighbors(pos) {
  return planarNeighbors(pos).concat(getStairsFrom(pos).map((next) => ({ ...next })));
}

function heuristic(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + FLOOR_HEURISTIC_COST * Math.abs(a.z - b.z);
}

function createFilledMaze(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(1));
}

function generateDfsMaze(width, height) {
  const maze = createFilledMaze(width, height);
  const start = { x: randomOdd(width), y: randomOdd(height) };
  const stack = [start];
  maze[start.y][start.x] = 0;

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const dirs = shuffle([
      { x: 0, y: 2 },
      { x: 2, y: 0 },
      { x: 0, y: -2 },
      { x: -2, y: 0 },
    ]);

    let carved = false;
    for (const dir of dirs) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && maze[ny][nx] === 1) {
        maze[current.y + dir.y / 2][current.x + dir.x / 2] = 0;
        maze[ny][nx] = 0;
        stack.push({ x: nx, y: ny });
        carved = true;
        break;
      }
    }

    if (!carved) stack.pop();
  }

  return maze;
}

function getOpenCells(layer, z) {
  const cells = [];
  for (let y = 1; y < state.height; y += 2) {
    for (let x = 1; x < state.width; x += 2) {
      if (layer[y][x] === 0) cells.push({ x, y, z });
    }
  }
  return cells;
}

function pickOpenCell(layer, z, avoidStairs = true) {
  const cells = shuffle(getOpenCells(layer, z).slice());
  return cells.find((cell) => !avoidStairs || getStairsFrom(cell).length === 0) || cells[0];
}

function addStair(stairsByKey, a, b) {
  const aKey = posKey(a);
  const bKey = posKey(b);
  if (!stairsByKey.has(aKey)) stairsByKey.set(aKey, []);
  if (!stairsByKey.has(bKey)) stairsByKey.set(bKey, []);
  stairsByKey.get(aKey).push({ ...b });
  stairsByKey.get(bKey).push({ ...a });
}

function buildStairs(layers, width, height, floorCount) {
  const stairsByKey = new Map();
  const usedByFloor = Array.from({ length: floorCount }, () => new Set());
  const stairPairsPerJoin = width >= 145 ? 4 : 3;

  for (let z = 0; z < floorCount - 1; z += 1) {
    const candidates = [];
    for (let y = 1; y < height; y += 2) {
      for (let x = 1; x < width; x += 2) {
        if (layers[z][y][x] === 0 && layers[z + 1][y][x] === 0) {
          candidates.push({ x, y });
        }
      }
    }

    shuffle(candidates);
    let made = 0;
    for (const candidate of candidates) {
      const localKey = `${candidate.x},${candidate.y}`;
      if (usedByFloor[z].has(localKey) || usedByFloor[z + 1].has(localKey)) continue;

      const lower = { x: candidate.x, y: candidate.y, z };
      const upper = { x: candidate.x, y: candidate.y, z: z + 1 };
      addStair(stairsByKey, lower, upper);
      usedByFloor[z].add(localKey);
      usedByFloor[z + 1].add(localKey);
      made += 1;

      if (made >= stairPairsPerJoin) break;
    }
  }

  return stairsByKey;
}

function bfsDistances(start) {
  const queue = [start];
  let cursor = 0;
  const distances = new Map([[posKey(start), 0]]);

  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    const currentDistance = distances.get(posKey(current));

    for (const neighbor of getNeighbors(current)) {
      const key = posKey(neighbor);
      if (!distances.has(key)) {
        distances.set(key, currentDistance + 1);
        queue.push(neighbor);
      }
    }
  }

  return distances;
}

function farthestInFloor(distances, floor, avoidStairs = true) {
  let best = null;
  let bestDistance = -1;

  for (const [key, distance] of distances.entries()) {
    const pos = posFromKey(key);
    if (pos.z !== floor) continue;
    if (avoidStairs && getStairsFrom(pos).length > 0) continue;
    if (distance > bestDistance) {
      best = pos;
      bestDistance = distance;
    }
  }

  if (best) return { pos: best, distance: bestDistance };
  if (avoidStairs) return farthestInFloor(distances, floor, false);
  return null;
}

function chooseStartAndGoal() {
  const bottomFloor = 0;
  const topFloor = state.floorCount - 1;
  const seed = pickOpenCell(state.layers[bottomFloor], bottomFloor);
  const firstSweep = bfsDistances(seed);
  const roughGoal = farthestInFloor(firstSweep, topFloor).pos;
  const secondSweep = bfsDistances(roughGoal);
  const start = farthestInFloor(secondSweep, bottomFloor).pos;
  const finalSweep = bfsDistances(start);
  const goalInfo = farthestInFloor(finalSweep, topFloor);
  return {
    start,
    goal: goalInfo.pos,
    length: goalInfo.distance,
  };
}

function reconstructPath(parentMap, goal) {
  const path = [];
  let current = posKey(goal);

  while (current) {
    path.push(posFromKey(current));
    current = parentMap.get(current);
  }

  return path.reverse();
}

function shortestPathBetween(start, goal) {
  const queue = [start];
  let cursor = 0;
  const visited = new Set([posKey(start)]);
  const parent = new Map([[posKey(start), null]]);

  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    if (samePos(current, goal)) {
      return { path: reconstructPath(parent, goal), visited };
    }

    for (const neighbor of getNeighbors(current)) {
      const key = posKey(neighbor);
      if (!visited.has(key)) {
        visited.add(key);
        parent.set(key, posKey(current));
        queue.push(neighbor);
      }
    }
  }

  return { path: null, visited };
}

function solveBfsInstant() {
  const start = state.start;
  const goal = state.goal;
  const queue = [start];
  let cursor = 0;
  const visited = new Set([posKey(start)]);
  const parent = new Map([[posKey(start), null]]);

  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    if (samePos(current, goal)) {
      return { path: reconstructPath(parent, goal), visited };
    }

    for (const neighbor of getNeighbors(current)) {
      const key = posKey(neighbor);
      if (!visited.has(key)) {
        visited.add(key);
        parent.set(key, posKey(current));
        queue.push(neighbor);
      }
    }
  }

  return { path: null, visited };
}

function ensureGoalIsDeadEnd() {
  const result = solveBfsInstant();
  if (!result.path || result.path.length < 2) return;

  const entrance = result.path[result.path.length - 2];
  for (const neighbor of planarNeighbors(state.goal)) {
    if (!samePos(neighbor, entrance)) {
      state.layers[neighbor.z][neighbor.y][neighbor.x] = 1;
    }
  }
}

function generateGame() {
  const { width, height } = parseSize(dom.size.value);
  const floorCount = Number(dom.floorCount.value);
  state.width = width;
  state.height = height;
  state.floorCount = floorCount;
  state.cellSize = cellSizeFor(width);
  setControlsRunning(true);
  setStatus("階層迷路を生成中...");

  let best = null;
  for (let i = 0; i < GENERATION_ATTEMPTS; i += 1) {
    const layers = Array.from({ length: floorCount }, () => generateDfsMaze(width, height));
    const stairsByKey = buildStairs(layers, width, height, floorCount);

    state.layers = layers;
    state.stairsByKey = stairsByKey;
    const endpoints = chooseStartAndGoal();

    if (!best || endpoints.length > best.length) {
      best = { layers, stairsByKey, ...endpoints };
    }
  }

  state.layers = best.layers;
  state.stairsByKey = best.stairsByKey;
  state.start = best.start;
  state.goal = best.goal;
  state.player = { ...state.start };
  ensureGoalIsDeadEnd();
  state.visibleFloor = state.start.z;
  clearVisualization();
  setControlsRunning(false);
  updateFloorUi();
  drawMaze();
  setStatus(`生成完了: ${width} x ${height} x ${floorCount}階`);
}

function stairRoleAt(pos) {
  const stairs = getStairsFrom(pos);
  if (stairs.length === 0) return null;
  const hasUp = stairs.some((next) => next.z > pos.z);
  const hasDown = stairs.some((next) => next.z < pos.z);
  if (hasUp && hasDown) return "both";
  return hasUp ? "up" : "down";
}

function colorForStairRole(role) {
  if (role === "up") return COLORS.stairUp;
  if (role === "down") return COLORS.stairDown;
  if (role === "both") return COLORS.stairBoth;
  return COLORS.path;
}

function drawMaze() {
  const { width, height, cellSize } = state;
  const floor = state.visibleFloor;
  const layer = state.layers[floor];
  const canvasWidth = width * cellSize;
  const canvasHeight = height * cellSize;

  if (dom.canvas.width !== canvasWidth || dom.canvas.height !== canvasHeight) {
    dom.canvas.width = canvasWidth;
    dom.canvas.height = canvasHeight;
    dom.canvas.style.setProperty("--canvas-width", `${canvasWidth}px`);
  }

  ctx.fillStyle = COLORS.path;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const playerKey = posKey(state.player);
  const startKey = posKey(state.start);
  const goalKey = posKey(state.goal);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pos = { x, y, z: floor };
      const key = posKey(pos);
      let color = COLORS.path;

      if (layer[y][x] === 1) {
        color = COLORS.wall;
      } else {
        const stairRole = stairRoleAt(pos);
        if (stairRole) color = colorForStairRole(stairRole);
        if (state.rejected.has(key)) color = COLORS.rejected;
        if (state.visited.has(key)) color = COLORS.flood;
        if (state.pathKeys.has(key)) color = state.finalPathMode ? COLORS.solution : COLORS.confirmed;
        if (key === state.candidateKey) color = COLORS.candidate;
        if (key === state.currentKey || key === playerKey) color = COLORS.player;
        if (key === startKey) color = COLORS.start;
        if (key === goalKey) color = COLORS.goal;
      }

      ctx.fillStyle = color;
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }

  if (state.tempBlock) {
    const [a, b] = state.tempBlock;
    if (a.z === floor && b.z === floor) {
      ctx.strokeStyle = COLORS.tempBlock;
      ctx.lineWidth = Math.max(2, Math.floor(cellSize * 0.75));
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(a.x * cellSize + cellSize / 2, a.y * cellSize + cellSize / 2);
      ctx.lineTo(b.x * cellSize + cellSize / 2, b.y * cellSize + cellSize / 2);
      ctx.stroke();
    }
  }
}

function* bfsAnimated() {
  const start = state.start;
  const goal = state.goal;
  const queue = [start];
  let cursor = 0;
  const visited = new Set([posKey(start)]);
  const parent = new Map([[posKey(start), null]]);
  yield [start];

  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    if (samePos(current, goal)) {
      return { path: reconstructPath(parent, goal), visited };
    }

    for (const neighbor of getNeighbors(current)) {
      const key = posKey(neighbor);
      if (!visited.has(key)) {
        visited.add(key);
        parent.set(key, posKey(current));
        queue.push(neighbor);
        yield [neighbor];
      }
    }
  }

  return { path: null, visited };
}

function solveDfsInstant() {
  const start = state.start;
  const goal = state.goal;
  const stack = [start];
  const visited = new Set([posKey(start)]);
  const parent = new Map([[posKey(start), null]]);

  while (stack.length > 0) {
    const current = stack.pop();
    if (samePos(current, goal)) {
      return { path: reconstructPath(parent, goal), visited };
    }

    for (const neighbor of getNeighbors(current)) {
      const key = posKey(neighbor);
      if (!visited.has(key)) {
        visited.add(key);
        parent.set(key, posKey(current));
        stack.push(neighbor);
      }
    }
  }

  return { path: null, visited };
}

function* dfsAnimated() {
  const start = state.start;
  const goal = state.goal;
  const stack = [{ pos: start, path: [start] }];
  const visited = new Set();

  while (stack.length > 0) {
    const { pos, path } = stack.pop();
    const key = posKey(pos);
    if (visited.has(key)) continue;
    visited.add(key);
    yield [pos];

    if (samePos(pos, goal)) {
      return { path, visited };
    }

    for (const neighbor of getNeighbors(pos)) {
      if (!visited.has(posKey(neighbor))) {
        stack.push({ pos: neighbor, path: path.concat(neighbor) });
      }
    }
  }

  return { path: null, visited };
}

function solveAstarInstant() {
  const start = state.start;
  const goal = state.goal;
  const heap = new MinHeap();
  const startKey = posKey(start);
  const visited = new Set([startKey]);
  const parent = new Map([[startKey, null]]);
  const cost = new Map([[startKey, 0]]);

  heap.push({ priority: 0, pos: start });

  while (heap.size > 0) {
    const current = heap.pop().pos;
    if (samePos(current, goal)) {
      return { path: reconstructPath(parent, goal), visited };
    }

    for (const neighbor of getNeighbors(current)) {
      const neighborKey = posKey(neighbor);
      const newCost = cost.get(posKey(current)) + 1;
      if (!cost.has(neighborKey) || newCost < cost.get(neighborKey)) {
        cost.set(neighborKey, newCost);
        parent.set(neighborKey, posKey(current));
        visited.add(neighborKey);
        heap.push({ priority: newCost + heuristic(neighbor, goal), pos: neighbor });
      }
    }
  }

  return { path: null, visited };
}

function* astarAnimated() {
  const start = state.start;
  const goal = state.goal;
  const heap = new MinHeap();
  const startKey = posKey(start);
  const visited = new Set([startKey]);
  const cost = new Map([[startKey, 0]]);

  heap.push({ priority: 0, pos: start, path: [start] });
  yield [start];

  while (heap.size > 0) {
    const current = heap.pop();
    yield [current.pos];

    if (samePos(current.pos, goal)) {
      return { path: current.path, visited };
    }

    for (const neighbor of getNeighbors(current.pos)) {
      const neighborKey = posKey(neighbor);
      const newCost = cost.get(posKey(current.pos)) + 1;
      if (!cost.has(neighborKey) || newCost < cost.get(neighborKey)) {
        cost.set(neighborKey, newCost);
        visited.add(neighborKey);
        heap.push({
          priority: newCost + heuristic(neighbor, goal),
          pos: neighbor,
          path: current.path.concat(neighbor),
        });
        yield [neighbor];
      }
    }
  }

  return { path: null, visited };
}

function* wallFollowerAnimated(leftHand = false) {
  const goal = state.goal;
  let pos = { ...state.start };
  let directionIndex = 2;
  let previousKey = null;
  const path = [pos];
  const visited = new Set([posKey(pos)]);
  const maxSteps = Math.min(state.width * state.height * state.floorCount, 12000);
  yield [pos];

  for (let step = 0; step < maxSteps && !samePos(pos, goal); step += 1) {
    const stairOptions = getStairsFrom(pos).filter((next) => posKey(next) !== previousKey);
    if (stairOptions.length > 0) {
      const next = stairOptions.find((candidate) => !visited.has(posKey(candidate))) || stairOptions[0];
      previousKey = posKey(pos);
      pos = { ...next };
      path.push(pos);
      visited.add(posKey(pos));
      yield [pos];
      continue;
    }

    const order = leftHand ? [-1, 0, 1, 2] : [1, 0, -1, 2];
    let moved = false;

    for (const turn of order) {
      const nextDirection = (directionIndex + turn + 4) % 4;
      const dir = DIRECTIONS[nextDirection];
      const next = { x: pos.x + dir.x, y: pos.y + dir.y, z: pos.z };
      if (isOpen(next.x, next.y, next.z)) {
        previousKey = posKey(pos);
        directionIndex = nextDirection;
        pos = next;
        path.push(pos);
        visited.add(posKey(pos));
        yield [pos];
        moved = true;
        break;
      }
    }

    if (!moved) break;
  }

  if (!samePos(pos, goal)) {
    const fallback = shortestPathBetween(pos, goal);
    for (const key of fallback.visited) visited.add(key);
    if (fallback.path) {
      for (const next of fallback.path.slice(1)) {
        pos = next;
        path.push(pos);
        visited.add(posKey(pos));
        yield [pos];
      }
    }
  }

  return { path: samePos(pos, goal) ? path : null, visited };
}

function runGeneratorToEnd(generator) {
  const visited = new Set();
  while (true) {
    const step = generator.next();
    if (step.done) {
      for (const key of step.value.visited) visited.add(key);
      return { ...step.value, visited };
    }

    for (const pos of step.value) visited.add(posKey(pos));
  }
}

function solveWallFollowerInstant(leftHand = false) {
  return runGeneratorToEnd(wallFollowerAnimated(leftHand));
}

function appendFallbackPath(path, pathKeys, visited, current, goal) {
  const fallback = shortestPathBetween(current, goal);
  for (const key of fallback.visited) visited.add(key);
  if (!fallback.path) return false;

  for (const next of fallback.path.slice(1)) {
    path.push(next);
    pathKeys.add(posKey(next));
    visited.add(posKey(next));
  }
  return true;
}

function floodFillReachable(start, goal, blockedEdgeKey = null) {
  const queue = [start];
  let cursor = 0;
  const visited = new Set([posKey(start)]);

  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    if (samePos(current, goal)) {
      return { reachable: true, visited };
    }

    for (const neighbor of getNeighbors(current)) {
      if (blockedEdgeKey && edgeKey(current, neighbor) === blockedEdgeKey) continue;
      const key = posKey(neighbor);
      if (!visited.has(key)) {
        visited.add(key);
        queue.push(neighbor);
      }
    }
  }

  return { reachable: false, visited };
}

function solvePaintbrushInstant() {
  const start = state.start;
  const goal = state.goal;
  const initial = floodFillReachable(start, goal);
  if (!initial.reachable) {
    return { path: null, visited: new Set(), rejected: new Set() };
  }

  let current = start;
  const path = [current];
  const pathKeys = new Set([posKey(current)]);
  const rejected = new Set();
  const visitedOverall = new Set([posKey(current)]);
  const maxSteps = state.width * state.height * state.floorCount;

  for (let step = 0; step < maxSteps && !samePos(current, goal); step += 1) {
    const neighbors = getNeighbors(current)
      .filter((neighbor) => !pathKeys.has(posKey(neighbor)))
      .sort((a, b) => heuristic(a, goal) - heuristic(b, goal));

    if (neighbors.length === 0) {
      const completed = appendFallbackPath(path, pathKeys, visitedOverall, current, goal);
      return { path: completed ? path : null, visited: visitedOverall, rejected };
    }

    let chosen = null;
    for (const candidate of neighbors) {
      const blocked = edgeKey(current, candidate);
      const result = floodFillReachable(current, goal, blocked);
      for (const key of result.visited) visitedOverall.add(key);

      if (result.reachable) {
        rejected.add(posKey(candidate));
      } else {
        chosen = candidate;
        break;
      }
    }

    if (!chosen) chosen = neighbors[0];
    current = chosen;
    path.push(current);
    pathKeys.add(posKey(current));
    visitedOverall.add(posKey(current));
  }

  if (!samePos(current, goal)) {
    const completed = appendFallbackPath(path, pathKeys, visitedOverall, current, goal);
    return { path: completed ? path : null, visited: visitedOverall, rejected };
  }

  return { path, visited: visitedOverall, rejected };
}

function* paintbrushFallbackEvents(path, pathKeys, visitedOverall, current, goal) {
  const fallback = shortestPathBetween(current, goal);
  for (const key of fallback.visited) visitedOverall.add(key);
  if (!fallback.path) return false;

  for (const next of fallback.path.slice(1)) {
    path.push(next);
    pathKeys.add(posKey(next));
    visitedOverall.add(posKey(next));
    yield { type: "step", current: next, path: path.slice() };
  }

  return true;
}

function* paintbrushAnimated() {
  const start = state.start;
  const goal = state.goal;
  const initial = floodFillReachable(start, goal);
  if (!initial.reachable) {
    return { path: null, visited: new Set(), rejected: new Set() };
  }

  let current = start;
  const path = [current];
  const pathKeys = new Set([posKey(current)]);
  const rejected = new Set();
  const visitedOverall = new Set([posKey(current)]);
  const maxSteps = state.width * state.height * state.floorCount;

  for (let step = 0; step < maxSteps && !samePos(current, goal); step += 1) {
    yield { type: "step", current, path: path.slice() };

    const neighbors = getNeighbors(current)
      .filter((neighbor) => !pathKeys.has(posKey(neighbor)))
      .sort((a, b) => heuristic(a, goal) - heuristic(b, goal));

    if (neighbors.length === 0) {
      const completed = yield* paintbrushFallbackEvents(path, pathKeys, visitedOverall, current, goal);
      return { path: completed ? path : null, visited: visitedOverall, rejected };
    }

    let chosen = null;
    for (const candidate of neighbors) {
      const blocked = edgeKey(current, candidate);
      yield { type: "test", candidate, tempBlock: [current, candidate] };

      const result = floodFillReachable(current, goal, blocked);
      for (const key of result.visited) visitedOverall.add(key);
      yield { type: "flood", cells: result.visited };

      if (result.reachable) {
        rejected.add(posKey(candidate));
        yield { type: "reject", branch: candidate };
      } else {
        chosen = candidate;
        yield { type: "accept", branch: candidate };
        break;
      }
    }

    if (!chosen) chosen = neighbors[0];
    current = chosen;
    path.push(current);
    pathKeys.add(posKey(current));
    visitedOverall.add(posKey(current));
  }

  if (!samePos(current, goal)) {
    const completed = yield* paintbrushFallbackEvents(path, pathKeys, visitedOverall, current, goal);
    return { path: completed ? path : null, visited: visitedOverall, rejected };
  }

  return { path, visited: visitedOverall, rejected };
}

function sleep(ms) {
  return new Promise((resolve) => {
    if (ms <= 0) {
      requestAnimationFrame(() => resolve());
    } else {
      window.setTimeout(resolve, ms);
    }
  });
}

async function animateGeneric(generator, label, startedAt, token) {
  const speed = SPEEDS[dom.speed.value] || SPEEDS.normal;

  while (state.running && token === state.runToken) {
    const step = generator.next();
    if (step.done) {
      const result = step.value;
      state.visited = result.visited;
      setPath(result.path || []);
      state.rejected = result.rejected || new Set();
      state.currentKey = null;
      state.candidateKey = null;
      state.tempBlock = null;
      state.finalPathMode = Boolean(result.path);
      if (result.path) setVisibleFloor(result.path[result.path.length - 1].z, false);
      drawMaze();
      return result;
    }

    const last = step.value[step.value.length - 1];
    if (last) setVisibleFloor(last.z, false);
    for (const pos of step.value) state.visited.add(posKey(pos));
    setMetrics(state.visited.size, state.path.length, performance.now() - startedAt);
    setStatus(`${label}: 探索中 (${floorName(state.visibleFloor)})`);
    drawMaze();
    await sleep(speed.flood);
  }

  return null;
}

async function animatePaintbrush(startedAt, token) {
  const speed = SPEEDS[dom.speed.value] || SPEEDS.normal;
  const generator = paintbrushAnimated();

  while (state.running && token === state.runToken) {
    const step = generator.next();
    if (step.done) {
      const result = step.value;
      state.visited = result.visited;
      state.rejected = result.rejected;
      setPath(result.path || []);
      state.currentKey = null;
      state.candidateKey = null;
      state.tempBlock = null;
      state.finalPathMode = Boolean(result.path);
      if (result.path) setVisibleFloor(result.path[result.path.length - 1].z, false);
      drawMaze();
      return result;
    }

    const event = step.value;
    if (event.type === "step") {
      setVisibleFloor(event.current.z, false);
      state.currentKey = posKey(event.current);
      state.candidateKey = null;
      state.tempBlock = null;
      setPath(event.path);
    }

    if (event.type === "test") {
      setVisibleFloor(event.tempBlock[0].z, false);
      state.candidateKey = posKey(event.candidate);
      state.tempBlock = event.tempBlock;
    }

    if (event.type === "flood") {
      for (const key of event.cells) state.visited.add(key);
    }

    if (event.type === "reject") {
      state.rejected.add(posKey(event.branch));
    }

    setMetrics(state.visited.size, state.path.length, performance.now() - startedAt);
    setStatus(`Paintbrush: ${event.type} (${floorName(state.visibleFloor)})`);
    drawMaze();
    await sleep(event.type === "flood" ? speed.flood : speed.step);
  }

  return null;
}

function finishSolver(label, result, startedAt) {
  const duration = performance.now() - startedAt;
  state.visited = result.visited || new Set();
  state.rejected = result.rejected || new Set();
  setPath(result.path || []);
  state.currentKey = null;
  state.candidateKey = null;
  state.tempBlock = null;
  state.finalPathMode = Boolean(result.path);
  if (result.path) setVisibleFloor(result.path[result.path.length - 1].z, false);
  drawMaze();
  setMetrics(state.visited.size, state.path.length, duration);
  setStatus(result.path ? `${label}: 完了 (${floorName(state.visibleFloor)})` : `${label}: 解なし`);
}

async function runSolver(name) {
  if (state.running) return;

  const configs = {
    paintbrush: {
      label: "Paintbrush",
      instant: solvePaintbrushInstant,
      animated: () => paintbrushAnimated(),
    },
    right: {
      label: "右手法",
      instant: () => solveWallFollowerInstant(false),
      animated: () => wallFollowerAnimated(false),
    },
    left: {
      label: "左手法",
      instant: () => solveWallFollowerInstant(true),
      animated: () => wallFollowerAnimated(true),
    },
    bfs: {
      label: "BFS",
      instant: solveBfsInstant,
      animated: bfsAnimated,
    },
    dfs: {
      label: "DFS",
      instant: solveDfsInstant,
      animated: dfsAnimated,
    },
    astar: {
      label: "A*",
      instant: solveAstarInstant,
      animated: astarAnimated,
    },
  };

  const config = configs[name];
  if (!config) return;

  clearVisualization();
  setVisibleFloor(state.start.z, false);
  drawMaze();
  const token = state.runToken + 1;
  state.runToken = token;
  setControlsRunning(true);
  setStatus(`${config.label}: 開始`);
  const startedAt = performance.now();

  try {
    let result;
    if (dom.animate.checked) {
      if (name === "paintbrush") {
        result = await animatePaintbrush(startedAt, token);
      } else {
        result = await animateGeneric(config.animated(), config.label, startedAt, token);
      }
    } else {
      result = config.instant();
    }

    if (result && token === state.runToken) {
      finishSolver(config.label, result, startedAt);
    } else if (token === state.runToken) {
      setStatus(`${config.label}: 停止`);
    }
  } finally {
    if (token === state.runToken) {
      setControlsRunning(false);
      dom.canvas.focus({ preventScroll: true });
    }
  }
}

function applyStairTransition() {
  const options = getStairsFrom(state.player);
  if (options.length !== 1) return false;
  state.player = { ...options[0] };
  setVisibleFloor(state.player.z, false);
  return true;
}

function movePlayer(dx, dy) {
  if (state.running) return;
  const next = { x: state.player.x + dx, y: state.player.y + dy, z: state.player.z };
  if (!isOpen(next.x, next.y, next.z)) return;

  clearVisualization();
  state.player = next;
  const changedFloor = applyStairTransition();
  setVisibleFloor(state.player.z, false);
  drawMaze();
  if (samePos(state.player, state.goal)) {
    setStatus("ゴール");
  } else if (changedFloor) {
    setStatus(`階段移動: ${floorName(state.player.z)}`);
  } else {
    setStatus(`手動操作モード (${floorName(state.player.z)})`);
  }
}

function handleKeydown(event) {
  const keyMap = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    w: [0, -1],
    s: [0, 1],
    a: [-1, 0],
    d: [1, 0],
  };

  if (event.key === "PageUp") {
    event.preventDefault();
    setVisibleFloor(state.visibleFloor + 1);
    return;
  }

  if (event.key === "PageDown") {
    event.preventDefault();
    setVisibleFloor(state.visibleFloor - 1);
    return;
  }

  const move = keyMap[event.key];
  if (!move) return;
  event.preventDefault();
  movePlayer(move[0], move[1]);
}

function bindEvents() {
  dom.generate.addEventListener("click", generateGame);
  dom.reset.addEventListener("click", resetPlayerAndView);
  dom.floorDown.addEventListener("click", () => setVisibleFloor(state.visibleFloor - 1));
  dom.floorUp.addEventListener("click", () => setVisibleFloor(state.visibleFloor + 1));
  dom.stop.addEventListener("click", () => {
    state.runToken += 1;
    setControlsRunning(false);
    setStatus("停止しました");
  });
  document.querySelectorAll("[data-solver]").forEach((button) => {
    button.addEventListener("click", () => runSolver(button.dataset.solver));
  });
  document.querySelectorAll("[data-move]").forEach((button) => {
    button.addEventListener("click", () => {
      const moves = {
        up: [0, -1],
        down: [0, 1],
        left: [-1, 0],
        right: [1, 0],
      };
      const move = moves[button.dataset.move];
      movePlayer(move[0], move[1]);
    });
  });
  window.addEventListener("keydown", handleKeydown);
}

bindEvents();
generateGame();
