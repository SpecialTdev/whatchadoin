import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  DropTarget,
  FocusRequest,
  KanbanCard,
} from "../../lib/kanban";
import { KanbanSubitem } from "./KanbanSubitem";

export interface CardItemProps {
  card: KanbanCard;
  isDragging: boolean;
  isDropBefore: boolean;
  isSubitemDrop: boolean;
  focusRequest: FocusRequest;
  onFocusHandled: () => void;
  onToggle: () => void;
  onTextChange: (text: string) => void;
  onDelete: () => void;
  onEnter: () => void;
  onTab: () => void;
  onDragStart: () => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: () => void;
  draggingId: string | null;
  dropTarget: DropTarget | null;
  onSubitemToggle: (subitemId: string, done: boolean) => void;
  onSubitemTextChange: (subitemId: string, text: string) => void;
  onSubitemDelete: (subitemId: string) => void;
  onSubitemEnter: (subitemId: string) => void;
  onSubitemTab: (subitemId: string, shiftKey: boolean) => void;
  onSubitemDragStart: (subitemId: string) => void;
  onArrowNavigate: (event: ReactKeyboardEvent<HTMLInputElement>) => boolean;
}

export function KanbanCardItem({
  card,
  isDragging,
  isDropBefore,
  isSubitemDrop,
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
  draggingId,
  dropTarget,
  onSubitemToggle,
  onSubitemTextChange,
  onSubitemDelete,
  onSubitemEnter,
  onSubitemTab,
  onSubitemDragStart,
  onArrowNavigate,
}: CardItemProps) {
  const handleRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusRequest?.kind !== "card" || focusRequest.id !== card.id) return;
    inputRef.current?.focus();
    onFocusHandled();
  }, [card.id, focusRequest, onFocusHandled]);

  return (
    <li
      data-card-id={card.id}
      className={
        "kanban-card" +
        (card.done ? " done" : "") +
        (isDragging ? " dragging" : "") +
        (isDropBefore ? " drop-before" : "") +
        (isSubitemDrop ? " subitem-drop" : "")
      }
    >
      <div className="kanban-card-main">
        <span
          ref={handleRef}
          className="kanban-card-handle"
          title="드래그해 이동"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            handleRef.current?.setPointerCapture(e.pointerId);
            onDragStart();
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
          ⠿
        </span>
        <input
          type="checkbox"
          className="kanban-card-check"
          checked={card.done}
          onChange={onToggle}
        />
        <input
          ref={inputRef}
          data-kanban-focus="item"
          className="kanban-card-text"
          value={card.text}
          placeholder="할 일 입력…"
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
            } else if (e.key === "Tab" && !e.shiftKey) {
              e.preventDefault();
              onTab();
            } else {
              onArrowNavigate(e);
            }
          }}
        />
        <button className="kanban-card-delete" title="카드 삭제" onClick={onDelete}>
          ×
        </button>
      </div>

      {card.children.length > 0 && (
        <ul className="kanban-subitems">
          {card.children.map((child) => (
            <KanbanSubitem
              key={child.id}
              item={child}
              draggingId={draggingId}
              dropTarget={dropTarget}
              focusRequest={focusRequest}
              onFocusHandled={onFocusHandled}
              onToggle={onSubitemToggle}
              onTextChange={onSubitemTextChange}
              onDelete={onSubitemDelete}
              onEnter={onSubitemEnter}
              onTab={onSubitemTab}
              onDragStart={onSubitemDragStart}
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
