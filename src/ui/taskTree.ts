import * as vscode from 'vscode';
import { diffNameStatus, mergeBase, resolveBranchRef } from '../git/repo';
import { TaskKind, TaskRecord } from '../tasks/model';
import { TaskStore } from '../tasks/store';

export type TaskTreeNode =
  | { type: 'group'; kind: TaskKind; tasks: TaskNode[] }
  | TaskNode;

export interface TaskNode {
  type: 'task';
  record: TaskRecord;
  /** Files changed against the merge-base; undefined if it couldn't be computed. */
  changedFiles?: number;
}

const GROUP_LABEL: Record<TaskKind, string> = { task: 'Tasks', exploration: 'Explorations' };

/** The "Tasks" tree in the Taskbench sidebar: two groups, Tasks and Explorations. */
export class TaskTreeProvider implements vscode.TreeDataProvider<TaskTreeNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<TaskTreeNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private store: TaskStore | undefined;
  private storeSubscription: { dispose(): void } | undefined;

  setStore(store: TaskStore | undefined): void {
    this.storeSubscription?.dispose();
    this.store = store;
    this.storeSubscription = store?.onDidChange(() => this.refresh());
    this.refresh();
  }

  refresh(): void {
    this.changed.fire(undefined);
  }

  dispose(): void {
    this.storeSubscription?.dispose();
    this.changed.dispose();
  }

  async getChildren(element?: TaskTreeNode): Promise<TaskTreeNode[]> {
    if (element) {
      return element.type === 'group' ? element.tasks : [];
    }
    if (!this.store) {
      return [];
    }
    const records = await this.store.list();
    if (records.length === 0) {
      return []; // Lets the view's welcome content show.
    }
    const nodes = await Promise.all(records.map((record) => this.toNode(record)));
    return (['task', 'exploration'] as const).map((kind) => ({
      type: 'group',
      kind,
      tasks: nodes.filter((n) => n.record.meta.kind === kind),
    }));
  }

  getTreeItem(node: TaskTreeNode): vscode.TreeItem {
    if (node.type === 'group') {
      const item = new vscode.TreeItem(GROUP_LABEL[node.kind], vscode.TreeItemCollapsibleState.Expanded);
      item.id = `group:${node.kind}`;
      item.description = String(node.tasks.length);
      item.contextValue = `group-${node.kind}`;
      return item;
    }
    const { meta, branch, worktreePath } = node.record;
    const item = new vscode.TreeItem(meta.title, vscode.TreeItemCollapsibleState.None);
    item.id = `task:${worktreePath}`;
    item.iconPath = new vscode.ThemeIcon(meta.kind === 'task' ? 'git-pull-request' : 'compass');
    const parts = [`#${meta.id}`, meta.status];
    if (node.changedFiles !== undefined) {
      parts.push(`${node.changedFiles} ${node.changedFiles === 1 ? 'file' : 'files'}`);
    }
    item.description = parts.join(' · ');
    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown(`**#${meta.id} ${escapeMarkdown(meta.title)}**\n\n`);
    tooltip.appendMarkdown(`$(git-branch) \`${branch ?? 'detached'}\` from \`${meta.baseBranch}\`\n\n`);
    tooltip.appendMarkdown(`$(folder) ${escapeMarkdown(worktreePath)}`);
    item.tooltip = tooltip;
    item.contextValue = meta.kind;
    item.command = { command: 'taskbench.open', title: 'Open', arguments: [node] };
    return item;
  }

  private async toNode(record: TaskRecord): Promise<TaskNode> {
    let changedFiles: number | undefined;
    try {
      const baseRef = await resolveBranchRef(record.worktreePath, record.meta.baseBranch);
      const base = await mergeBase(record.worktreePath, baseRef);
      changedFiles = (await diffNameStatus(record.worktreePath, base)).length;
    } catch {
      changedFiles = undefined;
    }
    return { type: 'task', record, changedFiles };
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
