import { memo, useCallback, useEffect, useRef, useState } from "react";
import KanbanBoard from "./KanbanBoard";

type Focus = "note" | "kanban";

const MIN_RATIO = 15;
const MAX_RATIO = 85;
const NOTE_FLUSH_DELAY_MS = 250;
const clampRatio = (r: number) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));

interface Props {
  // note(markdown) = single source of truth (App이 소유). note/kanban 양쪽이 공유 편집한다.
  note: string;
  onNoteChange: (note: string) => void;
  onNoteDraftChange?: (note: string) => void;
  tasks: string[];
  activeTask: string | null;
  /** 값이 바뀌면(체크인 '직접 입력' 등) Note 패널을 활성화하고 포커스한다 */
  focusSignal?: number;
}

function WorkView({
  note,
  onNoteChange,
  onNoteDraftChange,
  tasks,
  activeTask,
  focusSignal,
}: Props) {
  const [focus, setFocus] = useState<Focus>("note");
  const [topRatio, setTopRatio] = useState(50); // Note 패널 높이 %
  const [draftNote, setDraftNote] = useState(note);

  const splitRef = useRef<HTMLDivElement>(null);
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

  function onDividerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onDividerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const rect = splitRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return;
    setTopRatio(clampRatio(((e.clientY - rect.top) / rect.height) * 100));
  }

  function onDividerPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

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

      <div className="workspace-split" ref={splitRef}>
        <section
          className={`workspace-pane note-pane${noteActive ? "" : " inactive"}`}
          style={{ flex: `0 0 ${topRatio}%` }}
        >
          <textarea
            ref={textareaRef}
            className="markdown-editor"
            value={draftNote}
            readOnly={!noteActive}
            onFocus={() => setFocus("note")}
            onChange={(e) => handleNoteChange(e.target.value)}
            onBlur={flushDraft}
            spellCheck={false}
          />
          {!noteActive && (
            <button
              className="pane-overlay"
              aria-label="Note 활성화"
              onClick={activateNote}
            />
          )}
        </section>

        <div
          className="split-divider"
          role="separator"
          aria-orientation="horizontal"
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={onDividerPointerUp}
        >
          <span className="split-grip" />
        </div>

        <section
          className={`workspace-pane kanban-pane${kanbanActive ? "" : " inactive"}`}
        >
          <KanbanBoard
            markdown={kanbanMarkdown}
            onChange={onNoteChange}
            active={kanbanActive}
          />
          {!kanbanActive && (
            <button
              className="pane-overlay"
              aria-label="Kanban 활성화"
              onClick={activateKanban}
            />
          )}
        </section>
      </div>

      <div className="editor-footer">
        <span className="hint">
          두 뷰가 동시 동기화 — 클릭한 쪽이 활성화됩니다. ## 제목은 컬럼, - [ ]
          항목은 카드. 카드는 왼쪽 핸들로 드래그해 이동.
        </span>
      </div>
    </div>
  );
}

export default memo(WorkView);
