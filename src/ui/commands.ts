import * as vscode from 'vscode';
import { TaskRecord } from '../tasks/model';
import { TaskStore, WorktreeDirtyError } from '../tasks/store';
import { TaskPanel } from './taskPanel';
import { TaskTreeNode } from './taskTree';

/** Arguments accepted by `taskbench.newTask`. Anything left out is asked for interactively. */
export interface NewTaskArgs {
  title?: string;
  summary?: string;
  baseBranch?: string;
  /** Open the task page after creating it (default true). */
  open?: boolean;
}

/** What commands that act on one task accept: a tree node, a record, or a task id. */
type TaskArg = TaskTreeNode | TaskRecord | { id: string } | string | undefined;

export function registerCommands(
  context: vscode.ExtensionContext,
  getStore: () => TaskStore | undefined,
): void {
  const requireStore = (): TaskStore => {
    const store = getStore();
    if (!store) {
      throw new Error('Taskbench needs a folder that is inside a git repository.');
    }
    return store;
  };

  const register = (id: string, handler: (...args: never[]) => unknown): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: never[]) => {
        try {
          return await handler(...args);
        } catch (e) {
          void vscode.window.showErrorMessage(`Taskbench: ${e instanceof Error ? e.message : String(e)}`);
          return undefined;
        }
      }),
    );
  };

  register('taskbench.newTask', async (args?: NewTaskArgs) => {
    const store = requireStore();
    const baseBranch = args?.baseBranch ?? (await store.baseBranch());
    const title =
      args?.title ??
      (await vscode.window.showInputBox({
        title: `New Task from ${baseBranch}`,
        prompt: 'Title: a short, defined change, like a ticket title',
        placeHolder: 'Add rate limiting to the login endpoint',
        ignoreFocusOut: true,
        validateInput: (value) => (value.trim() ? undefined : 'Enter a title.'),
      }));
    if (!title) {
      return undefined;
    }
    const summary =
      args?.summary ??
      (args?.title !== undefined
        ? ''
        : await vscode.window.showInputBox({
            title: `New Task: ${title}`,
            prompt: 'Optional: what should change and why? Seeds the PR description. Press Enter to skip.',
            ignoreFocusOut: true,
          }));
    if (summary === undefined) {
      return undefined;
    }
    const record = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Creating worktree for "${title}"…` },
      () => store.create({ kind: 'task', title, summary, baseBranch }),
    );
    if (args?.open !== false) {
      TaskPanel.show(context.extensionUri, store, record);
    }
    return record;
  });

  register('taskbench.open', async (arg?: TaskArg) => {
    const store = requireStore();
    const record = await resolveTask(store, arg, 'Open which task?');
    if (record) {
      TaskPanel.show(context.extensionUri, store, record);
    }
  });

  register('taskbench.openWorktree', async (arg?: TaskArg) => {
    const store = requireStore();
    const record = await resolveTask(store, arg, 'Open which task\'s worktree?');
    if (record) {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(record.worktreePath), {
        forceNewWindow: true,
      });
    }
  });

  register('taskbench.archive', async (arg?: TaskArg) => {
    const store = requireStore();
    const record = await resolveTask(store, arg, 'Archive which task?');
    if (!record) {
      return;
    }
    const label = `#${record.meta.id} "${record.meta.title}"`;
    const confirm = await vscode.window.showWarningMessage(
      `Archive ${label}?`,
      {
        modal: true,
        detail:
          `This removes the worktree at ${record.worktreePath}.\n\n` +
          `The branch ${record.branch ?? ''} is kept, and a copy of its .task/ folder (description and notes) ` +
          `is saved in ${store.archiveRoot()}.`,
      },
      'Archive',
    );
    if (confirm !== 'Archive') {
      return;
    }
    TaskPanel.closeFor(record.worktreePath);
    try {
      await store.archive(record, false);
    } catch (e) {
      if (!(e instanceof WorktreeDirtyError)) {
        throw e;
      }
      const force = await vscode.window.showWarningMessage(
        `The worktree for ${label} has uncommitted or untracked changes.`,
        {
          modal: true,
          detail:
            'Archiving anyway deletes those changes permanently. To keep them, commit them on the task ' +
            `branch ${record.branch ?? ''} first.`,
        },
        'Delete Changes and Archive',
      );
      if (force !== 'Delete Changes and Archive') {
        return;
      }
      await store.archive(record, true);
    }
    void vscode.window.showInformationMessage(`Archived ${label}. Its branch ${record.branch ?? ''} is kept.`);
  });

  register('taskbench.refresh', () => getStore()?.notifyChanged());
}

async function resolveTask(store: TaskStore, arg: TaskArg, pickTitle: string): Promise<TaskRecord | undefined> {
  if (typeof arg === 'string') {
    return orThrow(await store.get(arg), arg);
  }
  if (arg && 'type' in arg) {
    if (arg.type === 'task') {
      return arg.record;
    }
  } else if (arg && 'meta' in arg) {
    return arg;
  } else if (arg && 'id' in arg) {
    return orThrow(await store.get(arg.id), arg.id);
  }
  const records = await store.list();
  if (records.length === 0) {
    void vscode.window.showInformationMessage('There are no tasks yet. Run "Taskbench: New Task" to create one.');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    records.map((record) => ({
      label: `#${record.meta.id} ${record.meta.title}`,
      description: record.meta.kind === 'task' ? record.meta.status : `exploration · ${record.meta.status}`,
      detail: record.worktreePath,
      record,
    })),
    { title: pickTitle, matchOnDetail: true },
  );
  return picked?.record;
}

function orThrow(record: TaskRecord | undefined, id: string): TaskRecord {
  if (!record) {
    throw new Error(`No task with id ${id}.`);
  }
  return record;
}
