import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { git, tryGit } from './exec';

export interface Worktree {
  path: string;
  head?: string;
  /** Short branch name, e.g. `task/3-add-login`. Undefined when detached or bare. */
  branch?: string;
  bare: boolean;
  prunable: boolean;
}

export type ChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U';

export interface FileChange {
  status: ChangeStatus;
  /** Path relative to the worktree root, using forward slashes. */
  path: string;
  /** Previous path for renames and copies. */
  oldPath?: string;
}

/**
 * Returns the root of the main working tree for the repository that contains `folder`,
 * even when `folder` is inside a linked worktree. Undefined if `folder` isn't in a git repo
 * or the repository is bare.
 */
export async function findMainRepo(folder: string): Promise<string | undefined> {
  const inside = await tryGit(folder, ['rev-parse', '--is-inside-work-tree']);
  if (inside?.trim() !== 'true') {
    return undefined;
  }
  const commonDir = (await git(folder, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
  if (path.basename(commonDir) === '.git') {
    return path.dirname(commonDir);
  }
  // A worktree whose common dir isn't named `.git` belongs to a bare repository.
  return undefined;
}

export async function refExists(repo: string, ref: string): Promise<boolean> {
  return (await tryGit(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) !== undefined;
}

export function branchExists(repo: string, branch: string): Promise<boolean> {
  return refExists(repo, `refs/heads/${branch}`);
}

/** Best guess at the repository's default branch name (e.g. `main`). */
export async function defaultBranch(repo: string): Promise<string> {
  const originHead = await tryGit(repo, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead?.trim().startsWith('origin/')) {
    return originHead.trim().slice('origin/'.length);
  }
  for (const candidate of ['main', 'master']) {
    if (await branchExists(repo, candidate)) {
      return candidate;
    }
  }
  const configured = (await tryGit(repo, ['config', '--get', 'init.defaultBranch']))?.trim();
  if (configured && (await branchExists(repo, configured))) {
    return configured;
  }
  const current = (await tryGit(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']))?.trim();
  if (current) {
    return current;
  }
  throw new Error('Could not determine the default branch. Set "taskbench.baseBranch" in settings.');
}

/** Resolves a branch name to a ref that exists: the local branch if present, else `origin/<branch>`. */
export async function resolveBranchRef(repo: string, branch: string): Promise<string> {
  if (await branchExists(repo, branch)) {
    return branch;
  }
  if (await refExists(repo, `refs/remotes/origin/${branch}`)) {
    return `origin/${branch}`;
  }
  if (await refExists(repo, branch)) {
    return branch;
  }
  throw new Error(`Base branch "${branch}" doesn't exist locally or on origin.`);
}

export async function listWorktrees(repo: string): Promise<Worktree[]> {
  const out = await git(repo, ['worktree', 'list', '--porcelain', '-z']);
  const worktrees: Worktree[] = [];
  let current: Worktree | undefined;
  for (const field of out.split('\0')) {
    if (field === '') {
      if (current) {
        worktrees.push(current);
        current = undefined;
      }
      continue;
    }
    const space = field.indexOf(' ');
    const key = space === -1 ? field : field.slice(0, space);
    const value = space === -1 ? '' : field.slice(space + 1);
    if (key === 'worktree') {
      if (current) {
        worktrees.push(current);
      }
      current = { path: value, bare: false, prunable: false };
    } else if (current) {
      if (key === 'HEAD') {
        current.head = value;
      } else if (key === 'branch') {
        current.branch = value.replace(/^refs\/heads\//, '');
      } else if (key === 'bare') {
        current.bare = true;
      } else if (key === 'prunable') {
        current.prunable = true;
      }
    }
  }
  if (current) {
    worktrees.push(current);
  }
  return worktrees;
}

/** Creates a new branch at `startPoint` and checks it out in a new worktree at `worktreePath`. */
export async function addWorktree(repo: string, worktreePath: string, branch: string, startPoint: string): Promise<void> {
  // --no-track: never let a task branch track the base branch, so a bare `git push` can't target it.
  await git(repo, ['worktree', 'add', '--no-track', '-b', branch, worktreePath, startPoint]);
}

export async function removeWorktree(repo: string, worktreePath: string, force: boolean): Promise<void> {
  await git(repo, ['worktree', 'remove', ...(force ? ['--force'] : []), worktreePath]);
}

/** Short names of local branches under the given prefixes, e.g. `['task', 'explore']`. */
export async function listBranches(repo: string, prefixes: readonly string[]): Promise<string[]> {
  const out = await git(repo, [
    'for-each-ref',
    '--format=%(refname:short)',
    ...prefixes.map((p) => `refs/heads/${p}/`),
  ]);
  return out.split('\n').filter((line) => line !== '');
}

/**
 * Makes git ignore `pattern` in `worktree` without committing anything, by adding it to
 * the repository's `info/exclude`. Linked worktrees share that file with the main one.
 */
export async function ensureExcluded(worktree: string, pattern: string): Promise<void> {
  const excludeFile = (await git(worktree, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'])).trim();
  let content = '';
  try {
    content = await fs.readFile(excludeFile, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw e;
    }
  }
  if (content.split(/\r?\n/).some((line) => line.trim() === pattern)) {
    return;
  }
  await fs.mkdir(path.dirname(excludeFile), { recursive: true });
  const prefix = content === '' || content.endsWith('\n') ? '' : '\n';
  await fs.appendFile(excludeFile, `${prefix}# Added by Taskbench\n${pattern}\n`);
}

export async function mergeBase(cwd: string, baseRef: string): Promise<string> {
  return (await git(cwd, ['merge-base', baseRef, 'HEAD'])).trim();
}

/**
 * Files that differ between `base` and the working tree (committed and uncommitted changes to
 * tracked files), like `git diff --name-status <base>`.
 */
export async function diffNameStatus(cwd: string, base: string): Promise<FileChange[]> {
  const out = await git(cwd, ['diff', '--name-status', '-z', '-M', base, '--']);
  const fields = out.split('\0');
  const changes: FileChange[] = [];
  for (let i = 0; i < fields.length; ) {
    const code = fields[i++];
    if (!code) {
      continue;
    }
    const status = code[0] as ChangeStatus;
    if (status === 'R' || status === 'C') {
      const oldPath = fields[i++];
      const newPath = fields[i++];
      changes.push({ status, path: newPath, oldPath });
    } else {
      changes.push({ status, path: fields[i++] });
    }
  }
  return changes;
}
