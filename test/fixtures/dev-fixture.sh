#!/usr/bin/env bash
# Creates .vscode-test/fixture-repo for trying the extension by hand
# (the "Run Extension on Fixture Repo" launch config). An existing fixture is kept, along with
# the tasks you created in it; pass --reset to delete it and its task worktrees and start over.
set -euo pipefail
cd "$(dirname "$0")/../.."

repo=.vscode-test/fixture-repo
if [ "${1:-}" = "--reset" ]; then
  rm -rf "$repo" "$repo.tasks"
fi
if [ ! -d "$repo" ]; then
  bash test/fixtures/create-fixture.sh "$repo"
  echo "Created $repo"
fi
