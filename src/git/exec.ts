import { execFile } from 'node:child_process';

export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(`git ${args.join(' ')} failed${exitCode === null ? '' : ` (exit ${exitCode})`}: ${stderr.trim()}`);
    this.name = 'GitError';
  }
}

/** Runs git in `cwd` and resolves with its stdout. Rejects with a GitError on a non-zero exit. */
export function git(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
      (error, stdout, stderr) => {
        if (error) {
          const code = typeof error.code === 'number' ? error.code : null;
          reject(new GitError(args, stderr || error.message, code));
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

/** Like `git`, but resolves with undefined instead of rejecting. */
export async function tryGit(cwd: string, args: readonly string[]): Promise<string | undefined> {
  try {
    return await git(cwd, args);
  } catch (e) {
    if (e instanceof GitError) {
      return undefined;
    }
    throw e;
  }
}
