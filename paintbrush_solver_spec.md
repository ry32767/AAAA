# Paintbrush Maze Solver 実装仕様書

## 0. 目的

本仕様書は、迷路解法アルゴリズム **Paintbrush Algorithm** を実装するための開発仕様である。

Paintbrush Algorithm は、迷路上の分岐候補を一時的に塞ぎ、その状態で **flood fill / 到達可能性判定** を行うことで、その候補経路がゴール到達に必要かどうかを判定する迷路解法である。

本実装では、迷路全体が既知であることを前提とする。

参考:
- `Maze Solving Algorithms` では、Paintbrush Algorithm が Compass / Trimming / DFS / BFS と並ぶ比較対象として扱われている。
- flood fill は、連結領域を塗り広げるアルゴリズムであり、迷路では到達可能セルの判定に利用できる。
- 迷路はグラフとして扱える。セルをノード、通路をエッジ、壁をエッジなしとして表現する。

---

## 1. 対象範囲

### 実装対象

以下を実装する。

1. 迷路データ構造
2. Paintbrush Solver
3. flood fill による到達可能性判定
4. 経路復元
5. 探索イベントログ
6. 可視化用ステップ出力
7. 色付き可視化仕様
8. エラー処理
9. テストケース

### 実装対象外

以下は本仕様の対象外とする。

- 迷路生成アルゴリズム本体
- 3D 迷路
- 重み付き迷路
- リアルタイムロボット制御
- 未知迷路を歩きながら探索する処理
- 最短経路保証

Paintbrush Algorithm は最短経路探索ではない。最短経路が必要な場合は BFS または A* を別途使用する。

---

## 2. 前提条件

### 迷路の前提

迷路は2次元グリッドで表現する。

```text
row: 0 ... height - 1
col: 0 ... width - 1
```

各セルは上下左右の4方向に通路を持てる。

```text
NORTH
EAST
SOUTH
WEST
```

斜め移動は許可しない。

### スタート・ゴール

```text
start: CellCoord
goal: CellCoord
```

start と goal は通路セルでなければならない。

### 完全迷路・ループ迷路

本実装は以下の両方に対応する。

| 迷路種別 | 対応 |
|---|---|
| 完全迷路 | 対応 |
| ループあり迷路 | 対応 |
| 解なし迷路 | 対応 |
| 複数解迷路 | 対応 |

ただし、複数解迷路では Paintbrush の探索順に依存して1本の経路を返す。

---

## 3. データ構造

### CellCoord

```ts
type CellCoord = {
  row: number;
  col: number;
};
```

### Direction

```ts
type Direction = "N" | "E" | "S" | "W";
```

### MazeCell

各セルは、各方向に壁があるかどうかを持つ。

```ts
type MazeCell = {
  row: number;
  col: number;
  walls: {
    N: boolean;
    E: boolean;
    S: boolean;
    W: boolean;
  };
};
```

`walls.N === true` は北方向に壁があることを意味する。  
`walls.N === false` は北方向へ移動可能であることを意味する。

### Maze

```ts
type Maze = {
  width: number;
  height: number;
  cells: MazeCell[][];
};
```

### Neighbor

```ts
type Neighbor = {
  coord: CellCoord;
  direction: Direction;
};
```

### SolverResult

```ts
type SolverResult = {
  solved: boolean;
  algorithm: "paintbrush";
  path: CellCoord[];
  visitedCount: number;
  floodFillCount: number;
  blockedTestCount: number;
  rejectedBranches: CellCoord[][];
  events: PaintbrushEvent[];
  reason?: string;
};
```

---

## 4. 基本アルゴリズム

### 中心思想

現在セルから移動可能な候補を1つずつ検査する。

候補通路を一時的に塞ぐ。

その状態で、現在セルから flood fill を実行する。

- goal に到達できる場合  
  → その候補通路は不要な可能性が高い  
  → 候補を誤分岐として扱う

- goal に到達できない場合  
  → その候補通路を塞ぐとゴールへ行けない  
  → その候補は必要経路である  
  → その候補方向へ進む

この処理を goal に到達するまで繰り返す。

---

## 5. 重要な設計判断

### 5.1 探索順

Paintbrush は探索順により返す経路が変わる可能性がある。

本仕様では、デフォルト探索順を次のようにする。

```text
N → E → S → W
```

ただし、オプションでゴールに近い順に並べ替え可能にする。

```ts
type NeighborOrderMode =
  | "fixed"
  | "manhattan_to_goal"
  | "clockwise"
  | "counterclockwise";
```

推奨デフォルト:

```text
manhattan_to_goal
```

理由は、Paintbrush の「塗って判断する」性質を保ちつつ、視覚的に納得しやすい経路になりやすいため。

### 5.2 すでに経路に含まれるセルの扱い

無限ループ防止のため、現在の確定 path にすでに含まれているセルへは原則として進まない。

ただし、ループあり迷路で探索が詰まる場合に備え、オプションを用意する。

```ts
type PaintbrushOptions = {
  allowRevisit: boolean;
};
```

デフォルト:

```ts
allowRevisit = false
```

### 5.3 複数解の扱い

複数の候補を塞いでも goal へ到達できない場合、最初に見つかった必要候補を採用する。

探索順を変えれば、異なる解が得られる可能性がある。

### 5.4 最短保証

Paintbrush は最短経路を保証しない。  
最短経路評価には BFS を併用すること。

---

## 6. 関数仕様

### solvePaintbrush

```ts
function solvePaintbrush(
  maze: Maze,
  start: CellCoord,
  goal: CellCoord,
  options?: PaintbrushOptions
): SolverResult;
```

#### 入力

| 引数 | 型 | 説明 |
|---|---|---|
| maze | Maze | 迷路本体 |
| start | CellCoord | 開始セル |
| goal | CellCoord | 目標セル |
| options | PaintbrushOptions | 任意設定 |

#### 出力

`SolverResult` を返す。

#### 事前条件

- maze.width > 0
- maze.height > 0
- start が範囲内
- goal が範囲内
- start と goal が通路セル
- 壁情報が隣接セル間で矛盾していない

#### 失敗条件

以下の場合は `solved: false` を返す。

- start / goal が範囲外
- start から goal に到達不能
- 探索中に有効候補がなくなった
- 最大ステップ数を超えた

---

## 7. オプション仕様

```ts
type PaintbrushOptions = {
  neighborOrderMode?: NeighborOrderMode;
  allowRevisit?: boolean;
  maxSteps?: number;
  emitEvents?: boolean;
  visualization?: VisualizationOptions;
};
```

### デフォルト値

```ts
const defaultOptions: Required<PaintbrushOptions> = {
  neighborOrderMode: "manhattan_to_goal",
  allowRevisit: false,
  maxSteps: maze.width * maze.height * 4,
  emitEvents: true,
  visualization: defaultVisualizationOptions
};
```

---

## 8. flood fill 仕様

### 関数

```ts
function floodFillReachable(
  maze: Maze,
  from: CellCoord,
  goal: CellCoord,
  temporaryBlockedEdge?: BlockedEdge,
  blockedCells?: Set<string>
): FloodFillResult;
```

### BlockedEdge

```ts
type BlockedEdge = {
  a: CellCoord;
  b: CellCoord;
};
```

### FloodFillResult

```ts
type FloodFillResult = {
  goalReachable: boolean;
  visitedCells: Set<string>;
  visitOrder: CellCoord[];
};
```

### 処理

1. `from` をキューへ入れる
2. BFS 形式で通路を広げる
3. `temporaryBlockedEdge` は壁として扱う
4. `blockedCells` が指定されている場合、それらのセルは通行不可として扱う
5. goal に到達したら `goalReachable = true`
6. キューが空になれば終了

### 計算量

迷路のセル数を `V`、通路数を `E` とすると、flood fill 1回は以下。

```text
O(V + E)
```

Paintbrush 全体では、分岐候補検査回数を `B` として以下。

```text
O(B * (V + E))
```

---

## 9. Paintbrush Solver 詳細手順

### 擬似コード

```text
function solvePaintbrush(maze, start, goal):
    validate input

    if goal is not reachable from start:
        return unsolved

    current = start
    path = [start]
    rejectedBranches = []
    events = []

    while current != goal:
        emit STEP_START

        neighbors = movableNeighbors(current)
        neighbors = remove cells already in path unless allowRevisit is true
        neighbors = orderNeighbors(neighbors)

        if neighbors is empty:
            return unsolved

        chosen = null

        for candidate in neighbors:
            emit CANDIDATE_TEST_START

            temporarily block edge(current, candidate)

            flood = floodFillReachable(
                maze,
                current,
                goal,
                blockedEdge = edge(current, candidate),
                blockedCells = cells in rejected branches
            )

            emit FLOOD_FILL_RESULT

            unblock edge(current, candidate)

            if flood.goalReachable == true:
                mark candidate as rejected branch
                emit BRANCH_REJECTED
                continue

            if flood.goalReachable == false:
                chosen = candidate
                emit BRANCH_ACCEPTED
                break

        if chosen is null:
            # すべての候補を塞いでも goal に到達可能だった場合
            # ループ迷路や複数解迷路では発生し得る。
            # この場合は、goal に最も近い候補へ進む。
            chosen = fallbackChooseNeighbor(neighbors)
            emit FALLBACK_CHOSEN

        path.push(chosen)
        current = chosen

    emit SOLVED

    return solved result
```

---

## 10. 分岐判定の補足

### 「塞いでも goal に到達できる」場合

その候補方向を使わなくても goal に行ける。  
したがって、その候補は現時点では不要な枝と判定する。

可視化ではこの枝を「誤分岐候補」として赤または灰色で表示する。

### 「塞ぐと goal に到達できない」場合

その候補を塞ぐと goal に行けない。  
したがって、その候補は goal へ向かうために必要な候補と判定する。

可視化ではこの枝を「採用経路」として緑または黄色で表示する。

### fallback が必要な理由

ループあり迷路では、すべての候補を塞いでも別ルートで goal に到達できる場合がある。  
この場合、Paintbrush の単純判定では必須枝が見つからない。

そのため fallback として、以下の優先順位で候補を選ぶ。

```text
1. goal へのマンハッタン距離が最小
2. 未訪問セル
3. 方向順 N → E → S → W
```

---

## 11. イベントログ仕様

可視化のため、Solver は各ステップでイベントを出力する。

```ts
type PaintbrushEvent =
  | StepStartEvent
  | CandidateTestStartEvent
  | FloodFillVisitEvent
  | FloodFillResultEvent
  | BranchRejectedEvent
  | BranchAcceptedEvent
  | FallbackChosenEvent
  | MoveEvent
  | SolvedEvent
  | FailedEvent;
```

### StepStartEvent

```ts
type StepStartEvent = {
  type: "STEP_START";
  step: number;
  current: CellCoord;
  path: CellCoord[];
};
```

### CandidateTestStartEvent

```ts
type CandidateTestStartEvent = {
  type: "CANDIDATE_TEST_START";
  step: number;
  current: CellCoord;
  candidate: CellCoord;
  blockedEdge: BlockedEdge;
};
```

### FloodFillVisitEvent

```ts
type FloodFillVisitEvent = {
  type: "FLOOD_FILL_VISIT";
  step: number;
  cell: CellCoord;
  order: number;
};
```

### FloodFillResultEvent

```ts
type FloodFillResultEvent = {
  type: "FLOOD_FILL_RESULT";
  step: number;
  candidate: CellCoord;
  blockedEdge: BlockedEdge;
  goalReachable: boolean;
  visitedCells: CellCoord[];
};
```

### BranchRejectedEvent

```ts
type BranchRejectedEvent = {
  type: "BRANCH_REJECTED";
  step: number;
  current: CellCoord;
  rejectedCandidate: CellCoord;
  reason: "goal_reachable_without_candidate";
};
```

### BranchAcceptedEvent

```ts
type BranchAcceptedEvent = {
  type: "BRANCH_ACCEPTED";
  step: number;
  current: CellCoord;
  acceptedCandidate: CellCoord;
  reason: "goal_unreachable_when_candidate_blocked";
};
```

### MoveEvent

```ts
type MoveEvent = {
  type: "MOVE";
  step: number;
  from: CellCoord;
  to: CellCoord;
  path: CellCoord[];
};
```

### SolvedEvent

```ts
type SolvedEvent = {
  type: "SOLVED";
  step: number;
  path: CellCoord[];
};
```

### FailedEvent

```ts
type FailedEvent = {
  type: "FAILED";
  step: number;
  reason: string;
};
```

---

## 12. 可視化仕様

### 12.1 基本方針

Paintbrush の可視化では、「塗り広げる」「候補を塞ぐ」「経路を採用する」という動きが直感的に分かることを優先する。

単に最終経路だけを表示するのではなく、以下の状態を色分けする。

1. 未訪問セル
2. 壁
3. 現在セル
4. start
5. goal
6. 一時的に塞いでいる候補辺
7. flood fill で塗られたセル
8. goal に到達可能と判定された塗り領域
9. 不要と判定された枝
10. 採用された枝
11. 最終解経路

---

## 13. カラーパレット

視認性と色覚多様性を考慮し、背景は明るめ、壁は濃色、探索状態は彩度のある色で表現する。

### 推奨カラー

| 用途 | 色名 | HEX | 備考 |
|---|---:|---:|---|
| 背景 | Slate 50 | `#F8FAFC` | 画面全体 |
| 通路セル | White | `#FFFFFF` | 通常セル |
| 壁 | Slate 800 | `#1E293B` | 太めに描画 |
| グリッド線 | Slate 200 | `#E2E8F0` | 薄く表示 |
| start | Emerald 500 | `#10B981` | 開始地点 |
| goal | Rose 500 | `#F43F5E` | 目標地点 |
| 現在セル | Amber 400 | `#FBBF24` | 強調表示 |
| 候補セル | Orange 400 | `#FB923C` | 検査中候補 |
| 一時ブロック辺 | Red 600 | `#DC2626` | 太線・点滅可 |
| flood fill 領域 | Sky 300 | `#7DD3FC` | 半透明推奨 |
| flood fill 境界 | Sky 600 | `#0284C7` | 外枠 |
| goal 到達成功領域 | Cyan 300 | `#67E8F9` | 半透明 |
| 不採用枝 | Slate 400 | `#94A3B8` | 灰色で沈める |
| 採用枝 | Lime 500 | `#84CC16` | 採用時の強調 |
| 確定 path | Emerald 600 | `#059669` | 現在までの経路 |
| 最終 solution | Yellow 300 | `#FDE047` | 太線またはハイライト |
| エラー | Red 500 | `#EF4444` | 解なしなど |

### 透明度

```text
flood fill 領域: opacity 0.45
goal 到達成功領域: opacity 0.55
不採用枝: opacity 0.35
確定 path: opacity 0.85
最終 solution: opacity 0.95
```

---

## 14. 可視化アニメーション仕様

### 推奨ステージ

1. `STEP_START`
   - 現在セルを Amber で表示
   - 既存 path を Emerald で表示

2. `CANDIDATE_TEST_START`
   - 候補セルを Orange で表示
   - current と candidate の間の辺を Red で一時ブロック表示

3. `FLOOD_FILL_VISIT`
   - flood fill で訪れたセルを Sky で順に塗る
   - 塗りが広がる速度は 10〜30ms / cell を推奨

4. `FLOOD_FILL_RESULT`
   - goal に到達できた場合:
     - 塗り領域を Cyan に一瞬変化
     - 候補枝を「不要」として Slate 400 へフェード
   - goal に到達できなかった場合:
     - 候補枝を Lime で強調
     - その方向を採用候補として表示

5. `MOVE`
   - current を candidate へ移動
   - path を Emerald で伸ばす

6. `SOLVED`
   - 最終解経路を Yellow で太く描画
   - start を Emerald、goal を Rose のまま保持
   - 不採用枝は薄い Slate で残す

### アニメーション速度

```ts
type AnimationSpeed = "slow" | "normal" | "fast";
```

推奨値:

| モード | flood fill | move | result pause |
|---|---:|---:|---:|
| slow | 30ms/cell | 250ms | 700ms |
| normal | 12ms/cell | 120ms | 350ms |
| fast | 2ms/cell | 50ms | 120ms |

---

## 15. Canvas / SVG 描画仕様

### 推奨

迷路サイズが小〜中規模なら SVG。  
大規模迷路なら Canvas。

| 迷路サイズ | 推奨 |
|---|---|
| 50 x 50 以下 | SVG |
| 50 x 50 超 | Canvas |
| アニメーション重視 | Canvas |

### セル描画

```text
cellSize = min(canvasWidth / maze.width, canvasHeight / maze.height)
```

壁はセル境界に描画する。

```text
wallWidth = max(2, cellSize * 0.12)
pathWidth = max(3, cellSize * 0.35)
```

### 経路描画

セル中心点を結ぶ polyline として描画する。

```text
centerX = col * cellSize + cellSize / 2
centerY = row * cellSize + cellSize / 2
```

### 推奨レイヤー順

下から順に描画する。

```text
1. background
2. passage cells
3. flood fill overlay
4. rejected branches
5. confirmed path
6. candidate / temporary block
7. start / goal / current
8. walls
9. labels / legend
```

壁を最上位に近いレイヤーで描画すると、塗りつぶしが壁を越えて見える問題を防げる。

---

## 16. UI 表示項目

可視化画面には以下を表示する。

### 必須

```text
Algorithm: Paintbrush
Step
Current cell
Candidate cell
Flood fill visited count
Blocked tests count
Path length
Status
```

### 推奨

```text
Goal reachable without candidate: true / false
Rejected branch count
Fallback count
Elapsed time
Animation speed selector
Pause / Resume
Step forward
Step backward
Reset
```

### 凡例

画面右または下に凡例を表示する。

```text
Green: Start / confirmed path
Rose: Goal
Amber: Current
Orange: Candidate
Red: Temporary block
Sky: Flood fill
Gray: Rejected branch
Yellow: Final solution
```

---

## 17. エラー処理

### 入力エラー

```ts
{
  solved: false,
  reason: "invalid_start_or_goal"
}
```

### 到達不能

```ts
{
  solved: false,
  reason: "goal_unreachable_from_start"
}
```

### 探索不能

```ts
{
  solved: false,
  reason: "no_valid_neighbor"
}
```

### ステップ上限

```ts
{
  solved: false,
  reason: "max_steps_exceeded"
}
```

---

## 18. テスト仕様

### テスト1: 直線迷路

```text
S - - - G
```

期待:

```text
solved = true
path_length = 5
blockedTestCount >= 1
```

### テスト2: 単純な行き止まりあり迷路

```text
S - A - G
    |
    D
```

期待:

```text
D 側が rejected branch になる
A → G 側が accepted branch になる
```

### テスト3: 完全迷路

期待:

```text
solved = true
path が start から goal まで連続している
壁を通過しない
```

### テスト4: ループあり迷路

期待:

```text
solved = true
必要に応じて fallback が発生してもよい
無限ループしない
```

### テスト5: 解なし迷路

期待:

```text
solved = false
reason = "goal_unreachable_from_start"
```

### テスト6: start == goal

期待:

```text
solved = true
path = [start]
```

---

## 19. 品質基準

### 正しさ

- path の先頭が start
- path の末尾が goal
- path の各隣接セル間に通路がある
- 壁を越えない
- `solved = true` のとき path が空でない

### 可視化

- flood fill が壁を越えて表示されない
- 一時ブロック辺が明確に見える
- 採用枝と不採用枝が区別できる
- start / goal / current が常に判別できる
- 最終解が最も目立つ

### パフォーマンス

50 x 50 程度の迷路で、通常速度の可視化が破綻しないこと。  
100 x 100 以上では、flood fill イベントを間引けるようにする。

```ts
type VisualizationOptions = {
  emitEveryNthFloodCell?: number;
};
```

推奨:

```text
50 x 50 以下: 1
100 x 100: 4
200 x 200: 10
```

---

## 20. 実装上の注意

### flood fill は副作用なしで実装する

一時ブロックは maze 本体を書き換えず、関数引数として渡す。

悪い例:

```text
maze の壁情報を直接 true に変更する
```

良い例:

```text
isEdgeBlocked(a, b, temporaryBlockedEdge) で判定する
```

### 座標キー

Set / Map 用のキーは以下で統一する。

```ts
function keyOf(cell: CellCoord): string {
  return `${cell.row},${cell.col}`;
}
```

### 隣接チェック

壁の整合性を必ず確認する。

```text
A の E が open なら、B の W も open であるべき
```

矛盾がある場合は validation error とするか、片側基準で補正する。

推奨は validation error。

---

## 21. 推奨ファイル構成

```text
src/
  maze/
    types.ts
    validation.ts
    neighbors.ts
  solvers/
    paintbrush.ts
    floodFill.ts
    bfs.ts
  visualization/
    paintbrushEvents.ts
    colorPalette.ts
    MazeCanvasRenderer.ts
    MazeSvgRenderer.ts
  tests/
    paintbrush.test.ts
    floodFill.test.ts
```

---

## 22. 実装順序

```text
1. Maze 型定義
2. keyOf / equals / inBounds
3. movableNeighbors
4. floodFillReachable
5. validateMaze
6. solvePaintbrush
7. PaintbrushEvent 出力
8. テストケース
9. Canvas / SVG 可視化
10. アニメーション制御
```

---

## 23. Gemini CLI への実装指示

以下の方針で実装すること。

```text
Paintbrush Algorithm を TypeScript で実装してください。

要件:
- 迷路は2次元グリッドとして扱う
- セルは上下左右の壁情報を持つ
- solvePaintbrush() を実装する
- 各候補通路を一時的に塞ぎ、flood fill で goal 到達可能性を判定する
- maze 本体は変更しない
- 探索過程を PaintbrushEvent[] として返す
- 可視化で使えるよう、flood fill の訪問順もイベント化する
- 最短経路保証は不要
- BFS は到達可能性の事前検証用としてのみ実装してよい
- テストを追加する
- Canvas または SVG で可視化できるように色付き状態情報を出力する

可視化:
- 壁は #1E293B
- 通路は #FFFFFF
- start は #10B981
- goal は #F43F5E
- current は #FBBF24
- candidate は #FB923C
- temporary block は #DC2626
- flood fill は #7DD3FC with opacity 0.45
- rejected branch は #94A3B8 with opacity 0.35
- accepted branch は #84CC16
- confirmed path は #059669
- final solution は #FDE047
- 最終解経路は最も目立つよう太線で描画する
- flood fill は塗り広がるアニメーションにする
- 一時ブロック辺は赤い太線または点滅で表示する
```

---

## 24. 完了条件

以下を満たしたら実装完了とする。

```text
- solvePaintbrush() が動作する
- floodFillReachable() が単体テストを通る
- start から goal までの path を返せる
- 解なしを検出できる
- 探索イベントログが出力される
- flood fill の可視化に必要な visitedCells / visitOrder が取得できる
- 色指定に基づく可視化が可能
- 最終解経路が明確に表示される
- 主要テストケースが通る
```
