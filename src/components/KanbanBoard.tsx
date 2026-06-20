import { memo, useEffect, useRef, useState } from "react";
import {
  type CardDropTarget as DropTarget,
  type KanbanBoard as Board,
  type KanbanCard,
  type KanbanColumn,
  type KanbanRow,
  type KanbanSubitem,
  moveCard as moveCardInBoard,
  newCard,
  newColumn,
  newRow,
  parseMarkdown,
  serializeBoard,
} from "../lib/kanban";

interface Props {
  /** source of truth: markdown todo note */
  markdown: string;
  onChange: (markdown: string) => void;
}

function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.rowId === b.rowId &&
    a.colId === b.colId &&
    a.beforeCardId === b.beforeCardId
  );
}

function KanbanBoard({ markdown, onChange }: Props) {
  const [board, setBoard] = useState<Board>(() => parseMarkdown(markdown));

  // 우리가 직접 직렬화해 내보낸 마크다운인지 추적해, 외부(note) 편집만 re-parse.
  const lastSerialized = useRef<string>(markdown);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  const draggedRef = useRef<{ cardId: string; fromRowId: string; fromColId: string } | null>(
    null,
  );

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

  function mapRows(fn: (row: KanbanRow) => KanbanRow) {
    commit({ ...board, rows: board.rows.map(fn) });
  }

  function mapColumns(
    rowId: string,
    fn: (col: KanbanColumn) => KanbanColumn,
  ) {
    mapRows((row) =>
      row.id === rowId ? { ...row, columns: row.columns.map(fn) } : row,
    );
  }

  function mapCardsIn(
    rowId: string,
    colId: string,
    fn: (cards: KanbanCard[]) => KanbanCard[],
  ) {
    mapColumns(rowId, (col) =>
      col.id === colId ? { ...col, cards: fn(col.cards) } : col,
    );
  }

  // ----- card ops -----
  function toggleCard(rowId: string, colId: string, cardId: string) {
    mapCardsIn(rowId, colId, (cards) =>
      cards.map((c) => (c.id === cardId ? { ...c, done: !c.done } : c)),
    );
  }

  function setCardText(rowId: string, colId: string, cardId: string, text: string) {
    mapCardsIn(rowId, colId, (cards) =>
      cards.map((c) => (c.id === cardId ? { ...c, text } : c)),
    );
  }

  function deleteCard(rowId: string, colId: string, cardId: string) {
    mapCardsIn(rowId, colId, (cards) => cards.filter((c) => c.id !== cardId));
  }

  function addCard(rowId: string, colId: string) {
    const card = newCard();
    setJustAddedId(card.id);
    mapCardsIn(rowId, colId, (cards) => [...cards, card]);
  }

  function moveCard(
    cardId: string,
    fromRowId: string,
    fromColId: string,
    target: DropTarget,
  ) {
    const next = moveCardInBoard(
      board,
      cardId,
      { rowId: fromRowId, colId: fromColId },
      target,
    );
    if (next !== board) commit(next);
  }

  // ----- row / column ops -----
  function setRowTitle(rowId: string, title: string) {
    mapRows((row) => (row.id === rowId ? { ...row, title } : row));
  }

  function addRow() {
    commit({ ...board, rows: [...board.rows, newRow()] });
  }

  function setColumnTitle(rowId: string, colId: string, title: string) {
    mapColumns(rowId, (col) => (col.id === colId ? { ...col, title } : col));
  }

  function deleteColumn(rowId: string, colId: string) {
    mapRows((row) =>
      row.id === rowId
        ? { ...row, columns: row.columns.filter((c) => c.id !== colId) }
        : row,
    );
  }

  function addColumn(rowId: string) {
    mapRows((row) =>
      row.id === rowId ? { ...row, columns: [...row.columns, newColumn()] } : row,
    );
  }

  // ----- drag & drop (pointer 기반: WebView에서 안정적) -----
  function startDrag(cardId: string, fromRowId: string, fromColId: string) {
    draggedRef.current = { cardId, fromRowId, fromColId };
    setDraggingId(cardId);
  }

  function findRow(rowId: string): KanbanRow | undefined {
    return board.rows.find((row) => row.id === rowId);
  }

  function computeDropTarget(x: number, y: number): DropTarget | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const rowEl = el?.closest("[data-row-id]") as HTMLElement | null;
    const colEl = el?.closest("[data-col-id]") as HTMLElement | null;
    if (!rowEl || !colEl) return null;

    const rowId = rowEl.getAttribute("data-row-id")!;
    const colId = colEl.getAttribute("data-col-id")!;

    const cardEl = el?.closest("[data-card-id]") as HTMLElement | null;
    if (!cardEl) return { rowId, colId, beforeCardId: null };

    const cardId = cardEl.getAttribute("data-card-id")!;
    const rect = cardEl.getBoundingClientRect();
    const isAfter = y > rect.top + rect.height / 2;
    if (!isAfter) return { rowId, colId, beforeCardId: cardId };

    const col = findRow(rowId)?.columns.find((c) => c.id === colId);
    const idx = col ? col.cards.findIndex((c) => c.id === cardId) : -1;
    const next = col && idx >= 0 ? col.cards[idx + 1] : undefined;
    return { rowId, colId, beforeCardId: next ? next.id : null };
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
        dragged.fromRowId,
        dragged.fromColId,
        dropTarget,
      );
    }
    draggedRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
    setGhostPos(null);
  }

  const draggingCard = draggingId
    ? board.rows
        .flatMap((row) => row.columns)
        .flatMap((col) => col.cards)
        .find((card) => card.id === draggingId)
    : null;

  return (
    <section className="kanban-wrap">
      <div className={`kanban-rows${draggingId ? " dragging" : ""}`}>
        {board.rows.map((row) => (
          <section key={row.id} data-row-id={row.id} className="kanban-row">
            <header className="kanban-row-header">
              <input
                className="kanban-row-title"
                value={row.title}
                placeholder="Row 이름"
                onChange={(e) => setRowTitle(row.id, e.target.value)}
              />
            </header>

            {row.preface && <p className="kanban-row-preface">{row.preface}</p>}

            <div className="kanban-board">
              {row.columns.map((col) => {
                const isDropCol =
                  dropTarget?.rowId === row.id && dropTarget?.colId === col.id;
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
                        onChange={(e) =>
                          setColumnTitle(row.id, col.id, e.target.value)
                        }
                      />
                      <span className="kanban-col-count">{col.cards.length}</span>
                      <button
                        className="kanban-col-delete"
                        title="컬럼 삭제"
                        onClick={() => deleteColumn(row.id, col.id)}
                      >
                        ×
                      </button>
                    </header>

                    {col.note && <p className="kanban-col-note">{col.note}</p>}

                    <ul
                      className={`kanban-cards${
                        isDropCol && dropTarget?.beforeCardId === null
                          ? " drop-end"
                          : ""
                      }`}
                    >
                      {col.cards.map((card) => (
                        <KanbanCardItem
                          key={card.id}
                          card={card}
                          isDragging={draggingId === card.id}
                          isDropBefore={
                            isDropCol && dropTarget?.beforeCardId === card.id
                          }
                          autoFocus={card.id === justAddedId}
                          onToggle={() => toggleCard(row.id, col.id, card.id)}
                          onTextChange={(t) =>
                            setCardText(row.id, col.id, card.id, t)
                          }
                          onDelete={() => deleteCard(row.id, col.id, card.id)}
                          onEnter={() => addCard(row.id, col.id)}
                          onFocusText={() => setJustAddedId(null)}
                          onDragStart={() => startDrag(card.id, row.id, col.id)}
                          onDragMove={moveDrag}
                          onDragEnd={endDrag}
                        />
                      ))}
                    </ul>

                    <button
                      className="kanban-add-card"
                      onClick={() => addCard(row.id, col.id)}
                    >
                      + 카드 추가
                    </button>
                  </section>
                );
              })}

              <button className="kanban-add-column" onClick={() => addColumn(row.id)}>
                + 컬럼
              </button>
            </div>
          </section>
        ))}

        <button className="kanban-add-row" onClick={addRow}>
          + Row
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
      </div>

      {card.children.length > 0 && (
        <ul className="kanban-subitems">
          {card.children.map((child) => (
            <Subitem key={child.id} item={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Subitem({ item }: { item: KanbanSubitem }) {
  return (
    <li className={`kanban-subitem${item.done ? " done" : ""}`}>
      <span className="kanban-subitem-check">{item.done ? "✓" : "□"}</span>
      <span className="kanban-subitem-text">{item.text}</span>
      {item.children.length > 0 && (
        <ul className="kanban-subitems nested">
          {item.children.map((child) => (
            <Subitem key={child.id} item={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default memo(KanbanBoard);
