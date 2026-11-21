import * as vscode from 'vscode';
import type { TaskbenchApi } from '../extension';
import { git } from '../git/exec';

export function fixtureRepo(): string {
  const repo = process.env.TASKBENCH_FIXTURE_REPO;
  if (!repo) {
    throw new Error('TASKBENCH_FIXTURE_REPO is not set. Run the tests with `npm test`.');
  }
  return repo;
}

export async function activateExtension(): Promise<TaskbenchApi> {
  const extension = vscode.extensions.getExtension<TaskbenchApi>('taskbench.taskbench');
  if (!extension) {
    throw new Error('Taskbench extension not found.');
  }
  const api = await extension.activate();
  await api.ready;
  return api;
}

/** Polls `check` until it returns a value other than undefined, or throws after `timeoutMs`. */
export async function waitFor<T>(
  description: string,
  check: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 10_000,
  intervalMs = 20,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${description}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** `git status --porcelain` including every untracked file; empty means clean. */
export async function porcelainStatus(cwd: string): Promise<string> {
  return (await git(cwd, ['status', '--porcelain', '--untracked-files=all'])).trim();
}
