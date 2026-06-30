import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { CheckInTaskOption } from "../lib/checkin";
import KanbanBoard from "./KanbanBoard";

type Focus = "note" | "kanban";

const NOTE_FLUSH_DELAY_MS = 250;

interface Props {
  // note(markdown) = single source of truth (App이 소유). note/kanban 양쪽이 공유 편집한다.
  note: string;
  onNoteChange: (note: string) => void;
  onNoteDraftChange?: (note: string) => void;
  tasks: string[];
  taskOptions?: CheckInTaskOption[];
  activeTask: string | null;
  onTaskCheckIn?: (task: string) => Promise<void>;
  /** 값이 바뀌면(체크인 '직접 입력' 등) Note 패널을 활성화하고 포커스한다 */
  focusSignal?: number;
  footerAction?: ReactNode;
}

function WorkView({
  note,
  onNoteChange,
  onNoteDraftChange,
  tasks,
  taskOptions = tasks.map((task) => ({ kind: "parent", label: task, value: task })),
  activeTask,
  onTaskCheckIn,
  focusSignal,
  footerAction,
}: Props) {
  const [focus, setFocus] = useState<Focus>("note");
  const [draftNote, setDraftNote] = useState(note);
  const [pendingTask, setPendingTask] = useState<string | null>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftNoteRef = useRef(note);
  const lastFlushedNoteRef = useRef(note);
  const flushTimerRef = useRef<number | null>(null);

  const noteActive = focus === "note";
  const kanbanActive = focus === "kanban";
  const kanbanMarkdown = kanbanActive ? draftNote : note;

  const clearFlushTimer = useCallback(() => {
    if (flushTimerRef.current == null) return;
    window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
  }, []);

  const flushDraft = useCallback(() => {
    clearFlushTimer();
    const next = draftNoteRef.current;
    if (next === lastFlushedNoteRef.current) return;
    lastFlushedNoteRef.current = next;
    onNoteChange(next);
  }, [clearFlushTimer, onNoteChange]);

  const scheduleFlush = useCallback(
    (next: string) => {
      clearFlushTimer();
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        if (next === lastFlushedNoteRef.current) return;
        lastFlushedNoteRef.current = next;
        onNoteChange(next);
      }, NOTE_FLUSH_DELAY_MS);
    },
    [clearFlushTimer, onNoteChange],
  );

  function activateNote() {
    setFocus("note");
    textareaRef.current?.focus();
  }

  function activateKanban() {
    flushDraft();
    setFocus("kanban");
  }

  function handleNoteChange(value: string) {
    draftNoteRef.current = value;
    setDraftNote(value);
    onNoteDraftChange?.(value);
    scheduleFlush(value);
  }

  async function handleTaskClick(task: string) {
    if (!onTaskCheckIn || pendingTask === task) return;
    setPendingTask(task);
    try {
      await onTaskCheckIn(task);
    } finally {
      setPendingTask(null);
    }
  }

  async function handleParentTaskClick(task: string, hasSubtasks: boolean) {
    setExpandedTask(hasSubtasks ? task : null);
    await handleTaskClick(task);
  }

  async function handleSubtaskClick(task: string, parentTask: string) {
    setExpandedTask(parentTask);
    await handleTaskClick(task);
  }

  useEffect(() => {
    if (note === lastFlushedNoteRef.current) return;
    clearFlushTimer();
    lastFlushedNoteRef.current = note;
    draftNoteRef.current = note;
    setDraftNote(note);
  }, [clearFlushTimer, note]);

  useEffect(() => {
    if (!activeTask) return;
    const activeOption = taskOptions.find((option) => option.value === activeTask);
    if (activeOption?.kind === "subitem" && activeOption.parentValue) {
      setExpandedTask(activeOption.parentValue);
    }
  }, [activeTask, taskOptions]);

  useEffect(() => {
    return () => {
      clearFlushTimer();
      const pending = draftNoteRef.current;
      if (pending !== lastFlushedNoteRef.current) onNoteChange(pending);
    };
  }, [clearFlushTimer, onNoteChange]);

  // 외부 신호(체크인 '직접 입력')로 Note 활성화
  useEffect(() => {
    if (focusSignal && focusSignal > 0) {
      setFocus("note");
      textareaRef.current?.focus();
    }
  }, [focusSignal]);

  return (
    <div className="work-view">
      <div className="editor-toolbar">
        <div className="editor-toolbar-left">
          <span className="editor-title">Workspace</span>
          <nav className="ws-mode-switch" aria-label="활성 패널">
            <button
              className={noteActive ? "active" : ""}
              onClick={activateNote}
            >
              Note
            </button>
            <button
              className={kanbanActive ? "active" : ""}
              onClick={activateKanban}
            >
              Kanban
            </button>
          </nav>
        </div>
        <span className="tracking-status">
          <span className="tracking-dot" />
          15s마다 변경 추적 중
        </span>
      </div>

      {tasks.length > 0 && (
        <div className="task-bar">
          {tasks.map((task) => {
            const subtasks = taskOptions.filter(
              (option) => option.kind === "subitem" && option.parentValue === task,
            );
            const isExpanded = expandedTask === task;
            return (
              <span className="task-chip-group" key={task}>
                <button
                  className={[
                    "task-chip",
                    task === activeTask ? "active" : "",
                    pendingTask === task ? "pending" : "",
                    subtasks.length > 0 ? "has-subtasks" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  disabled={pendingTask === task}
                  onClick={() => handleParentTaskClick(task, subtasks.length > 0)}
                  aria-pressed={task === activeTask}
                  aria-expanded={subtasks.length > 0 ? isExpanded : undefined}
                >
                  <span>{task}</span>
                  {subtasks.length > 0 && (
                    <span className="task-chip-count">{subtasks.length}</span>
                  )}
                </button>
                {isExpanded &&
                  subtasks.map((subtask) => (
                    <button
                      key={subtask.value}
                      className={[
                        "task-chip",
                        "subtask",
                        subtask.value === activeTask ? "active" : "",
                        pendingTask === subtask.value ? "pending" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      type="button"
                      disabled={pendingTask === subtask.value}
                      onClick={() => handleSubtaskClick(subtask.value, task)}
                      aria-pressed={subtask.value === activeTask}
                      title={subtask.value}
                    >
                      {subtask.label}
                    </button>
                  ))}
              </span>
            );
          })}
        </div>
      )}

      <div className="workspace-split">
        {noteActive ? (
          <section className="workspace-pane note-pane">
            <textarea
              ref={textareaRef}
              className="markdown-editor"
              value={draftNote}
              onFocus={() => setFocus("note")}
              onChange={(e) => handleNoteChange(e.target.value)}
              onBlur={flushDraft}
              spellCheck={false}
            />
          </section>
        ) : (
          <section className="workspace-pane kanban-pane">
            <KanbanBoard
              markdown={kanbanMarkdown}
              onChange={onNoteChange}
            />
          </section>
        )}
      </div>

      {footerAction && <div className="editor-footer">{footerAction}</div>}
    </div>
  );
}

export default memo(WorkView);
