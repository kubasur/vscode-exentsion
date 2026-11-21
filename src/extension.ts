import * as path from 'node:path';
import * as vscode from 'vscode';
import { findMainRepo } from './git/repo';
import { TaskStore } from './tasks/store';
import { registerCommands } from './ui/commands';
import { TaskPanel } from './ui/taskPanel';
import { TaskTreeProvider } from './ui/taskTree';

/** Returned from `activate`, mainly so integration tests can reach the extension's state. */
export interface TaskbenchApi {
  store(): TaskStore | undefined;
  tree: TaskTreeProvider;
  /** Resolves once the repository has been looked up after activation. */
  ready: Promise<void>;
  findPanel: typeof TaskPanel.find;
}

export function activate(context: vscode.ExtensionContext): TaskbenchApi {
  const tree = new TaskTreeProvider();
  let store: TaskStore | undefined;
  let storeWatcher: vscode.Disposable | undefined;

  const view = vscode.window.createTreeView('taskbench.tasks', { treeDataProvider: tree, showCollapseAll: true });
  context.subscriptions.push(tree, view, { dispose: () => storeWatcher?.dispose() });

  const readConfig = () => {
    const config = vscode.workspace.getConfiguration('taskbench');
    return {
      worktreeRoot: config.get<string>('worktreeRoot', ''),
      baseBranch: config.get<string>('baseBranch', ''),
    };
  };

  const setState = (state: 'noRepo' | 'ready'): Thenable<unknown> =>
    vscode.commands.executeCommand('setContext', 'taskbench.state', state);

  let initialized = false;
  const init = async (): Promise<void> => {
    let repoRoot: string | undefined;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme === 'file') {
        repoRoot = await findMainRepo(folder.uri.fsPath).catch(() => undefined);
        if (repoRoot) {
          break;
        }
      }
    }
    if (initialized && repoRoot === store?.repoRoot) {
      return;
    }
    initialized = true;
    storeWatcher?.dispose();
    storeWatcher = undefined;
    store = repoRoot ? new TaskStore(repoRoot, readConfig) : undefined;
    if (store) {
      storeWatcher = watchTasks(store);
    }
    tree.setStore(store);
    await setState(store ? 'ready' : 'noRepo');
  };

  const watchTasks = (s: TaskStore): vscode.Disposable => {
    // Picks up tasks created, archived or retitled outside this window.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(s.worktreeRoot()), '*/.task/task.json'),
    );
    let timer: NodeJS.Timeout | undefined;
    const onEvent = (): void => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => s.notifyChanged(), 200);
    };
    const subscriptions = [watcher, watcher.onDidCreate(onEvent), watcher.onDidChange(onEvent), watcher.onDidDelete(onEvent)];
    return { dispose: () => subscriptions.forEach((d) => d.dispose()) };
  };

  registerCommands(context, () => store);

  const ready = init();

  context.subscriptions.push(
    // Brings task pages back after a window reload.
    vscode.window.registerWebviewPanelSerializer(TaskPanel.viewType, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
        await ready;
        const worktreePath = (state as { worktreePath?: unknown } | undefined)?.worktreePath;
        const record =
          store && typeof worktreePath === 'string'
            ? (await store.list()).find((r) => r.worktreePath === path.resolve(worktreePath))
            : undefined;
        if (store && record) {
          TaskPanel.restore(panel, context.extensionUri, store, record);
        } else {
          panel.dispose();
        }
      },
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void init()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('taskbench.worktreeRoot') && store) {
        storeWatcher?.dispose();
        storeWatcher = watchTasks(store);
      }
      if (e.affectsConfiguration('taskbench')) {
        tree.refresh();
      }
    }),
  );

  return { store: () => store, tree, ready, findPanel: TaskPanel.find };
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
