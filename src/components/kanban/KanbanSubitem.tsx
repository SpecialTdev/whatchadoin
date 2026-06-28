import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  DropTarget,
  FocusRequest,
  KanbanSubitem,
} from "../../lib/kanban";

export interface SubitemProps {
  item: KanbanSubitem;
  draggingId: string | null;
  dropTarget: DropTarget | null;
  focusRequest: FocusRequest;
  onFocusHandled: () => void;
  onToggle: (subitemId: string, done: boolean) => void;
  onTextChange: (subitemId: string, text: string) => void;
  onDelete: (subitemId: string) => void;
  onEnter: (subitemId: string) => void;
  onTab: (subitemId: string, shiftKey: boolean) => void;
  onDragStart: (subitemId: string) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: () => void;
  onArrowNavigate: (event: ReactKeyboardEvent<HTMLInputElement>) => boolean;
}

export function KanbanSubitem({
  item,
  draggingId,
  dropTarget,
  focusRequest,
  onFocusHandled,
  onToggle,
  onTextChange,
  onDelete,
  onEnter,
  onTab,
  onDragStart,
  onDragMove,
  onDragEnd,
  onArrowNavigate,
}: SubitemProps) {
  const handleRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isDropBefore =
    dropTarget?.kind === "subitem" && dropTarget.beforeSubitemId === item.id;

  useEffect(() => {
    if (focusRequest?.kind !== "subitem" || focusRequest.id !== item.id) return;
    inputRef.current?.focus();
    onFocusHandled();
  }, [focusRequest, item.id, onFocusHandled]);

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onEnter(item.id);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      onTab(item.id, e.shiftKey);
      return;
    }
    if (e.key === "Backspace" && item.text.length === 0 && item.children.length === 0) {
      e.preventDefault();
      onDelete(item.id);
      return;
    }
    onArrowNavigate(e);
  }

  return (
    <li
      data-subitem-id={item.id}
      className={
        "kanban-subitem" +
        (item.done ? " done" : "") +
        (draggingId === item.id ? " dragging" : "") +
        (isDropBefore ? " drop-before" : "")
      }
    >
      <div className="kanban-subitem-main">
        <span
          ref={handleRef}
          className="kanban-subitem-handle"
          title="드래그해 이동"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            handleRef.current?.setPointerCapture(e.pointerId);
            onDragStart(item.id);
          }}
          onPointerMove={(e) => onDragMove(e.clientX, e.clientY)}
          onPointerUp={(e) => {
            if (handleRef.current?.hasPointerCapture(e.pointerId)) {
              handleRef.current.releasePointerCapture(e.pointerId);
            }
            onDragEnd();
          }}
          onPointerCancel={(e) => {
            if (handleRef.current?.hasPointerCapture(e.pointerId)) {
              handleRef.current.releasePointerCapture(e.pointerId);
            }
            onDragEnd();
          }}
        >
          ⋮⋮
        </span>
        <input
          type="checkbox"
          className="kanban-subitem-check"
          checked={item.done}
          onChange={(e) => onToggle(item.id, e.target.checked)}
        />
        <input
          ref={inputRef}
          data-kanban-focus="item"
          className="kanban-subitem-text"
          value={item.text}
          placeholder="하위 항목…"
          onChange={(e) => onTextChange(item.id, e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className="kanban-subitem-delete"
          title="하위 항목 삭제"
          onClick={() => onDelete(item.id)}
        >
          ×
        </button>
      </div>
      {item.children.length > 0 && (
        <ul className="kanban-subitems nested">
          {item.children.map((child) => (
            <KanbanSubitem
              key={child.id}
              item={child}
              draggingId={draggingId}
              dropTarget={dropTarget}
              focusRequest={focusRequest}
              onFocusHandled={onFocusHandled}
              onToggle={onToggle}
              onTextChange={onTextChange}
              onDelete={onDelete}
              onEnter={onEnter}
              onTab={onTab}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
              onArrowNavigate={onArrowNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
