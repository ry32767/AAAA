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

const dom = {
  canvas: document.querySelector("#mazeCanvas"),
  status: document.querySelector("#statusText"),
  size: document.querySelector("#sizeSelect"),
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
  cellSize: 5,
  maze: [],
  start: { x: 1, y: 1 },
  goal: { x: 1, y: 1 },
  player: { x: 1, y: 1 },
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

function posKey(pos) {
  return `${pos.x},${pos.y}`;
}

function keyFromXY(x, y) {
  return `${x},${y}`;
}

function posFromKey(value) {
  const [x, y] = value.split(",").map(Number);
  return { x, y };
}

function samePos(a, b) {
  return a.x === b.x && a.y === b.y;
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
  document.querySelectorAll("[data-solver]").forEach((button) => {
    button.disabled = isRunning;
  });
  document.querySelectorAll("[data-move]").forEach((button) => {
    button.disabled = isRunning;
  });
}

function isOpen(x, y) {
  return y >= 0 && y < state.height && x >= 0 && x < state.width && state.maze[y][x] === 0;
}

function getNeighbors(x, y) {
  const result = [];
  for (const dir of DIRECTIONS) {
    const nx = x + dir.x;
    const ny = y + dir.y;
    if (isOpen(nx, ny)) {
      result.push({ x: nx, y: ny });
    }
  }
  return result;
}

function heuristic(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
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

function bfsDistances(maze, width, height, start) {
  const queue = [start];
  let cursor = 0;
  const distances = new Map([[posKey(start), 0]]);

  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    const currentDistance = distances.get(posKey(current));

    for (const dir of DIRECTIONS) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      const key = keyFromXY(nx, ny);
      if (
        nx >= 0 &&
        nx < width &&
        ny >= 0 &&
        ny < height &&
        maze[ny][nx] === 0 &&
        !distances.has(key)
      ) {
        distances.set(key, currentDistance + 1);
        queue.push({ x: nx, y: ny });
      }
    }
  }

  return distances;
}

function pickOpenCell(maze, width, height) {
  while (true) {
    const cell = { x: randomOdd(width), y: randomOdd(height) };
    if (maze[cell.y][cell.x] === 0) return cell;
  }
}

function farthestCell(distances) {
  let bestKey = null;
  let bestDistance = -1;
  for (const [key, distance] of distances.entries()) {
    if (distance > bestDistance) {
      bestKey = key;
      bestDistance = distance;
    }
  }
  return { cell: posFromKey(bestKey), distance: bestDistance };
}

function analyzeLongestPath(maze, width, height) {
  const first = pickOpenCell(maze, width, height);
  const distancesFromFirst = bfsDistances(maze, width, height, first);
  const p1 = farthestCell(distancesFromFirst).cell;
  const distancesFromP1 = bfsDistances(maze, width, height, p1);
  const farthest = farthestCell(distancesFromP1);
  return {
    start: p1,
    goal: farthest.cell,
    length: farthest.distance,
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

    for (const neighbor of getNeighbors(current.x, current.y)) {
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
  for (const neighbor of getNeighbors(state.goal.x, state.goal.y)) {
    if (!samePos(neighbor, entrance)) {
      state.maze[neighbor.y][neighbor.x] = 1;
    }
  }
}

function generateGame() {
  const { width, height } = parseSize(dom.size.value);
  state.width = width;
  state.height = height;
  state.cellSize = cellSizeFor(width);
  setStatus("迷路生成中...");

  let best = null;
  for (let i = 0; i < GENERATION_ATTEMPTS; i += 1) {
    const maze = generateDfsMaze(width, height);
    const analysis = analyzeLongestPath(maze, width, height);
    if (!best || analysis.length > best.length) {
      best = { maze, ...analysis };
    }
  }

  state.maze = best.maze;
  state.start = best.start;
  state.goal = best.goal;
  state.player = { ...state.start };
  ensureGoalIsDeadEnd();
  clearVisualization();
  drawMaze();
  setStatus(`生成完了: ${width} x ${height}`);
}

function drawMaze() {
  const { width, height, cellSize } = state;
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
      const key = keyFromXY(x, y);
      let color = COLORS.path;

      if (state.rejected.has(key)) color = COLORS.rejected;
      if (state.visited.has(key)) color = COLORS.flood;
      if (state.maze[y][x] === 1) color = COLORS.wall;
      if (state.pathKeys.has(key)) color = state.finalPathMode ? COLORS.solution : COLORS.confirmed;
      if (key === state.candidateKey) color = COLORS.candidate;
      if (key === state.currentKey || key === playerKey) color = COLORS.player;
      if (key === startKey) color = COLORS.start;
      if (key === goalKey) color = COLORS.goal;

      ctx.fillStyle = color;
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }

  if (state.tempBlock) {
    const [a, b] = state.tempBlock;
    ctx.strokeStyle = COLORS.tempBlock;
    ctx.lineWidth = Math.max(2, Math.floor(cellSize * 0.75));
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(a.x * cellSize + cellSize / 2, a.y * cellSize + cellSize / 2);
    ctx.lineTo(b.x * cellSize + cellSize / 2, b.y * cellSize + cellSize / 2);
    ctx.stroke();
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

    for (const neighbor of getNeighbors(current.x, current.y)) {
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

    for (const neighbor of getNeighbors(current.x, current.y)) {
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

    for (const neighbor of getNeighbors(pos.x, pos.y)) {
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

    for (const neighbor of getNeighbors(current.x, current.y)) {
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

    for (const neighbor of getNeighbors(current.pos.x, current.pos.y)) {
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
  const path = [pos];
  const visited = new Set([posKey(pos)]);
  const maxSteps = state.width * state.height * 2;
  yield [pos];

  for (let step = 0; step < maxSteps && !samePos(pos, goal); step += 1) {
    const order = leftHand ? [-1, 0, 1, 2] : [1, 0, -1, 2];
    let moved = false;

    for (const turn of order) {
      const nextDirection = (directionIndex + turn + 4) % 4;
      const dir = DIRECTIONS[nextDirection];
      const next = { x: pos.x + dir.x, y: pos.y + dir.y };
      if (isOpen(next.x, next.y)) {
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

    for (const neighbor of getNeighbors(current.x, current.y)) {
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
  const maxSteps = state.width * state.height;

  for (let step = 0; step < maxSteps && !samePos(current, goal); step += 1) {
    const neighbors = getNeighbors(current.x, current.y)
      .filter((neighbor) => !pathKeys.has(posKey(neighbor)))
      .sort((a, b) => heuristic(a, goal) - heuristic(b, goal));

    if (neighbors.length === 0) {
      return { path: null, visited: visitedOverall, rejected };
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

  return { path, visited: visitedOverall, rejected };
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
  const maxSteps = state.width * state.height;

  for (let step = 0; step < maxSteps && !samePos(current, goal); step += 1) {
    yield { type: "step", current, path: path.slice() };

    const neighbors = getNeighbors(current.x, current.y)
      .filter((neighbor) => !pathKeys.has(posKey(neighbor)))
      .sort((a, b) => heuristic(a, goal) - heuristic(b, goal));

    if (neighbors.length === 0) {
      return { path: null, visited: visitedOverall, rejected };
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
      drawMaze();
      return result;
    }

    for (const pos of step.value) state.visited.add(posKey(pos));
    setMetrics(state.visited.size, state.path.length, performance.now() - startedAt);
    setStatus(`${label}: 探索中`);
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
      drawMaze();
      return result;
    }

    const event = step.value;
    if (event.type === "step") {
      state.currentKey = posKey(event.current);
      state.candidateKey = null;
      state.tempBlock = null;
      setPath(event.path);
    }

    if (event.type === "test") {
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
    setStatus(`Paintbrush: ${event.type}`);
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
  drawMaze();
  setMetrics(state.visited.size, state.path.length, duration);
  setStatus(result.path ? `${label}: 完了` : `${label}: 解なし`);
}

async function runSolver(name) {
  if (state.running) return;

  const configs = {
    paintbrush: {
      label: "Paintbrush",
      instant: solvePaintbrushInstant,
      animated: () => animatePaintbrush,
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

function movePlayer(dx, dy) {
  if (state.running) return;
  const next = { x: state.player.x + dx, y: state.player.y + dy };
  if (!isOpen(next.x, next.y)) return;

  clearVisualization();
  state.player = next;
  drawMaze();
  if (samePos(state.player, state.goal)) {
    setStatus("ゴール");
  } else {
    setStatus("手動操作モード");
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

  const move = keyMap[event.key];
  if (!move) return;
  event.preventDefault();
  movePlayer(move[0], move[1]);
}

function bindEvents() {
  dom.generate.addEventListener("click", generateGame);
  dom.reset.addEventListener("click", resetPlayerAndView);
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
