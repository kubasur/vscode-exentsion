# Taskbench

Taskbench is a VS Code extension for handing work to an AI coding agent (Codex CLI) and reviewing what it did. Each Task or Exploration gets its own git worktree and branch, with its PR description and the agent's notes kept beside the code. Every diff is computed against the merge-base, like a GitHub PR, and structure views (import graph, call graph and dependency matrix) make encapsulation breaks, upward imports and new cycles visible at a glance. The full product spec is in `TASKBENCH_SPEC.md` in this folder.

> For now this extension lives in the `taskbench/` folder of the `cov-form` repository. Open **this folder** (not the repository root) in VS Code, and run every command below from it.

## Develop

```bash
npm install
npm run compile
```

Then open this folder in VS Code and press **F5** ("Run Extension"). In the new Extension Development Host window, open the Command Palette and run **Taskbench: Hello**.

`npm run watch` recompiles on every save.

## Install locally

```bash
npm run package
```

This builds `taskbench-<version>.vsix`. In VS Code, run **Extensions: Install from VSIX…** and pick that file.

## Status

- [ ] M1: Skeleton (sidebar tree, New Task with worktree, branch and `.task/` files, task page with Description and Notes tabs, live file watching)
- [ ] M2: Review (merge-base diffing, changed-file tree, single and multi diff, Code/Diff toggle, gutter quick diff, Viewed state)
- [ ] M3: Agent (Start/Resume Agent in a terminal, AGENTS.md generation, Publish PR via `gh`)
- [ ] M4: Imports (tree-sitter adapter, `rules.json`, import graph, matrix, rule findings)
- [ ] M5: Calls (call graph, hover docs, base-vs-head comparison, duplicate and complexity findings, Ask agent to fix)
- [ ] M6: Explorations (Exploration flow, Promote to Task)
