# Taskbench: working rules for Claude Code

Full spec: TASKBENCH_SPEC.md

- **Extension, not a fork.** Use only public VS Code extension APIs.
- **One milestone at a time** (C §7). Each milestone is finished only when its acceptance checks (C §8) pass, or when you've written down why one can't be checked yet.
- **Branches and commits.** Work on a branch named `m<N>-<slug>` per milestone, make small commits with clear messages, and push. At the end of each milestone, open a PR with `gh pr create` that describes what was built, how to test it, and what's left. Don't merge PRs; the developer merges them.
- **Ask before anything irreversible.** That includes deleting worktrees or branches outside the test fixtures, force-pushing, and changing repo visibility.
- **Code style.** TypeScript in strict mode, no `any` without a comment explaining it. Keep the git, analysis and UI layers in separate modules (e.g. `src/git/`, `src/analysis/`, `src/ui/`, `src/agent/`).
- **Webviews.** Put the React and Cytoscape code in `webview/`, bundle it with esbuild, set a strict Content-Security-Policy, and use message passing only.
- **Tests.** Use `@vscode/test-electron` plus a fixture repo created by a script in `test/fixtures/`, with known diffs, a planted private import, an upward import and a cycle. Add the tests a milestone needs as you go.
- **Status.** After each milestone, tick it in the README's Status list and write a short summary for the developer: what to try and what you're unsure about.
- **Verify APIs.** If a VS Code API in the spec doesn't exist or behaves differently in the installed version (for example `vscode.changes`), check the real API, use the closest working approach, and note the change in the PR.

## Running the tests

`npm test` (or `xvfb-run -a npm test` without a display) builds the fixture repo and runs the integration
tests in a downloaded VS Code. See the README's Test section for the environment variables.

If the VS Code download host is blocked (as in Claude Code cloud containers), get VS Code from Microsoft's apt
repository instead, which package-manager network rules usually allow:

```bash
curl -sS https://packages.microsoft.com/repos/code/dists/stable/main/binary-amd64/Packages.gz | gunzip | grep '^Filename: .*code_1\.95\.'
curl -sSO https://packages.microsoft.com/repos/code/<Filename from above>
dpkg-deb -x code_*.deb .vscode-test/deb-1.95.3
TASKBENCH_VSCODE_PATH=$PWD/.vscode-test/deb-1.95.3/usr/share/code/code xvfb-run -a npm test
```

Test against both the minimum supported version (1.95, from `engines.vscode`) and the latest stable.
Keep mocha on v11: v12 is ESM-only and VS Code 1.95's extension host can't load it.
