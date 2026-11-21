import type { WebviewToHost } from '../src/shared/protocol';

interface VsCodeApi<State> {
  postMessage(message: WebviewToHost): void;
  getState(): State | undefined;
  setState(state: State): void;
}

declare function acquireVsCodeApi<State>(): VsCodeApi<State>;

export interface PersistedState {
  tab?: string;
  /** Lets the extension find the task again when VS Code restores this page after a reload. */
  worktreePath?: string;
}

// acquireVsCodeApi may only be called once per webview.
export const vscode: VsCodeApi<PersistedState> = acquireVsCodeApi<PersistedState>();
