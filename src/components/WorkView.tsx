import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import KanbanBoard from "./KanbanBoard";

type Focus = "note" | "kanban";

const NOTE_FLUSH_DELAY_MS = 250;

interface Props {
  // note(markdown) = single source of truth (App이 소유). note/kanban 양쪽이 공유 편집한다.
  note: string;
  onNoteChange: (note: string) => void;
  onNoteDraftChange?: (note: string) => void;
  tasks: string[];
  activeTask: string | null;
  /** 값이 바뀌면(체크인 '직접 입력' 등) Note 패널을 활성화하고 포커스한다 */
  focusSignal?: number;
  footerAction?: ReactNode;
}

function WorkView({
  note,
  onNoteChange,
  onNoteDraftChange,
  tasks,
  activeTask,
  focusSignal,
  footerAction,
}: Props) {
  const [focus, setFocus] = useState<Focus>("note");
  const [draftNote, setDraftNote] = useState(note);

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

  useEffect(() => {
    if (note === lastFlushedNoteRef.current) return;
    clearFlushTimer();
    lastFlushedNoteRef.current = note;
    draftNoteRef.current = note;
    setDraftNote(note);
  }, [clearFlushTimer, note]);

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
          {tasks.map((task) => (
            <span
              key={task}
              className={`task-chip${task === activeTask ? " active" : ""}`}
            >
              {task}
            </span>
          ))}
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
