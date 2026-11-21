// Messages between the extension host and the task page webview.
// This file must stay free of runtime imports: the webview bundle includes it too.

export type TaskTextFile = 'description' | 'answer' | 'notes';

export interface TaskSummary {
  id: string;
  kind: 'task' | 'exploration';
  title: string;
  status: string;
  branch?: string;
  baseBranch: string;
  worktreePath: string;
}

export interface FileState {
  text: string;
  /** Increments every time the file's content changes on disk. */
  version: number;
}

export type HostToWebview =
  | {
      type: 'state';
      task: TaskSummary;
      files: Partial<Record<TaskTextFile, FileState>>;
    }
  | { type: 'gone'; message: string }
  | { type: 'error'; message: string };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'save'; file: TaskTextFile; text: string }
  | { type: 'openInEditor'; file: TaskTextFile }
  /** Sent after a file's content is rendered, so tests can check the page really updated. */
  | { type: 'rendered'; file: TaskTextFile; version: number; text: string };
