import tkinter as tk
from tkinter import ttk
from tkinter import messagebox
import random
import time
import collections
import heapq

# --- 定数定義 ---
MAZE_WIDTH = 201
MAZE_HEIGHT = 151
CELL_SIZE = 3
WINDOW_WIDTH = MAZE_WIDTH * CELL_SIZE
WINDOW_HEIGHT = MAZE_HEIGHT * CELL_SIZE
GENERATION_ATTEMPTS = 3

# アニメーション速度
ANIMATION_SPEEDS = {"slow": (30, 250), "normal": (12, 120), "fast": (0, 10)}
CURRENT_SPEED = "normal"
FLOOD_FILL_DELAY, MOVE_DELAY = ANIMATION_SPEEDS[CURRENT_SPEED]

# --- カラーパレット (仕様書準拠) ---
COLOR_WALL = "#1E293B"
COLOR_PATH = "#FFFFFF"
COLOR_START = "#10B981"
COLOR_GOAL = "#F43F5E"
COLOR_CURRENT_PLAYER = "#FBBF24"
COLOR_CANDIDATE = "#FB923C"
COLOR_TEMP_BLOCK = "#DC2626"
COLOR_FLOOD_FILL = "#7DD3FC"
COLOR_REJECTED_BRANCH = "#94A3B8"
COLOR_ACCEPTED_BRANCH = "#84CC16"
COLOR_CONFIRMED_PATH = "#059669"
COLOR_FINAL_SOLUTION = "#FDE047"

class MazeGame:
    def __init__(self, master):
        self.master = master
        master.title("迷路ゲーム＆ソルバー")
        master.resizable(False, False)
        self.solver_running = False
        self.directions = [(0, -1), (1, 0), (0, 1), (-1, 0)] 
        self.temp_visual_state = {}
        self.temp_drawings = []

        maze_frame = tk.Frame(master); maze_frame.pack(side=tk.TOP)
        control_frame = tk.Frame(master); control_frame.pack(side=tk.BOTTOM, fill=tk.X, padx=10, pady=5)
        self.canvas = tk.Canvas(maze_frame, width=WINDOW_WIDTH, height=WINDOW_HEIGHT, bg=COLOR_PATH)
        self.canvas.pack()

        self.cell_rects = [[
            self.canvas.create_rectangle(
                x * CELL_SIZE, y * CELL_SIZE,
                x * CELL_SIZE + CELL_SIZE, y * CELL_SIZE + CELL_SIZE,
                fill=COLOR_PATH, outline=COLOR_PATH
            )
            for x in range(MAZE_WIDTH)]
            for y in range(MAZE_HEIGHT)
        ]

        self.buttons = {}; self.add_solver_buttons(control_frame)
        self.status_label = tk.Label(control_frame, text="手動操作モード", relief=tk.SUNKEN, anchor=tk.W)
        self.status_label.pack(fill=tk.X, side=tk.LEFT, expand=True, padx=(10, 0))

        self.init_game()
        self.master.bind("<KeyPress>", self.on_key_press)

    def add_solver_buttons(self, parent):
        button_frame = tk.Frame(parent); button_frame.pack(side=tk.LEFT)
        self.solvers_config = {
            "Paintbrush": {"command": lambda: self.solve_wrapper(self._paintbrush_instant, self._paintbrush_animated, "Paintbrush")},
            "Right-Hand": {"command": lambda: self.solve_wrapper(self._right_hand_instant, self._right_hand_animated, "右手法")},
            "Left-Hand": {"command": lambda: self.solve_wrapper(self._left_hand_instant, self._left_hand_animated, "左手法")},
            "BFS": {"command": lambda: self.solve_wrapper(self._bfs_instant, self._bfs_animated, "幅優先探索(BFS)")},
            "DFS": {"command": lambda: self.solve_wrapper(self._dfs_instant, self._dfs_animated, "深さ優先探索(DFS)")},
            "A*": {"command": lambda: self.solve_wrapper(self._astar_instant, self._astar_animated, "A*探索")},
        }
        for name, config in self.solvers_config.items():
            btn = ttk.Button(button_frame, text=name, command=config.get("command"), state=config.get("state", "normal"))
            btn.pack(side=tk.LEFT, padx=2); self.buttons[name] = btn
        ttk.Button(button_frame, text="リセット", command=self.reset_visualization).pack(side=tk.LEFT, padx=2)
        ttk.Button(button_frame, text="迷路生成", command=self.init_game).pack(side=tk.LEFT, padx=2)
        self.animate_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(button_frame, text="アニメーション", variable=self.animate_var).pack(side=tk.LEFT, padx=5)

    def set_buttons_state(self, state):
        for name, btn in self.buttons.items():
            if self.solvers_config[name].get("state") != "disabled": btn.config(state=state)

    def init_game(self):
        self.solver_running = True; self.set_buttons_state("disabled")
        self.status_label.config(text="高難易度迷路を生成中..."); self.master.update_idletasks()
        best_maze, best_path_len, best_start, best_goal = None, -1, None, None
        for i in range(GENERATION_ATTEMPTS):
            self.status_label.config(text=f"高難易度迷路を生成中... ({i+1}/{GENERATION_ATTEMPTS})"); self.master.update_idletasks()
            maze_data = [[1 for _ in range(MAZE_WIDTH)] for _ in range(MAZE_HEIGHT)]
            rand_x, rand_y = random.choice(range(1, MAZE_WIDTH, 2)), random.choice(range(1, MAZE_HEIGHT, 2))
            self._generate_dfs(maze_data, rand_x, rand_y)
            start_node, end_node, path_len = self._find_longest_path(maze_data)
            if path_len > best_path_len: best_path_len, best_maze, best_start, best_goal = path_len, maze_data, start_node, end_node
        self.maze = best_maze; self.start_pos = {'x': best_start[0], 'y': best_start[1]}; self.goal_pos = {'x': best_goal[0], 'y': best_goal[1]}
        self.player_pos = self.start_pos.copy()
        self.ensure_goal_is_dead_end()
        self.reset_visualization()
        self.solver_running = False; self.set_buttons_state("normal")

    def _generate_dfs(self, maze_data, cx, cy):
        stack = [(cx, cy)]
        maze_data[cy][cx] = 0
        while stack:
            current_x, current_y = stack[-1]
            dirs = [(0, 2), (0, -2), (2, 0), (-2, 0)]
            random.shuffle(dirs)

            neighbor_found = False
            for dx, dy in dirs:
                nx, ny = current_x + dx, current_y + dy
                if 0 <= nx < MAZE_WIDTH and 0 <= ny < MAZE_HEIGHT and maze_data[ny][nx] == 1:
                    maze_data[ny - dy // 2][nx - dx // 2] = 0
                    maze_data[ny][nx] = 0
                    stack.append((nx, ny))
                    neighbor_found = True
                    break

            if not neighbor_found:
                stack.pop()

    def _bfs_for_analysis(self, maze_data, start_node):
        queue = collections.deque([start_node]); distances = {start_node: 0}
        while queue:
            x, y = queue.popleft()
            for dx, dy in self.directions:
                nx, ny = x + dx, y + dy; neighbor = (nx, ny)
                if 0 <= nx < MAZE_WIDTH and 0 <= ny < MAZE_HEIGHT and maze_data[ny][nx] == 0 and neighbor not in distances:
                    distances[neighbor] = distances[(x,y)] + 1; queue.append(neighbor)
        return distances

    def _find_longest_path(self, maze_data):
        start_x, start_y = -1, -1
        while True:
            x, y = random.choice(range(1, MAZE_WIDTH, 2)), random.choice(range(1, MAZE_HEIGHT, 2))
            if maze_data[y][x] == 0: start_x, start_y = x, y; break
        distances_from_start = self._bfs_for_analysis(maze_data, (start_x, start_y))
        if not distances_from_start: return (0,0), (0,0), -1
        p1 = max(distances_from_start, key=distances_from_start.get)
        distances_from_p1 = self._bfs_for_analysis(maze_data, p1)
        if not distances_from_p1: return (0,0), (0,0), -1
        p2 = max(distances_from_p1, key=distances_from_p1.get)
        return p1, p2, distances_from_p1[p2]

    def ensure_goal_is_dead_end(self):
        path, _ = self._bfs_instant()
        if not path or len(path) < 2: return
        entrance_node = path[-2]; goal_node = (self.goal_pos['x'], self.goal_pos['y'])
        for neighbor in self._get_neighbors(*goal_node):
            if neighbor != entrance_node: self.maze[neighbor[1]][neighbor[0]] = 1

    def reset_visualization(self):
        self.visited, self.path, self.rejected_branches = set(), [], set()
        self.temp_visual_state = {}
        self.status_label.config(text="手動操作モード")
        self.draw_maze()

    def solve_wrapper(self, instant_func, animated_func, name):
        if self.solver_running: return
        self.solver_running = True; self.reset_visualization(); self.set_buttons_state("disabled"); self.master.update_idletasks()
        if self.animate_var.get() and animated_func:
            if name == "Paintbrush": self.animate_paintbrush_solver(animated_func, name)
            else: self.animate_solver(animated_func, name)
        else:
            start_time = time.perf_counter(); result = instant_func(); end_time = time.perf_counter()
            path, visited_nodes = result[0], result[1]
            if name == "Paintbrush": self.rejected_branches = result[2]
            self.visited, self.path = visited_nodes, path or []
            self.draw_maze()
            duration = (end_time - start_time) * 1000
            result_text = f"{name}: {len(self.visited)}マスを探索, {duration:.2f} ms"
            if not path: result_text += " (解なし)"
            self.status_label.config(text=result_text)
            self.solver_running = False; self.set_buttons_state("normal")

    def animate_solver(self, algorithm_generator, name):
        solver_gen = algorithm_generator(); start_time = time.perf_counter()
        start_node = (self.start_pos['x'], self.start_pos['y'])
        goal_node = (self.goal_pos['x'], self.goal_pos['y'])
        def animation_step():
            if not self.solver_running: return
            try:
                visited_batch = next(solver_gen)
                self.visited.update(visited_batch)
                for (x, y) in visited_batch:
                    if (x, y) != start_node and (x, y) != goal_node:
                        self.draw_cell(x, y, COLOR_FLOOD_FILL)
                duration = (time.perf_counter() - start_time) * 1000
                self.status_label.config(text=f"{name}: {len(self.visited)}マスを探索中... ({duration:.0f} ms)")
                self.master.after(FLOOD_FILL_DELAY, animation_step)
            except StopIteration as e:
                path, visited_nodes = e.value
                self.path = path or []; self.visited.update(visited_nodes); self.draw_maze()
                duration = (time.perf_counter() - start_time) * 1000
                result_text = f"{name}: {len(self.visited)}マスを探索, {duration:.2f} ms"
                if not path: result_text += " (解なし)"
                self.status_label.config(text=result_text)
                self.solver_running = False; self.set_buttons_state("normal")
        animation_step()

    def animate_paintbrush_solver(self, algorithm_generator, name):
        solver_gen = algorithm_generator(); start_time = time.perf_counter()
        def animation_step():
            if not self.solver_running: return
            try:
                event = next(solver_gen)
                self.temp_visual_state['current_pos'] = event.get('current_pos')
                self.temp_visual_state['candidate'] = event.get('candidate')
                self.temp_visual_state['temp_block'] = event.get('temp_block')
                
                if 'path' in event:
                    self.path = event['path']

                if event['type'] == 'flood_fill':
                    self.visited.update(event['cells'])
                elif event['type'] == 'reject':
                    self.rejected_branches.update(event['branch'])
                elif event['type'] == 'accept':
                    pass
                self.draw_maze()
                duration = (time.perf_counter() - start_time) * 1000
                self.status_label.config(text=f"{name}: {len(self.path)}/{len(self.visited)}マス {event['type']}")
                delay = FLOOD_FILL_DELAY if event['type'] == 'flood_fill' else MOVE_DELAY
                self.master.after(delay, animation_step)
            except StopIteration as e:
                path, visited, rejected = e.value
                self.path = path or []; self.visited = visited; self.rejected_branches = rejected
                self.temp_visual_state = {}; self.draw_maze()
                duration = (time.perf_counter() - start_time) * 1000
                result_text = f"{name}: {len(self.visited)}マスを探索, {duration:.2f} ms"
                if not path: result_text += " (解なし)"
                self.status_label.config(text=result_text)
                self.solver_running = False; self.set_buttons_state("normal")
        animation_step()

    def _get_neighbors(self, x, y):
        neighbors = [];
        for dx, dy in self.directions:
            nx, ny = x + dx, y + dy
            if 0 <= nx < MAZE_WIDTH and 0 <= ny < MAZE_HEIGHT and self.maze[ny][nx] == 0: neighbors.append((nx, ny))
        return neighbors

    def _heuristic(self, a, b): return abs(a[0] - b[0]) + abs(a[1] - b[1])
    def _run_generator_to_end(self, gen):
        path, visited = None, set()
        try:
            while True: visited.update(next(gen))
        except StopIteration as e: path, final_visited = e.value; visited.update(final_visited)
        return path, visited

    # --- Paintbrush ---
    def _flood_fill_reachable(self, start_node, goal_node, blocked_edge):
        queue = collections.deque([start_node]); visited = {start_node}
        while queue:
            pos = queue.popleft()
            if pos == goal_node: return True, visited
            for neighbor in self._get_neighbors(*pos):
                if frozenset({pos, neighbor}) == blocked_edge: continue
                if neighbor not in visited: visited.add(neighbor); queue.append(neighbor)
        return False, visited
    def _flood_fill_animated(self, start_node, goal_node, blocked_edge):
        queue = collections.deque([start_node]); visited = {start_node}
        yield visited
        while queue:
            pos = queue.popleft()
            if pos == goal_node: return True, visited
            batch = set()
            for neighbor in self._get_neighbors(*pos):
                if frozenset({pos, neighbor}) == blocked_edge: continue
                if neighbor not in visited: visited.add(neighbor); batch.add(neighbor)
            if batch: yield batch
        return False, visited
    def _paintbrush_instant(self):
        start_node, goal_node = (self.start_pos['x'], self.start_pos['y']), (self.goal_pos['x'], self.goal_pos['y'])
        is_solvable, _ = self._flood_fill_reachable(start_node, goal_node, None)
        if not is_solvable: return None, set(), set()
        current_pos = start_node; path = [current_pos]; rejected_branches = set(); visited_overall = {current_pos}
        max_steps, step = MAZE_WIDTH * MAZE_HEIGHT, 0
        while current_pos != goal_node and step < max_steps:
            step += 1
            neighbors = [n for n in self._get_neighbors(*current_pos) if tuple(n) not in path]
            neighbors.sort(key=lambda n: self._heuristic(n, goal_node))
            if not neighbors: return None, visited_overall, rejected_branches
            chosen_neighbor = None
            for candidate in neighbors:
                is_reachable, _ = self._flood_fill_reachable(current_pos, goal_node, frozenset({current_pos, candidate}))
                if is_reachable: rejected_branches.add(candidate); continue
                else: chosen_neighbor = candidate; break
            if not chosen_neighbor: chosen_neighbor = neighbors[0]
            current_pos = chosen_neighbor; path.append(current_pos); visited_overall.add(current_pos)
        return path, visited_overall, rejected_branches
    def _paintbrush_animated(self):
        start_node, goal_node = (self.start_pos['x'], self.start_pos['y']), (self.goal_pos['x'], self.goal_pos['y'])
        is_solvable, _ = self._flood_fill_reachable(start_node, goal_node, None)
        if not is_solvable: return None, set(), set()
        current_pos = start_node; path = [current_pos]; rejected_branches = set(); visited_overall = {current_pos}
        max_steps, step = MAZE_WIDTH * MAZE_HEIGHT, 0
        while current_pos != goal_node and step < max_steps:
            step += 1; yield {'type': 'step', 'current_pos': current_pos, 'path': path}
            neighbors = [n for n in self._get_neighbors(*current_pos) if tuple(n) not in path]
            neighbors.sort(key=lambda n: self._heuristic(n, goal_node))
            if not neighbors: return None, visited_overall, rejected_branches
            chosen_neighbor = None
            for candidate in neighbors:
                blocked_edge = frozenset({current_pos, candidate})
                yield {'type': 'test_candidate', 'candidate': candidate, 'temp_block': blocked_edge}
                is_reachable, ff_visited = self._flood_fill_reachable(current_pos, goal_node, blocked_edge)
                yield {'type': 'flood_fill', 'cells': ff_visited}
                visited_overall.update(ff_visited)
                if is_reachable:
                    rejected_branches.add(candidate); yield {'type': 'reject', 'branch': {candidate}}
                    continue
                else:
                    chosen_neighbor = candidate; yield {'type': 'accept', 'branch': {candidate}}; break
            if not chosen_neighbor: chosen_neighbor = neighbors[0]
            current_pos = chosen_neighbor; path.append(current_pos)
        return path, visited_overall, rejected_branches

    # --- Other Solvers ---
    def _wall_follower_animated(self, left_hand=False):
        start_node, goal_node = self.start_pos.copy(), self.goal_pos.copy(); pos, d = (start_node['x'], start_node['y']), 2
        path, visited = [pos], {pos}; max_steps, step = MAZE_WIDTH * MAZE_HEIGHT * 2, 0; yield {pos}
        while pos != (goal_node['x'], goal_node['y']) and step < max_steps:
            step += 1; order = [1, 0, -1, 2] if not left_hand else [-1, 0, 1, 2]; moved = False
            for turn in order:
                check_dir = (d + turn + 4) % 4; dx, dy = self.directions[check_dir]; next_pos = (pos[0] + dx, pos[1] + dy)
                if self.maze[next_pos[1]][next_pos[0]] == 0:
                    d, pos = check_dir, next_pos; path.append(pos); visited.add(pos); yield {pos}; moved = True; break
            if not moved: break
        return path if pos == (goal_node['x'], goal_node['y']) else None, visited
    def _right_hand_animated(self): return self._wall_follower_animated(left_hand=False)
    def _left_hand_animated(self): return self._wall_follower_animated(left_hand=True)
    def _right_hand_instant(self): return self._run_generator_to_end(self._right_hand_animated())
    def _left_hand_instant(self): return self._run_generator_to_end(self._left_hand_animated())
    def _bfs_instant(self):
        start, goal = (self.start_pos['x'], self.start_pos['y']), (self.goal_pos['x'], self.goal_pos['y'])
        q = collections.deque([start])
        v = {start}
        parent_map = {start: None}
        while q:
            pos = q.popleft()
            if pos == goal:
                path = []
                curr = goal
                while curr is not None:
                    path.append(curr)
                    curr = parent_map[curr]
                return path[::-1], v
            for n in self._get_neighbors(*pos):
                if n not in v:
                    v.add(n)
                    parent_map[n] = pos
                    q.append(n)
        return None, v
    def _bfs_animated(self):
        start, goal = (self.start_pos['x'], self.start_pos['y']), (self.goal_pos['x'], self.goal_pos['y'])
        q = collections.deque([(start, [start])]); v = {start}; yield {start}
        while q:
            (pos, path) = q.popleft()
            if pos == goal: return path, v
            for n in self._get_neighbors(*pos):
                if n not in v: v.add(n); yield {n}; q.append((n, path + [n]))
        return None, v
    def _dfs_instant(self):
        start, goal = (self.start_pos['x'], self.start_pos['y']), (self.goal_pos['x'], self.goal_pos['y'])
        s = [start]
        v = {start}
        parent_map = {start: None}
        while s:
            pos = s.pop()
            if pos == goal:
                path = []
                curr = goal
                while curr is not None:
                    path.append(curr)
                    curr = parent_map[curr]
                return path[::-1], v
            for n in self._get_neighbors(*pos):
                if n not in v:
                    v.add(n)
                    parent_map[n] = pos
                    s.append(n)
        return None, v
    def _dfs_animated(self):
        start, goal = (self.start_pos['x'], self.start_pos['y']), (self.goal_pos['x'], self.goal_pos['y'])
        s = [(start, [start])]; v = set()
        while s:
            (pos, path) = s.pop()
            if pos in v: continue
            v.add(pos); yield {pos}
            if pos == goal: return path, v
            for n in self._get_neighbors(*pos):
                if n not in v: s.append((n, path + [n]))
        return None, v

    def _astar_instant(self):
        start, goal = (self.start_pos['x'], self.start_pos['y']), (self.goal_pos['x'], self.goal_pos['y'])
        pq = [(0, start)]
        v = {start}
        parent_map = {start: None}
        g = {start: 0}
        while pq:
            _, pos = heapq.heappop(pq)
            if pos == goal:
                path = []
                curr = goal
                while curr is not None:
                    path.append(curr)
                    curr = parent_map[curr]
                return path[::-1], v
            for n in self._get_neighbors(*pos):
                new_g = g[pos] + 1
                if n not in g or new_g < g[n]:
                    g[n] = new_g
                    priority = new_g + self._heuristic(n, goal)
                    heapq.heappush(pq, (priority, n))
                    parent_map[n] = pos
                    v.add(n)
        return None, v
    def _astar_animated(self):
        start, goal = (self.start_pos['x'], self.start_pos['y']), (self.goal_pos['x'], self.goal_pos['y'])
        pq = [(0, start, [start])]; v = {start}; g = {start: 0}; yield {start}
        while pq:
            _, pos, path = heapq.heappop(pq)
            yield {pos}
            if pos == goal: return path, v
            for n in self._get_neighbors(*pos):
                new_g = g[pos] + 1
                if n not in g or new_g < g[n]:
                    g[n] = new_g; v.add(n); yield {n}
                    heapq.heappush(pq, (new_g + self._heuristic(n, goal), n, path + [n]))
        return None, v

    def draw_cell(self, x, y, color, outline=None):
        self.canvas.itemconfig(self.cell_rects[y][x], fill=color, outline=outline or color)

    def draw_maze(self):
        for item in self.temp_drawings:
            self.canvas.delete(item)
        self.temp_drawings = []

        start_node = (self.start_pos['x'], self.start_pos['y'])
        goal_node = (self.goal_pos['x'], self.goal_pos['y'])
        current = self.temp_visual_state.get('current_pos') or (self.player_pos['x'], self.player_pos['y'])
        candidate = self.temp_visual_state.get('candidate')
        final_path_mode = self.temp_visual_state.get('final')

        for y in range(MAZE_HEIGHT):
            for x in range(MAZE_WIDTH):
                pos = (x, y)
                color = COLOR_PATH
                
                if pos in self.rejected_branches:
                    color = COLOR_REJECTED_BRANCH
                elif pos in self.visited:
                    color = COLOR_FLOOD_FILL

                if self.maze[y][x] == 1:
                    color = COLOR_WALL

                if final_path_mode and pos in self.path:
                    color = COLOR_FINAL_SOLUTION
                elif pos in self.path:
                    color = COLOR_CONFIRMED_PATH

                if pos == candidate:
                    color = COLOR_CANDIDATE
                
                if pos == current:
                    color = COLOR_CURRENT_PLAYER
                
                if pos == start_node:
                    color = COLOR_START
                
                if pos == goal_node:
                    color = COLOR_GOAL

                self.draw_cell(x, y, color)

        if self.temp_visual_state.get('temp_block'):
            p1, p2 = self.temp_visual_state['temp_block']
            line_id = self.canvas.create_line(p1[0]*CELL_SIZE+CELL_SIZE//2, p1[1]*CELL_SIZE+CELL_SIZE//2, 
                                    p2[0]*CELL_SIZE+CELL_SIZE//2, p2[1]*CELL_SIZE+CELL_SIZE//2, 
                                    fill=COLOR_TEMP_BLOCK, width=3)
            self.temp_drawings.append(line_id)

    def on_key_press(self, event):
        if self.solver_running: return
        dx, dy = 0, 0
        if event.keysym == "Up": dy = -1
        elif event.keysym == "Down": dy = 1
        elif event.keysym == "Left": dx = -1
        elif event.keysym == "Right": dx = 1
        if dx != 0 or dy != 0: self.move_player(dx, dy)

    def move_player(self, dx, dy):
        self.reset_visualization()
        next_x, next_y = self.player_pos["x"] + dx, self.player_pos["y"] + dy
        if 0 <= next_x < MAZE_WIDTH and 0 <= next_y < MAZE_HEIGHT and self.maze[next_y][next_x] == 0:
            self.player_pos["x"], self.player_pos["y"] = next_x, next_y
            self.draw_maze()
            if self.player_pos["x"] == self.goal_pos["x"] and self.player_pos["y"] == self.goal_pos["y"]:
                 messagebox.showinfo("ゴール！", "おめでとうございます！ゴールしました！")

if __name__ == "__main__":
    root = tk.Tk()
    game = MazeGame(root)
    root.mainloop()