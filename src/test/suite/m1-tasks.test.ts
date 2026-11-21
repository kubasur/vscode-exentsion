import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { TaskbenchApi } from '../../extension';
import { git } from '../../git/exec';
import { listWorktrees } from '../../git/repo';
import { TaskRecord } from '../../tasks/model';
import { WorktreeDirtyError } from '../../tasks/store';
import { TaskNode, TaskTreeNode } from '../../ui/taskTree';
import { activateExtension, fixtureRepo, porcelainStatus, waitFor } from '../helpers';

suite('M1: tasks, task page and live watching', () => {
  let api: TaskbenchApi;
  let repo: string;
  let task: TaskRecord;

  suiteSetup(async () => {
    repo = fixtureRepo();
    api = await activateExtension();
    assert.ok(api.store(), 'the extension found the fixture repository');
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('New Task creates a worktree, a branch and the .task/ files', async () => {
    const record = await vscode.commands.executeCommand<TaskRecord | undefined>('taskbench.newTask', {
      title: 'Add rate limiting to login',
      summary: 'Limit login attempts per user.',
      open: false,
    });
    assert.ok(record, 'newTask returned the new task');
    task = record;

    assert.equal(task.meta.id, '1');
    assert.equal(task.meta.kind, 'task');
    assert.equal(task.meta.baseBranch, 'main');
    assert.equal(task.branch, 'task/1-add-rate-limiting-to-login');
    assert.equal(task.worktreePath, path.join(`${repo}.tasks`, '1-add-rate-limiting-to-login'));

    const worktree = (await listWorktrees(repo)).find((w) => w.path === task.worktreePath);
    assert.ok(worktree, 'git lists the new worktree');
    assert.equal(worktree.branch, task.branch);
    assert.equal(
      (await git(task.worktreePath, ['rev-parse', 'HEAD'])).trim(),
      (await git(repo, ['rev-parse', 'main'])).trim(),
      'the task branch starts at the base branch',
    );

    const taskDir = path.join(task.worktreePath, '.task');
    for (const file of ['task.json', 'description.md', 'notes.md', 'review.json']) {
      await fs.access(path.join(taskDir, file));
    }
    const meta = JSON.parse(await fs.readFile(path.join(taskDir, 'task.json'), 'utf8')) as Record<string, unknown>;
    assert.deepEqual(Object.keys(meta).sort(), ['baseBranch', 'createdAt', 'id', 'kind', 'status', 'title']);
    assert.match(await fs.readFile(path.join(taskDir, 'description.md'), 'utf8'), /Limit login attempts per user\./);
  });

  test('git status stays clean of .task/', async () => {
    assert.equal(await porcelainStatus(task.worktreePath), '', 'task worktree is clean');
    assert.equal(await porcelainStatus(repo), '', 'main worktree is clean');
    await git(task.worktreePath, ['check-ignore', '--quiet', '.task/notes.md']);
    // Nothing of .task/ is ever committed, even with `git add -A`.
    await git(task.worktreePath, ['add', '-A']);
    assert.equal((await git(task.worktreePath, ['diff', '--cached', '--name-only'])).trim(), '');
  });

  test('the sidebar lists the task under Tasks, with its changed-file count', async () => {
    const roots = await api.tree.getChildren();
    assert.deepEqual(
      roots.map((n) => (n.type === 'group' ? n.kind : 'task')),
      ['task', 'exploration'],
    );
    const tasks = await api.tree.getChildren(roots[0]);
    assert.equal(tasks.length, 1);
    const node = tasks[0] as TaskNode;
    assert.equal(node.record.meta.title, 'Add rate limiting to login');
    assert.equal(node.changedFiles, 0);
    const item = api.tree.getTreeItem(node);
    assert.equal(item.label, 'Add rate limiting to login');
    assert.equal(item.description, '#1 · open · 0 files');

    // One committed change and one uncommitted change, both counted against the merge-base.
    await fs.writeFile(path.join(task.worktreePath, 'api', 'limits.py'), 'MAX_ATTEMPTS = 5\n');
    await git(task.worktreePath, ['add', 'api/limits.py']);
    await git(task.worktreePath, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'Add limits']);
    await fs.appendFile(path.join(task.worktreePath, 'api', 'handlers.py'), '\n# TODO: rate limit\n');
    // Group nodes hold a snapshot of their tasks, so re-read from the root, as a tree refresh does.
    const updated = (await api.tree.getChildren((await api.tree.getChildren())[0]))[0] as TaskNode;
    assert.equal(updated.changedFiles, 2);
  });

  test('agent edits to notes.md appear on the task page within about 1 s', async function () {
    this.timeout(60_000);
    await vscode.commands.executeCommand('taskbench.open', task.meta.id);
    const panel = await waitFor('the task panel', () => api.findPanel(task.worktreePath));
    await waitFor('the webview to render notes.md', () => panel.lastRendered('notes'), 30_000);

    for (let i = 1; i <= 3; i++) {
      const marker = `Step ${i}: changed the limiter (${Date.now()})`;
      const start = Date.now();
      await fs.appendFile(path.join(task.worktreePath, '.task', 'notes.md'), `\n- ${marker}\n`);
      await waitFor(`notes.md update ${i} to render`, () => (panel.lastRendered('notes')?.text.includes(marker) ? true : undefined), 5_000);
      const elapsed = Date.now() - start;
      console.log(`      notes.md update ${i} rendered after ${elapsed} ms`);
      assert.ok(elapsed <= 1_000, `update ${i} took ${elapsed} ms`);
    }
  });

  test('description.md written from outside also refreshes the page', async () => {
    const panel = api.findPanel(task.worktreePath);
    assert.ok(panel);
    const text = '## What and why\n\nRewritten by the agent.\n';
    await fs.writeFile(path.join(task.worktreePath, '.task', 'description.md'), text);
    await waitFor('description.md to render', () => (panel.lastRendered('description')?.text === text ? true : undefined), 5_000);
  });

  test('a second task gets the next id', async () => {
    const second = await vscode.commands.executeCommand<TaskRecord | undefined>('taskbench.newTask', {
      title: 'Ünïcode & punctuation: OK?',
      open: false,
    });
    assert.ok(second);
    assert.equal(second.meta.id, '2');
    assert.equal(second.branch, 'task/2-unicode-punctuation-ok');
    const records = await api.store()!.list();
    assert.deepEqual(records.map((r) => r.meta.id), ['2', '1']);
  });

  test('Archive refuses a dirty worktree, then removes a clean one and keeps the branch and notes', async () => {
    const store = api.store()!;
    // The worktree has an uncommitted change from the tree test.
    await assert.rejects(store.archive(task, false), WorktreeDirtyError);
    await fs.access(task.worktreePath);
    assert.deepEqual(await fs.readdir(store.archiveRoot()).catch(() => []), [], 'a failed archive leaves no copy');

    await git(task.worktreePath, ['checkout', '--', 'api/handlers.py']);
    const archived = await store.archive(task, false);

    await assert.rejects(fs.access(task.worktreePath), 'the worktree folder is gone');
    assert.ok(!(await listWorktrees(repo)).some((w) => w.path === task.worktreePath));
    await git(repo, ['rev-parse', '--verify', `refs/heads/${task.branch}`]);
    assert.match(await fs.readFile(path.join(archived, 'notes.md'), 'utf8'), /Step 3/);
    assert.deepEqual((await store.list()).map((r) => r.meta.id), ['2']);
  });

  test('ids keep increasing after an archive', async () => {
    const third = await vscode.commands.executeCommand<TaskRecord | undefined>('taskbench.newTask', {
      title: 'Third',
      open: false,
    });
    assert.ok(third);
    assert.equal(third.meta.id, '3');
  });

  test('Explorations group is present but empty', async () => {
    const roots = await api.tree.getChildren();
    const explorations = roots.find((n): n is Extract<TaskTreeNode, { type: 'group' }> => n.type === 'group' && n.kind === 'exploration');
    assert.ok(explorations);
    assert.equal(explorations.tasks.length, 0);
  });
});
