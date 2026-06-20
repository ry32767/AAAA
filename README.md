# Maze Solver

迷路を生成し、Paintbrush / 右手法 / 左手法 / BFS / DFS / A* で解く様子を可視化する静的 Web アプリです。複数階層の迷路と階段移動に対応しています。元の `maze_game.py` は Tkinter 版として残し、GitHub Pages で公開できるようにブラウザ版を追加しています。

## リンク

- 公開ページ: https://ry32767.github.io/MazeCreator/
- GitHub リポジトリ: https://github.com/ry32767/MazeCreator

## 主な機能

- 多階層（最大5階）の迷路生成と、階段による階またぎ移動
- 6 種の解法アルゴリズム（Paintbrush / 右手法 / 左手法 / BFS / DFS / A*）のアニメーション可視化
- **シード指定**による再現可能な迷路生成（同一迷路でのアルゴリズム比較に）
- **ループ率（braiding）** で別解のある迷路を生成（壁伝い法と最短探索の差が見える）
- **全解法比較**: 経路長・探索セル数・所要時間・最短一致を一覧表で比較
- スクリーンリーダー向けの詳細アナウンス（aria-live）

## 使い方

`index.html` をブラウザで開くと動作します。ビルドや依存関係のインストールは不要です。

## テスト

迷路生成と解法アルゴリズムの単体テストは Node.js 標準のテストランナーで実行します（追加依存なし）。

```bash
npm test
```

## 公開

GitHub Pages は `.github/workflows/pages.yml` から `main` ブランチへの push 時にデプロイします。
公開 URL は `https://ry32767.github.io/MazeCreator/` です。

## ファイル

- `index.html`: GitHub Pages 用エントリ
- `styles.css`: 画面スタイル
- `app.js`: 迷路生成と解法アルゴリズム（ブラウザ／Node の両方で読み込み可能）
- `test/maze.test.js`: 迷路生成と解法の単体テスト
- `maze_game.py`: 元の Tkinter 版
