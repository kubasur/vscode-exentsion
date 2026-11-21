export type TaskKind = 'task' | 'exploration';

export const TASK_STATUSES = ['open', 'in-progress', 'review', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Contents of `.task/task.json`. */
export interface TaskMeta {
  id: string;
  kind: TaskKind;
  title: string;
  baseBranch: string;
  createdAt: string;
  status: TaskStatus;
}

/** A task or exploration found on disk: its metadata plus where it lives. */
export interface TaskRecord {
  meta: TaskMeta;
  worktreePath: string;
  /** Branch checked out in the worktree; undefined if it's detached. */
  branch?: string;
}

/** The editable text files in `.task/`. */
export type { TaskTextFile } from '../shared/protocol';

export const TASK_DIR = '.task';

export const TASK_FILES = {
  meta: 'task.json',
  description: 'description.md',
  answer: 'answer.md',
  notes: 'notes.md',
  review: 'review.json',
} as const;

export const BRANCH_PREFIX: Record<TaskKind, string> = {
  task: 'task',
  exploration: 'explore',
};

/** Validates parsed `task.json` content. Returns undefined if it isn't usable. */
export function parseTaskMeta(value: unknown): TaskMeta | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const v = value as Record<string, unknown>;
  const kind = v.kind === 'task' || v.kind === 'exploration' ? v.kind : undefined;
  if (typeof v.id !== 'string' || !kind || typeof v.title !== 'string') {
    return undefined;
  }
  const status = TASK_STATUSES.find((s) => s === v.status) ?? 'open';
  return {
    id: v.id,
    kind,
    title: v.title,
    baseBranch: typeof v.baseBranch === 'string' ? v.baseBranch : '',
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
    status,
  };
}

/** `"Fix the Login bug!"` → `"fix-the-login-bug"`. */
export function slugify(title: string, maxLength = 40): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
  return slug || 'untitled';
}

export function descriptionTemplate(summary: string): string {
  return [
    '## What and why',
    '',
    summary.trim() || 'TODO: what this change does and why, written for reviewers.',
    '',
    '## How to test',
    '',
    'TODO',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] TODO',
    '',
  ].join('\n');
}

export function notesTemplate(): string {
  return [
    '# Notes',
    '',
    'Working notes for this task: decisions, gotchas and open questions. The agent appends here as it works.',
    '',
  ].join('\n');
}

export function answerTemplate(): string {
  return ['## Answer', '', 'TODO', ''].join('\n');
}

export function reviewTemplate(): string {
  return `${JSON.stringify({ version: 1, viewed: {}, intended: {} }, null, 2)}\n`;
}
