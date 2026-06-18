import { memo, useEffect, useRef, useState } from "react";
import {
  type KanbanBoard as Board,
  type KanbanColumn,
  type KanbanCard,
  parseMarkdown,
  serializeBoard,
  newCard,
  newColumn,
} from "../lib/kanban";

interface Props {
  /** source of truth: markdown todo note */
  markdown: string;
  onChange: (markdown: string) => void;
  /** false면 패널이 비활성(아웃포커스) — 드래그 시작을 막는다 */
  active: boolean;
}

interface DropTarget {
  colId: string;
  beforeCardId: string | null;
}

function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.colId === b.colId && a.beforeCardId === b.beforeCardId;
}

function KanbanBoard({ markdown, onChange, active }: Props) {
  const [board, setBoard] = useState<Board>(() => parseMarkdown(markdown));

  // 우리가 직접 직렬화해 내보낸 마크다운인지 추적해, 외부(note) 편집만 re-parse.
  const lastSerialized = useRef<string>(markdown);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  const draggedRef = useRef<{ cardId: string; fromColId: string } | null>(null);

  useEffect(() => {
    if (markdown !== lastSerialized.current) {
      setBoard(parseMarkdown(markdown));
      lastSerialized.current = markdown;
    }
  }, [markdown]);

  function commit(next: Board) {
    setBoard(next);
    const md = serializeBoard(next);
    lastSerialized.current = md;
    onChange(md);
  }

  function mapColumns(fn: (col: KanbanColumn) => KanbanColumn) {
    commit({ ...board, columns: board.columns.map(fn) });
  }

  function mapCardsIn(colId: string, fn: (cards: KanbanCard[]) => KanbanCard[]) {
    mapColumns((col) => (col.id === colId ? { ...col, cards: fn(col.cards) } : col));
  }

  // ----- card ops -----
  function toggleCard(colId: string, cardId: string) {
    mapCardsIn(colId, (cards) =>
      cards.map((c) => (c.id === cardId ? { ...c, done: !c.done } : c)),
    );
  }

  function setCardText(colId: string, cardId: string, text: string) {
    mapCardsIn(colId, (cards) =>
      cards.map((c) => (c.id === cardId ? { ...c, text } : c)),
    );
  }

  function deleteCard(colId: string, cardId: string) {
    mapCardsIn(colId, (cards) => cards.filter((c) => c.id !== cardId));
  }

  function addCard(colId: string) {
    const card = newCard();
    setJustAddedId(card.id);
    mapCardsIn(colId, (cards) => [...cards, card]);
  }

  function moveCard(
    cardId: string,
    fromColId: string,
    toColId: string,
    beforeCardId: string | null,
  ) {
    let moved: KanbanCard | undefined;
    const stripped = board.columns.map((col) => {
      if (col.id !== fromColId) return col;
      moved = col.cards.find((c) => c.id === cardId);
      return { ...col, cards: col.cards.filter((c) => c.id !== cardId) };
    });
    if (!moved) return;

    const columns = stripped.map((col) => {
      if (col.id !== toColId) return col;
      const cards = [...col.cards];
      const idx =
        beforeCardId === null
          ? cards.length
          : cards.findIndex((c) => c.id === beforeCardId);
      cards.splice(idx === -1 ? cards.length : idx, 0, moved!);
      return { ...col, cards };
    });

    commit({ ...board, columns });
  }

  // ----- column ops -----
  function setColumnTitle(colId: string, title: string) {
    mapColumns((col) => (col.id === colId ? { ...col, title } : col));
  }

  function deleteColumn(colId: string) {
    commit({ ...board, columns: board.columns.filter((c) => c.id !== colId) });
  }

  function addColumn() {
    commit({ ...board, columns: [...board.columns, newColumn()] });
  }

  // ----- drag & drop (pointer 기반: WebView에서 안정적) -----
  function startDrag(cardId: string, fromColId: string) {
    if (!active) return;
    draggedRef.current = { cardId, fromColId };
    setDraggingId(cardId);
  }

  function computeDropTarget(x: number, y: number): DropTarget | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const colEl = el?.closest("[data-col-id]") as HTMLElement | null;
    if (!colEl) return null;
    const colId = colEl.getAttribute("data-col-id")!;

    const cardEl = el?.closest("[data-card-id]") as HTMLElement | null;
    if (!cardEl) return { colId, beforeCardId: null };

    const cardId = cardEl.getAttribute("data-card-id")!;
    const rect = cardEl.getBoundingClientRect();
    const isAfter = y > rect.top + rect.height / 2;
    if (!isAfter) return { colId, beforeCardId: cardId };

    const col = board.columns.find((c) => c.id === colId);
    const idx = col ? col.cards.findIndex((c) => c.id === cardId) : -1;
    const next = col && idx >= 0 ? col.cards[idx + 1] : undefined;
    return { colId, beforeCardId: next ? next.id : null };
  }

  function moveDrag(x: number, y: number) {
    if (!draggedRef.current) return;
    setGhostPos({ x, y });
    const next = computeDropTarget(x, y);
    setDropTarget((prev) => (sameTarget(prev, next) ? prev : next));
  }

  function endDrag() {
    const dragged = draggedRef.current;
    if (dragged && dropTarget) {
      moveCard(
        dragged.cardId,
        dragged.fromColId,
        dropTarget.colId,
        dropTarget.beforeCardId,
      );
    }
    draggedRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
    setGhostPos(null);
  }

  const boardTitle = board.preamble.match(/^#\s+(.*)$/m)?.[1]?.trim();
  const draggingCard = draggingId
    ? board.columns.flatMap((c) => c.cards).find((c) => c.id === draggingId)
    : null;

  return (
    <section className="kanban-wrap">
      {boardTitle && <p className="kanban-board-title">{boardTitle}</p>}

      <div className={`kanban-board${draggingId ? " dragging" : ""}`}>
        {board.columns.map((col) => {
          const isDropCol = dropTarget?.colId === col.id;
          return (
            <section
              key={col.id}
              data-col-id={col.id}
              className={`kanban-column${isDropCol ? " drag-over" : ""}`}
            >
              <header className="kanban-col-header">
                <input
                  className="kanban-col-title"
                  value={col.title}
                  placeholder="컬럼 이름"
                  onChange={(e) => setColumnTitle(col.id, e.target.value)}
                />
                <span className="kanban-col-count">{col.cards.length}</span>
                <button
                  className="kanban-col-delete"
                  title="컬럼 삭제"
                  onClick={() => deleteColumn(col.id)}
                >
                  ×
                </button>
              </header>

              {col.note && <p className="kanban-col-note">{col.note}</p>}

              <ul
                className={`kanban-cards${
                  isDropCol && dropTarget?.beforeCardId === null ? " drop-end" : ""
                }`}
              >
                {col.cards.map((card) => (
                  <KanbanCardItem
                    key={card.id}
                    card={card}
                    isDragging={draggingId === card.id}
                    isDropBefore={isDropCol && dropTarget?.beforeCardId === card.id}
                    autoFocus={card.id === justAddedId}
                    onToggle={() => toggleCard(col.id, card.id)}
                    onTextChange={(t) => setCardText(col.id, card.id, t)}
                    onDelete={() => deleteCard(col.id, card.id)}
                    onEnter={() => addCard(col.id)}
                    onFocusText={() => setJustAddedId(null)}
                    onDragStart={() => startDrag(card.id, col.id)}
                    onDragMove={moveDrag}
                    onDragEnd={endDrag}
                  />
                ))}
              </ul>

              <button className="kanban-add-card" onClick={() => addCard(col.id)}>
                + 카드 추가
              </button>
            </section>
          );
        })}

        <button className="kanban-add-column" onClick={addColumn}>
          + 컬럼
        </button>
      </div>

      {draggingCard && ghostPos && (
        <div
          className="kanban-drag-ghost"
          style={{ left: ghostPos.x + 12, top: ghostPos.y + 8 }}
        >
          {draggingCard.text || "할 일"}
        </div>
      )}
    </section>
  );
}

interface CardItemProps {
  card: KanbanCard;
  isDragging: boolean;
  isDropBefore: boolean;
  autoFocus: boolean;
  onToggle: () => void;
  onTextChange: (text: string) => void;
  onDelete: () => void;
  onEnter: () => void;
  onFocusText: () => void;
  onDragStart: () => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: () => void;
}

function KanbanCardItem({
  card,
  isDragging,
  isDropBefore,
  autoFocus,
  onToggle,
  onTextChange,
  onDelete,
  onEnter,
  onFocusText,
  onDragStart,
  onDragMove,
  onDragEnd,
}: CardItemProps) {
  const handleRef = useRef<HTMLSpanElement>(null);

  return (
    <li
      data-card-id={card.id}
      className={
        "kanban-card" +
        (card.done ? " done" : "") +
        (isDragging ? " dragging" : "") +
        (isDropBefore ? " drop-before" : "")
      }
    >
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
        className="kanban-card-text"
        value={card.text}
        placeholder="할 일 입력…"
        autoFocus={autoFocus}
        onFocus={onFocusText}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
            onEnter();
          }
        }}
      />
      <button className="kanban-card-delete" title="카드 삭제" onClick={onDelete}>
        ×
      </button>
    </li>
  );
}

export default memo(KanbanBoard);
