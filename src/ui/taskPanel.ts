import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { TaskRecord, TaskTextFile } from '../tasks/model';
import { TaskStore } from '../tasks/store';
import { FileState, HostToWebview, TaskSummary, WebviewToHost } from '../shared/protocol';

const VIEW_TYPE = 'taskbench.taskPage';

function filesFor(record: TaskRecord): TaskTextFile[] {
  return record.meta.kind === 'task' ? ['description', 'notes'] : ['answer', 'notes'];
}

/** One webview panel per task, showing its `.task/` files and refreshing live as they change. */
export class TaskPanel implements vscode.Disposable {
  static readonly viewType = VIEW_TYPE;
  private static readonly open = new Map<string, TaskPanel>();

  /** Opens the task's page, or reveals it if it's already open. */
  static show(extensionUri: vscode.Uri, store: TaskStore, record: TaskRecord): TaskPanel {
    const existing = TaskPanel.find(record.worktreePath);
    if (existing) {
      existing.panel.reveal();
      return existing;
    }
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, panelTitle(record), vscode.ViewColumn.Active, {
      ...webviewOptions(extensionUri),
      retainContextWhenHidden: true,
    });
    return TaskPanel.restore(panel, extensionUri, store, record);
  }

  /** Takes over an existing panel, e.g. one VS Code restored after a window reload. */
  static restore(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, store: TaskStore, record: TaskRecord): TaskPanel {
    panel.webview.options = webviewOptions(extensionUri);
    const taskPanel = new TaskPanel(panel, extensionUri, store, record);
    TaskPanel.open.set(path.resolve(record.worktreePath), taskPanel);
    return taskPanel;
  }

  static find(worktreePath: string): TaskPanel | undefined {
    return TaskPanel.open.get(path.resolve(worktreePath));
  }

  static closeFor(worktreePath: string): void {
    TaskPanel.find(worktreePath)?.dispose();
  }

  private readonly disposables: vscode.Disposable[] = [];
  private readonly files = new Map<TaskTextFile, FileState>();
  private readonly rendered = new Map<TaskTextFile, { version: number; text: string }>();
  private refreshTimer: NodeJS.Timeout | undefined;
  private refreshing: Promise<void> | undefined;
  private refreshAgain = false;
  private disposed = false;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly store: TaskStore,
    private record: TaskRecord,
  ) {
    panel.webview.html = renderHtml(panel.webview, extensionUri, panelTitle(record));
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((message: WebviewToHost) => void this.onMessage(message)),
      panel.onDidChangeViewState(() => {
        if (panel.visible) {
          this.scheduleRefresh(0);
        }
      }),
    );

    // Watch `.task/` itself (not recursive): the agent and the developer both edit these files.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(store.taskDir(record)), '*'),
    );
    const onFsEvent = (): void => this.scheduleRefresh(50);
    this.disposables.push(watcher, watcher.onDidChange(onFsEvent), watcher.onDidCreate(onFsEvent), watcher.onDidDelete(onFsEvent));
  }

  get worktreePath(): string {
    return this.record.worktreePath;
  }

  /** The text the webview last reported as rendered for `file`. Used by tests. */
  lastRendered(file: TaskTextFile): { version: number; text: string } | undefined {
    return this.rendered.get(file);
  }

  reveal(): void {
    this.panel.reveal();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    TaskPanel.open.delete(path.resolve(this.record.worktreePath));
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private async onMessage(message: WebviewToHost): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          this.files.clear();
          await this.refresh();
          break;
        case 'save':
          await this.store.writeText(this.record, message.file, message.text);
          await this.refresh();
          break;
        case 'openInEditor': {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(this.store.filePath(this.record, message.file)));
          await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
          break;
        }
        case 'rendered':
          this.rendered.set(message.file, { version: message.version, text: message.text });
          break;
      }
    } catch (e) {
      this.post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  private scheduleRefresh(delayMs: number): void {
    if (this.disposed) {
      return;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, delayMs);
  }

  /** Re-reads the task's files and sends them to the webview. Calls never overlap. */
  private async refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        await this.refreshOnce();
      } while (this.refreshAgain && !this.disposed);
    })();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
  }

  private async refreshOnce(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const reloaded = await this.store.reload(this.record);
    if (!reloaded) {
      this.post({ type: 'gone', message: 'This task\'s .task/task.json is missing. Was its worktree removed?' });
      return;
    }
    this.record = reloaded;
    this.panel.title = panelTitle(reloaded);

    const files: Partial<Record<TaskTextFile, FileState>> = {};
    for (const file of filesFor(reloaded)) {
      const text = await this.store.readText(reloaded, file);
      const previous = this.files.get(file);
      const state = previous && previous.text === text ? previous : { text, version: (previous?.version ?? 0) + 1 };
      this.files.set(file, state);
      files[file] = state;
    }
    this.post({ type: 'state', task: summarize(reloaded), files });
  }

  private post(message: HostToWebview): void {
    if (!this.disposed) {
      void this.panel.webview.postMessage(message);
    }
  }
}

function webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
  return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out', 'webview')] };
}

function panelTitle(record: TaskRecord): string {
  return `#${record.meta.id} ${record.meta.title}`;
}

function summarize(record: TaskRecord): TaskSummary {
  return {
    id: record.meta.id,
    kind: record.meta.kind,
    title: record.meta.title,
    status: record.meta.status,
    branch: record.branch,
    baseBranch: record.meta.baseBranch,
    worktreePath: record.worktreePath,
  };
}

function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri, title: string): string {
  const base = vscode.Uri.joinPath(extensionUri, 'out', 'webview');
  const script = webview.asWebviewUri(vscode.Uri.joinPath(base, 'task.js'));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(base, 'task.css'));
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} https: data:`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${style}">
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
