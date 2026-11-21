import MarkdownIt from 'markdown-it';
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { FileState, HostToWebview, TaskSummary, TaskTextFile } from '../../src/shared/protocol';
import { vscode } from '../vscodeApi';

// html: false escapes raw HTML in the markdown, so agent-written files can't inject markup.
const md = new MarkdownIt({ html: false, linkify: true });

interface Tab {
  file: TaskTextFile;
  label: string;
  hint: string;
}

const TABS: Record<TaskSummary['kind'], Tab[]> = {
  task: [
    { file: 'description', label: 'Description', hint: 'The PR description: short and written for reviewers.' },
    { file: 'notes', label: 'Notes', hint: 'Private working notes. The agent appends here as it works.' },
  ],
  exploration: [
    { file: 'answer', label: 'Answer', hint: 'Findings, with file and line references.' },
    { file: 'notes', label: 'Notes', hint: 'Private working notes. The agent appends here as it works.' },
  ],
};

export function App() {
  const [task, setTask] = useState<TaskSummary>();
  const [files, setFiles] = useState<Partial<Record<TaskTextFile, FileState>>>({});
  const [problem, setProblem] = useState<string>();
  const [gone, setGone] = useState<string>();
  const [activeTab, setActiveTab] = useState<string | undefined>(() => vscode.getState()?.tab);

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostToWebview>) => {
      const message = event.data;
      switch (message.type) {
        case 'state':
          if (vscode.getState()?.worktreePath !== message.task.worktreePath) {
            vscode.setState({ ...vscode.getState(), worktreePath: message.task.worktreePath });
          }
          setTask(message.task);
          setFiles(message.files);
          setGone(undefined);
          break;
        case 'gone':
          setGone(message.message);
          break;
        case 'error':
          setProblem(message.message);
          break;
      }
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (!task) {
    return <p className="loading">Loading task…</p>;
  }

  const tabs = TABS[task.kind];
  const current = tabs.find((t) => t.file === activeTab) ?? tabs[0];
  const selectTab = (file: TaskTextFile) => {
    setActiveTab(file);
    vscode.setState({ ...vscode.getState(), tab: file });
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.indexOf(current);
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta !== 0) {
      const next = tabs[(index + delta + tabs.length) % tabs.length];
      selectTab(next.file);
      document.getElementById(`tab-${next.file}`)?.focus();
    }
  };

  return (
    <main>
      <header className="task-header">
        <h1>
          <span className="task-id">#{task.id}</span> {task.title}
        </h1>
        <div className="task-meta">
          <span className={`badge status-${task.status}`}>{task.status}</span>
          <span className="codicon-text" title="Branch and base branch">
            <code>{task.branch ?? 'detached HEAD'}</code> ← <code>{task.baseBranch}</code>
          </span>
          <span className="path" title="Worktree">{task.worktreePath}</span>
        </div>
      </header>

      {gone && <div className="banner warning" role="alert">{gone}</div>}
      {problem && (
        <div className="banner error" role="alert">
          {problem}{' '}
          <button className="link" onClick={() => setProblem(undefined)}>Dismiss</button>
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Task sections" onKeyDown={onTabKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.file}
            id={`tab-${tab.file}`}
            role="tab"
            aria-selected={tab === current}
            aria-controls={`panel-${tab.file}`}
            tabIndex={tab === current ? 0 : -1}
            className={tab === current ? 'tab active' : 'tab'}
            onClick={() => selectTab(tab.file)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {tabs.map((tab) => (
        <section
          key={tab.file}
          id={`panel-${tab.file}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab.file}`}
          hidden={tab !== current}
        >
          <MarkdownFile tab={tab} state={files[tab.file]} />
        </section>
      ))}
    </main>
  );
}

function MarkdownFile({ tab, state }: { tab: Tab; state: FileState | undefined }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [editBaseVersion, setEditBaseVersion] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const text = state?.text ?? '';
  const version = state?.version ?? 0;
  const html = useMemo(() => md.render(text), [text]);

  // Report what was rendered, so the extension (and its tests) know the page is up to date.
  useEffect(() => {
    if (state && !editing) {
      vscode.postMessage({ type: 'rendered', file: tab.file, version, text });
    }
  }, [tab.file, version, text, editing, state]);

  useEffect(() => {
    if (editing) {
      textarea.current?.focus();
    }
  }, [editing]);

  const startEditing = () => {
    setDraft(text);
    setEditBaseVersion(version);
    setEditing(true);
  };
  const save = () => {
    vscode.postMessage({ type: 'save', file: tab.file, text: draft });
    setEditing(false);
  };
  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setEditing(false);
    }
  };

  const changedOnDisk = editing && version !== editBaseVersion;

  return (
    <div className="markdown-file">
      <div className="toolbar">
        <span className="hint">{tab.hint}</span>
        <span className="actions">
          {editing ? (
            <>
              <button onClick={save} title="Save (Ctrl+S / Cmd+S)">Save</button>
              <button className="secondary" onClick={() => setEditing(false)} title="Cancel (Esc)">Cancel</button>
            </>
          ) : (
            <button onClick={startEditing}>Edit</button>
          )}
          <button className="secondary" onClick={() => vscode.postMessage({ type: 'openInEditor', file: tab.file })}>
            Open in Editor
          </button>
        </span>
      </div>

      {changedOnDisk && (
        <div className="banner warning" role="alert">
          This file changed on disk while you were editing.{' '}
          <button
            className="link"
            onClick={() => {
              setDraft(text);
              setEditBaseVersion(version);
            }}
          >
            Load the new version
          </button>{' '}
          or keep editing to overwrite it when you save.
        </div>
      )}

      {editing ? (
        <textarea
          ref={textarea}
          className="editor"
          value={draft}
          spellCheck
          aria-label={`Edit ${tab.label}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onEditorKeyDown}
        />
      ) : text.trim() === '' ? (
        <p className="empty">
          Nothing here yet. <button className="link" onClick={startEditing}>Start writing</button>
        </p>
      ) : (
        <article className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
}
