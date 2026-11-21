# Taskbench

Taskbench is a VS Code extension for handing work to an AI coding agent (Codex CLI) and reviewing what it did. Each Task or Exploration gets its own git worktree and branch, with its PR description and the agent's notes kept beside the code. Every diff is computed against the merge-base, like a GitHub PR, and structure views (import graph, call graph and dependency matrix) make encapsulation breaks, upward imports and new cycles visible at a glance. The full product spec is in `TASKBENCH_SPEC.md` in this folder.

## Develop

```bash
npm install
npm run compile
```

Then open this folder in VS Code, pick a launch configuration in the Run and Debug view, and press **F5**:

- **Run Extension on Fixture Repo** (easiest): creates a small sample repository in `.vscode-test/fixture-repo` (kept between runs; `npm run fixture:reset` starts it over) and opens it in the Extension Development Host.
- **Run Extension**: opens an empty window; open any git repository in it.

`npm run watch` recompiles the extension on save, and `npm run watch:webview` rebuilds the task page.

### Try it

1. Click the **Taskbench** icon in the Activity Bar.
2. Click **New Task** (or `+` in the view's title bar), enter a title and an optional summary.
   Taskbench creates a branch `task/<id>-<slug>` and a worktree in `../<repo>.tasks/<id>-<slug>`, with a `.task/` folder that git ignores.
3. The task page opens with **Description** (the PR description) and **Notes** tabs. Edit them on the page, or click **Open in Editor**.
4. Edit `.task/notes.md` in the worktree from anywhere (a terminal, another editor or an agent). The page updates within a second.
5. Right-click a task to open its worktree in a new window, or to **Archive** it. Archiving removes the worktree, keeps the branch, and saves a copy of `.task/` in `../<repo>.tasks/.archived/`.

Settings: `taskbench.worktreeRoot` (where worktrees go) and `taskbench.baseBranch` (default: the repository's default branch).

## Test

```bash
npm test
```

This compiles everything, builds a fixture repository from `test/fixtures/create-fixture.sh` in a temp folder, downloads VS Code, and runs the integration tests in it. On a Linux machine without a display, run `xvfb-run -a npm test`.

- `TASKBENCH_VSCODE_VERSION=1.95.3 npm test` tests against a specific VS Code version.
- `TASKBENCH_VSCODE_PATH=/path/to/code npm test` uses a VS Code you already have instead of downloading one.
- `TASKBENCH_KEEP_FIXTURE=1 npm test` keeps the temp fixture folder for debugging.

## Install locally

```bash
npm run package
```

This builds `taskbench-<version>.vsix`. In VS Code, run **Extensions: Install from VSIX…** and pick that file.

## Layout

| Path | What's there |
|---|---|
| `src/git/` | Thin wrappers around the `git` CLI: worktrees, branches, merge-base, diffs |
| `src/tasks/` | The task model and `TaskStore` (create, list, archive, read and write `.task/` files). No `vscode` imports |
| `src/ui/` | Sidebar tree, commands, and the task page's extension side |
| `src/shared/` | Message types shared by the extension and the webviews |
| `webview/` | React webview apps, bundled by `esbuild.mjs` into `out/webview/` |
| `test/fixtures/` | Scripts that build the fixture repository |
| `src/test/` | Integration tests (`@vscode/test-electron` + mocha) |

## Status

- [x] M1: Skeleton (sidebar tree, New Task with worktree, branch and `.task/` files, task page with Description and Notes tabs, live file watching)
- [ ] M2: Review (merge-base diffing, changed-file tree, single and multi diff, Code/Diff toggle, gutter quick diff, Viewed state)
- [ ] M3: Agent (Start/Resume Agent in a terminal, AGENTS.md generation, Publish PR via `gh`)
- [ ] M4: Imports (tree-sitter adapter, `rules.json`, import graph, matrix, rule findings)
- [ ] M5: Calls (call graph, hover docs, base-vs-head comparison, duplicate and complexity findings, Ask agent to fix)
- [ ] M6: Explorations (Exploration flow, Promote to Task)
