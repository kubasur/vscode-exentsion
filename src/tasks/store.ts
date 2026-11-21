import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as gitRepo from '../git/repo';
import { GitError } from '../git/exec';
import {
  BRANCH_PREFIX,
  TASK_DIR,
  TASK_FILES,
  TaskKind,
  TaskMeta,
  TaskRecord,
  TaskTextFile,
  answerTemplate,
  descriptionTemplate,
  notesTemplate,
  parseTaskMeta,
  reviewTemplate,
  slugify,
} from './model';

export interface StoreConfig {
  /** `taskbench.worktreeRoot`: absolute, or relative to the repository root. Empty for the default. */
  worktreeRoot: string;
  /** `taskbench.baseBranch`. Empty for the repository's default branch. */
  baseBranch: string;
}

export interface CreateTaskOptions {
  kind: TaskKind;
  title: string;
  /** One-paragraph summary that seeds the description. */
  summary?: string;
  /** Overrides the configured base branch. */
  baseBranch?: string;
}

/** Thrown when a worktree can't be removed because it has uncommitted or untracked changes. */
export class WorktreeDirtyError extends Error {
  constructor(readonly worktreePath: string, readonly gitMessage: string) {
    super(`The worktree at ${worktreePath} has uncommitted or untracked changes.`);
    this.name = 'WorktreeDirtyError';
  }
}

type Listener = () => void;

/** Finds, creates and archives Tasks and Explorations for one repository. */
export class TaskStore {
  private readonly listeners = new Set<Listener>();

  constructor(
    readonly repoRoot: string,
    private readonly getConfig: () => StoreConfig,
  ) {}

  onDidChange(listener: Listener): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  /** Signals that tasks may have changed on disk, e.g. from a file watcher. */
  notifyChanged(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Directory that holds every task's worktree, e.g. `../myrepo.tasks`. */
  worktreeRoot(): string {
    const configured = this.getConfig().worktreeRoot.trim();
    if (configured) {
      return path.resolve(this.repoRoot, configured);
    }
    return path.join(path.dirname(this.repoRoot), `${path.basename(this.repoRoot)}.tasks`);
  }

  archiveRoot(): string {
    return path.join(this.worktreeRoot(), '.archived');
  }

  async baseBranch(): Promise<string> {
    return this.getConfig().baseBranch.trim() || (await gitRepo.defaultBranch(this.repoRoot));
  }

  async list(): Promise<TaskRecord[]> {
    const worktrees = await gitRepo.listWorktrees(this.repoRoot);
    const records: TaskRecord[] = [];
    for (const wt of worktrees) {
      if (wt.bare || wt.prunable || path.resolve(wt.path) === path.resolve(this.repoRoot)) {
        continue;
      }
      const meta = await readMeta(wt.path);
      if (meta) {
        // path.resolve normalizes the forward slashes git prints on Windows.
        records.push({ meta, worktreePath: path.resolve(wt.path), branch: wt.branch });
      }
    }
    return records.sort((a, b) => compareIds(a.meta.id, b.meta.id));
  }

  async get(id: string): Promise<TaskRecord | undefined> {
    return (await this.list()).find((r) => r.meta.id === id);
  }

  async create(options: CreateTaskOptions): Promise<TaskRecord> {
    const title = options.title.trim();
    if (!title) {
      throw new Error('A title is required.');
    }
    const baseBranch = options.baseBranch?.trim() || (await this.baseBranch());
    const startPoint = await gitRepo.resolveBranchRef(this.repoRoot, baseBranch);
    const id = await this.nextId();
    const slug = slugify(title);
    const name = `${id}-${slug}`;
    const branch = `${BRANCH_PREFIX[options.kind]}/${name}`;
    const worktreePath = path.join(this.worktreeRoot(), name);

    if (await pathExists(worktreePath)) {
      throw new Error(`${worktreePath} already exists.`);
    }
    if (await gitRepo.branchExists(this.repoRoot, branch)) {
      throw new Error(`Branch ${branch} already exists.`);
    }

    await fs.mkdir(this.worktreeRoot(), { recursive: true });
    await gitRepo.addWorktree(this.repoRoot, worktreePath, branch, startPoint);
    await gitRepo.ensureExcluded(worktreePath, `/${TASK_DIR}/`);

    const meta: TaskMeta = {
      id,
      kind: options.kind,
      title,
      baseBranch,
      createdAt: new Date().toISOString(),
      status: 'open',
    };
    const taskDir = path.join(worktreePath, TASK_DIR);
    await fs.mkdir(taskDir, { recursive: true });
    await writeJson(path.join(taskDir, TASK_FILES.meta), meta);
    if (options.kind === 'task') {
      await fs.writeFile(path.join(taskDir, TASK_FILES.description), descriptionTemplate(options.summary ?? ''));
    } else {
      await fs.writeFile(path.join(taskDir, TASK_FILES.answer), answerTemplate());
    }
    await fs.writeFile(path.join(taskDir, TASK_FILES.notes), notesTemplate());
    await fs.writeFile(path.join(taskDir, TASK_FILES.review), reviewTemplate());

    this.notifyChanged();
    return { meta, worktreePath, branch };
  }

  /**
   * Copies the task's `.task/` folder to the archive, then removes its worktree. The branch is kept.
   * Throws WorktreeDirtyError if the worktree has changes and `force` is false.
   * Returns the archive folder.
   */
  async archive(record: TaskRecord, force: boolean): Promise<string> {
    const archived = path.join(
      this.archiveRoot(),
      `${path.basename(record.worktreePath)}-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    );
    await fs.mkdir(this.archiveRoot(), { recursive: true });
    await fs.cp(path.join(record.worktreePath, TASK_DIR), archived, { recursive: true });
    try {
      await gitRepo.removeWorktree(this.repoRoot, record.worktreePath, force);
    } catch (e) {
      await fs.rm(archived, { recursive: true, force: true });
      if (!force && e instanceof GitError && /modified or untracked|is dirty|untracked files/i.test(e.stderr)) {
        throw new WorktreeDirtyError(record.worktreePath, e.stderr);
      }
      throw e;
    }
    this.notifyChanged();
    return archived;
  }

  taskDir(record: TaskRecord): string {
    return path.join(record.worktreePath, TASK_DIR);
  }

  filePath(record: TaskRecord, file: TaskTextFile | 'meta' | 'review'): string {
    return path.join(this.taskDir(record), TASK_FILES[file]);
  }

  /** Reads a `.task/` text file. Missing files read as an empty string. */
  async readText(record: TaskRecord, file: TaskTextFile): Promise<string> {
    try {
      return await fs.readFile(this.filePath(record, file), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return '';
      }
      throw e;
    }
  }

  async writeText(record: TaskRecord, file: TaskTextFile, text: string): Promise<void> {
    await fs.mkdir(this.taskDir(record), { recursive: true });
    await fs.writeFile(this.filePath(record, file), text);
  }

  /** Re-reads `task.json` for a record, e.g. after a watcher saw it change. */
  async reload(record: TaskRecord): Promise<TaskRecord | undefined> {
    const meta = await readMeta(record.worktreePath);
    return meta ? { ...record, meta } : undefined;
  }

  private async nextId(): Promise<string> {
    let max = 0;
    const bump = (value: string | undefined): void => {
      const n = value ? Number.parseInt(value, 10) : NaN;
      if (Number.isFinite(n) && n > max) {
        max = n;
      }
    };
    for (const branch of await gitRepo.listBranches(this.repoRoot, Object.values(BRANCH_PREFIX))) {
      bump(/^[^/]+\/(\d+)-/.exec(branch)?.[1]);
    }
    for (const record of await this.list()) {
      bump(record.meta.id);
    }
    for (const folder of [this.worktreeRoot(), this.archiveRoot()]) {
      for (const entry of await readDirSafe(folder)) {
        bump(/^(\d+)-/.exec(entry)?.[1]);
      }
    }
    return String(max + 1);
  }
}

async function readMeta(worktreePath: string): Promise<TaskMeta | undefined> {
  try {
    const raw = await fs.readFile(path.join(worktreePath, TASK_DIR, TASK_FILES.meta), 'utf8');
    return parseTaskMeta(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readDirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

function compareIds(a: string, b: string): number {
  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) {
    return nb - na; // Newest first.
  }
  return b.localeCompare(a);
}
