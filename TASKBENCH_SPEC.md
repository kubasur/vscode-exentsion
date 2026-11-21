# CLAUDE CODE: build "Taskbench" from zero

You are Claude Code running on the developer's machine. This one file holds everything: setup steps, working rules, and the full product spec (Part C). Work through it in order. Don't ask questions you can answer from this file. Only stop and ask when a step needs the developer: signing in to GitHub, approving something irreversible, or answering one of the open questions in C §9 once you reach M4.

---

## Part A: Bootstrap (do this first, in order)

1. **Check the tools.** Run `node --version` (needs ≥ 20), `npm --version`, `git --version` and `gh --version`. If any is missing, tell the developer exactly what to install and stop.
2. **Check GitHub auth.** Run `gh auth status`. If it isn't logged in, ask the developer to run `gh auth login` themselves, then continue.
3. **Create the project folder** `taskbench/` in the current directory (or use the current directory if it's empty), and `cd` into it.
4. **Save this file into the project** as `TASKBENCH_SPEC.md`, so the spec lives in the repo and future sessions can read it.
5. **Scaffold a TypeScript VS Code extension by hand.** Don't use the interactive `yo code` generator. Create:
   - `package.json` with name `taskbench`, displayName `Taskbench`, `"private": true`, `engines.vscode` `^1.95.0`, `main` `./out/extension.js`, scripts `compile` (`tsc -p ./`), `watch` (`tsc -watch -p ./`) and `package` (`vsce package`), and devDependencies `typescript`, `@types/vscode` (matching engines), `@types/node` and `@vscode/vsce`. Add one command for now: `taskbench.hello`, titled "Taskbench: Hello".
   - `tsconfig.json`: commonjs, ES2022, `rootDir` `src`, `outDir` `out`, strict, sourceMap.
   - `src/extension.ts`, which registers `taskbench.hello` and shows an info message.
   - `.vscode/launch.json` (an extensionHost "Run Extension" config with `preLaunchTask` `npm: compile`) and `.vscode/tasks.json` (the npm compile task with the `$tsc` problem matcher).
   - `.gitignore`: `node_modules/`, `out/`, `*.vsix`, `.vscode-test/`, `.task/`.
   - `.vscodeignore`: `src/**`, `.vscode/**`, `tsconfig.json`, `TASKBENCH_SPEC.md`.
   - `README.md` with a one-paragraph description, "Develop" instructions (`npm install`, `npm run compile`, F5), "Install locally" (`npm run package`, then Extensions: Install from VSIX…), and a **Status** checklist M1–M6.
   - `CLAUDE.md` with the working rules from Part B, plus a pointer: "Full spec: TASKBENCH_SPEC.md".
   - `AGENTS.md` with the same rules, for Codex or other agents.
6. **Install and build.** Run `npm install` and then `npm run compile`. Fix any errors until it builds cleanly.
7. **Create the git repository and push it.**
   ```bash
   git init -b main
   git add -A
   git commit -m "Initial scaffold and spec"
   gh repo create taskbench --private --source=. --push
   ```
   If the name `taskbench` is already taken on the developer's account, ask for another one. Never make the repo public.
8. **Tell the developer to test it.** They open the folder in VS Code, press F5, and run "Taskbench: Hello" in the new window. Then continue straight to M1.

## Part B: Working rules (also copy these into CLAUDE.md and AGENTS.md)

- **Extension, not a fork.** Use only public VS Code extension APIs.
- **One milestone at a time** (C §7). Each milestone is finished only when its acceptance checks (C §8) pass, or when you've written down why one can't be checked yet.
- **Branches and commits.** Work on a branch named `m<N>-<slug>` per milestone, make small commits with clear messages, and push. At the end of each milestone, open a PR with `gh pr create` that describes what was built, how to test it, and what's left. Don't merge PRs; the developer merges them.
- **Ask before anything irreversible.** That includes deleting worktrees or branches outside the test fixtures, force-pushing, and changing repo visibility.
- **Code style.** TypeScript in strict mode, no `any` without a comment explaining it. Keep the git, analysis and UI layers in separate modules (e.g. `src/git/`, `src/analysis/`, `src/ui/`, `src/agent/`).
- **Webviews.** Put the React and Cytoscape code in `webview/`, bundle it with esbuild, set a strict Content-Security-Policy, and use message passing only.
- **Tests.** Use `@vscode/test-electron` plus a fixture repo created by a script in `test/fixtures/`, with known diffs, a planted private import, an upward import and a cycle. Add the tests a milestone needs as you go.
- **Status.** After each milestone, tick it in the README's Status list and write a short summary for the developer: what to try and what you're unsure about.
- **Verify APIs.** If a VS Code API in the spec doesn't exist or behaves differently in the installed version (for example `vscode.changes`), check the real API, use the closest working approach, and note the change in the PR.

## Part C: Product spec


> Implementation brief for a coding agent. Build this as a **VS Code extension** (TypeScript), not a fork of VS Code. Section 10 explains why.

### 1. Goal

The developer hands work to an AI coding agent (Codex CLI, running against a custom model endpoint) and then reviews what it did. AI is usually good at the code inside a function and bad at structure: it breaks encapsulation, imports in the wrong direction, creates cycles and duplicates helpers. The extension should make reviewing a change, and especially its structure, fast and visual.

There are two kinds of work:

| | **Task** (ticket) | **Exploration** |
|---|---|---|
| Starts from | A defined change: title, description, acceptance criteria | A question ("how does auth flow?", "what would it take to swap the DB layer?") |
| Agent mostly | Writes code | Reads code |
| Output | A branch, a diff and a PR description | An answer, notes, code references and an optional throwaway prototype |
| Lives in | Its own git worktree and branch | Its own worktree; changes are disposable |

### 2. Core concepts and storage

- Each Task or Exploration has a **git worktree** (e.g. `../<repo>.tasks/<id>`) and a branch (`task/<id>-<slug>` or `explore/<id>-<slug>`).
- Metadata and texts are plain files inside the worktree:
  ```
  .task/
    task.json          # id, kind ("task"|"exploration"), title, baseBranch, createdAt, status
    description.md     # PR description: short, written for reviewers (other people)
    notes.md           # developer notes: decisions, gotchas, open questions; private
    review.json        # review state: viewed files, findings marked "intended", etc.
  ```
- Add `.task/` to `.git/info/exclude` in each worktree so nothing in it is ever committed.
- Explorations use `.task/answer.md` instead of `description.md`.
- **Base for every diff = the merge-base** (`git merge-base <baseBranch> HEAD`), the same "three-dot" semantics as a GitHub PR. Recompute it whenever HEAD or the base branch moves.

### 3. UI overview

#### 3.1 Sidebar (Activity Bar view container "Taskbench")
- A tree with two groups, **Tasks** and **Explorations**. Each item shows title, status, number of changed files and number of structural findings.
- Commands: `New Task`, `New Exploration`, `Open`, `Archive` (removes the worktree after confirming), `Start/Resume Agent`.
- Under an expanded task: its changed files (A/M/D/R status) against the merge-base. Clicking a file opens its diff.

#### 3.2 Task page (Webview panel), with tabs like a GitHub PR
1. **Description**: Renders `.task/description.md` and is editable. "Publish PR" runs `gh pr create --body-file .task/description.md`, or `gh pr edit` if the PR exists.
2. **Notes**: Renders `.task/notes.md`, which the agent appends to as it works. Editable by hand.
3. **Files changed**: The file list, plus "Review all", which opens VS Code's built-in **multi-file diff editor** with every changed file against the merge-base. Per-file "Viewed" checkboxes are stored in `review.json`. A "changed since you viewed" marker appears when the agent edits a file you already marked viewed.
4. **Structure**: The findings list (§5.4) and entry points into the graph views (§5).

A file watcher on `.task/` and the worktree refreshes the page live while the agent works.

#### 3.3 View mode toggle: Code / Diff / Graph
A status bar item and editor title buttons switch the mode for the active task:
- **Code**: The normal editor, but the **gutter change markers compare against the merge-base**, not HEAD, so you see everything the task changed. Implement with `vscode.scm.createSourceControl` plus a `quickDiffProvider` that returns a `taskbase:` URI.
- **Diff**: Opening any file in the task opens its diff against the merge-base.
- **Graph**: Opens the structure graph panel (§5) focused on the current file or function.

#### 3.4 Implementation notes for diffs
- Register a `TextDocumentContentProvider` for the scheme `taskbase:` that serves `git show <mergeBase>:<path>`, returning empty for added files.
- Single diff: `vscode.diff(baseUri, workingUri, title)`.
- Multi diff: `vscode.changes` with `title` and a list of `[resourceUri, originalUri, modifiedUri]`. Check the exact signature against the current VS Code API, and fall back to a list of `vscode.diff` calls if it's unavailable.
- Use the built-in Git extension API (`vscode.extensions.getExtension('vscode.git').exports.getAPI(1)`) where it helps. Shelling out to `git` is fine for merge-base, diff name-status and worktrees.

### 4. Agent integration

- Agent: **Codex CLI**, configured with a custom provider in `~/.codex/config.toml` (`model_providers.<id>` with `base_url`, `env_key` and `wire_api`). The extension must not store tokens. It only reads the env var name from settings.
- v1: "Start Agent" opens an integrated terminal in the task's worktree and runs `codex` with an initial prompt built from `task.json` and `description.md`. A later version can use non-interactive `codex exec` (check flags with `codex exec --help`) and stream its output into the task page.
- Write an `AGENTS.md` into each worktree (or append a section to the repo's own) that tells the agent to:
  - Keep `.task/description.md` short and reviewer-facing: what changed and why, how to test.
  - Append to `.task/notes.md` after each meaningful step: what it changed, why, alternatives rejected, and anything uncertain or risky.
  - Respect the architecture rules in `.taskbench/rules.json` (§5.3): no imports into private modules or functions of other modules, no upward imports, no new cycles. Reuse existing helpers before writing new ones.
  - For Explorations: write findings to `.task/answer.md` with file and line references, and don't modify production code unless asked.
- Settings: `taskbench.agentCommand` (default `codex`), `taskbench.worktreeRoot`, `taskbench.baseBranch` (default: the repo's default branch).

### 5. Structure views (the main differentiator)

Purpose: make structural slop visible at a glance. **Every view is scoped to the PR by default**: the functions and modules the diff touches plus 1–2 hops. It also distinguishes **existing** edges (grey) from edges **added by this PR** (blue), and edges that **break a rule** (red dashed, plus a text label so colour isn't the only signal). Cycles are amber dashed.

A design mockup of all four views exists. Match its layout and colour logic.

#### 5.1 Call graph
- Nodes are functions and methods, grouped into **one column or cluster per module**. Edges are calls.
- Data: VS Code's language-server-backed commands `vscode.prepareCallHierarchy`, `vscode.provideOutgoingCalls` and `vscode.provideIncomingCalls`, starting from every function whose range overlaps a diff hunk. Use `vscode.executeDocumentSymbolProvider` to map hunks to functions.
- "Added by this PR" = the edge exists on HEAD but not at the merge-base. Compute the base graph by running the same analysis on a temporary checkout of the merge-base (a second worktree, cached per merge-base SHA), or with a static parser (§5.2) if the language server is too slow.
- Hover a node to get `vscode.executeHoverProvider`: signature, arguments and docstring, plus "added/modified in this PR", caller count and test count where cheap.
- Click a node to jump to its definition. A "Before / after" toggle fades out unchanged edges.
- Known limitation: the language server misses dynamic calls (common in Python and JS). Label the graph "static approximation".

#### 5.2 Import / dependency graph
- Nodes are modules (files or packages, with a collapsible granularity). Edges are imports.
- Laid out in **architecture layers** from `rules.json` (e.g. api → domain → infra), top to bottom. Imports should point down.
- Data: language servers don't expose imports in a standard way, so parse them yourself. Use **tree-sitter** (web-tree-sitter, WASM) behind a `LanguageAdapter` interface. Optional adapters can call existing tools: `dependency-cruiser` (JS/TS) and `grimp` / `import-linter` (Python).

#### 5.3 Rules (`.taskbench/rules.json`, committed to the repo)
```json
{
  "layers": [["api"], ["orders", "billing"], ["infra", "db"]],
  "privatePatterns": { "python": ["^_"], "typescript": ["@internal", "notExported"] },
  "allowed": [{ "from": "billing/**", "to": "billing/_*" }],
  "forbidden": [{ "from": "api/**", "to": "**/repo*", "reason": "handlers go through services" }]
}
```
Rule kinds to detect:
- **Encapsulation break**: A call or import into a private symbol or module that belongs to a *different* module.
- **Upward dependency**: An edge from a lower layer to a higher one.
- **Layer skip / forbidden edge**: Anything that matches `forbidden`.
- **New cycle**: A strongly connected component that didn't exist at the merge-base.

#### 5.4 Findings ("Structure" tab)
Each finding has a category, a severity, a one-line title, a location (`a.b.func → c._d`), a suggested fix, and buttons:
- **Show in graph**: Opens the graph focused on that edge.
- **Ask agent to fix**: Sends a prompt to the agent with the finding and the relevant rule.
- **Intended**: Suppresses the finding for this task. Store it in `review.json`, with an optional reason.

Finding types, beyond the rules above:
- **Likely duplicate**: A new function whose normalized AST or token sequence is very similar to an existing one. Start simple: same arity plus a high token-similarity threshold.
- **Complexity jump**: A function whose fan-out (distinct callees) or length grew sharply in this PR.
- **Untested new public function**: Optional, if test discovery is cheap.

#### 5.5 Dependency matrix
- A square matrix where the row imports the column, ordered by layer. Cells show import counts: blue if added by this PR, red for rule breaks (marked `P` private, `↑` upward), amber for cycles (`↻`). In a clean codebase everything sits above the diagonal.
- This is the scalable fallback for large repos, where the graph becomes unreadable.

#### 5.6 Rendering
- A webview built with React and **Cytoscape.js** (or React Flow) plus **ELK** for layered layout. Message passing to the extension host handles jump-to-code and hover data.
- Must stay usable at around 200 nodes: collapse modules into single nodes beyond a threshold, and show the matrix instead when a graph exceeds limits.

### 6. Explorations specifics
- The page tabs are **Question**, **Answer** (`answer.md`), **Notes**, and **Files** (any prototype diff, marked "throwaway").
- The Graph view is available too, scoped to the files the agent read or referenced. Log reads if the agent can report them; otherwise use files mentioned in `answer.md`.
- **Promote to Task** creates a Task with the exploration's answer as context.

### 7. Milestones
1. **M1, skeleton**: Sidebar tree, New Task (worktree + branch + `.task/` files + exclude), task page with Description and Notes tabs, live file watching.
2. **M2, review**: Merge-base diffing, changed-file tree, single and multi diff, the Code/Diff toggle, gutter quick diff against the merge-base, Viewed state.
3. **M3, agent**: Start/Resume Agent in a terminal, AGENTS.md generation, Publish PR via `gh`.
4. **M4, imports**: tree-sitter adapter for the first language, rules.json, import graph, matrix, rule findings.
5. **M5, calls**: Call graph through the call hierarchy API, hover docs, base-vs-head comparison, duplicate and complexity findings, Ask agent to fix.
6. **M6, explorations**: Exploration flow and Promote to Task.

### 8. Acceptance checks
- Creating a task produces a worktree, a branch and the `.task/` files, and `git status` stays clean of `.task/`.
- On a branch with known changes, "Review all" shows exactly the files `git diff --name-status $(git merge-base main HEAD)` lists.
- In Code mode, gutter markers match that diff, including committed changes.
- A test fixture repo with a planted private cross-module import, an upward import and a cycle produces exactly those three findings, each rendered as a red or amber edge.
- Agent edits to `notes.md` appear on the task page within about 1 s without a reload.

### 9. Open questions (ask the developer)
- First target language: Python or TypeScript? Default to building the tree-sitter adapter for **Python and TypeScript**.
- Ticket source: local only for v1, with GitHub Issues or Jira import later?
- Exact layer names for the developer's main repo, which seed `rules.json`.

### 10. Why an extension, not a fork
- Everything above uses public extension APIs: webviews, tree views, SCM quick diff, diff and multi-diff editors, the call hierarchy API, hover and terminals.
- A fork means merging upstream VS Code roughly monthly, building and signing your own binaries, and losing the official Marketplace (forks use Open VSX).
- If a hard limit appears later (for example, replacing the core editor layout), the extension code moves into a fork almost unchanged.

---

## Part D: First message to the developer when you finish bootstrap

Reply with:
1. The GitHub repo URL.
2. How to test it: open the folder in VS Code, press F5, then run "Taskbench: Hello".
3. That you're starting M1, plus any open question from C §9 that will block you later.
