# Maze Solver

迷路を生成し、Paintbrush / 右手法 / 左手法 / BFS / DFS / A* で解く様子を可視化する静的 Web アプリです。元の `maze_game.py` は Tkinter 版として残し、GitHub Pages で公開できるようにブラウザ版を追加しています。

## リンク

- 公開ページ: https://ry32767.github.io/AAAA/
- GitHub リポジトリ: https://github.com/ry32767/AAAA

## 使い方

`index.html` をブラウザで開くと動作します。ビルドや依存関係のインストールは不要です。

## 公開

GitHub Pages は `.github/workflows/pages.yml` からデプロイします。

```powershell
git init
git add .
git commit -m "Add GitHub Pages maze solver"
$Owner = gh api user -q ".login"
gh repo create "$Owner/AAAA" --public --source=. --remote=origin --push
gh api --method POST "repos/$Owner/AAAA/pages" -f build_type=workflow
```

Pages の公開 URL は通常 `https://<user>.github.io/AAAA/` です。

## ファイル

- `index.html`: GitHub Pages 用エントリ
- `styles.css`: 画面スタイル
- `app.js`: 迷路生成と解法アルゴリズム
- `maze_game.py`: 元の Tkinter 版
