import { useEffect, useRef, useState } from "react";
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
}

interface DropTarget {
  colId: string;
  beforeCardId: string | null;
}

function KanbanBoard({ markdown, onChange }: Props) {
  const [board, setBoard] = useState<Board>(() => parseMarkdown(markdown));

  // 우리가 직접 직렬화해 내보낸 마크다운인지 추적해, 외부(note 모드) 편집만 re-parse.
  const lastSerialized = useRef<string>(markdown);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
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
    setEditingId(card.id);
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

  // ----- drag & drop -----
  function onDragStart(cardId: string, fromColId: string) {
    draggedRef.current = { cardId, fromColId };
    setDraggingId(cardId);
  }

  function onDragEnd() {
    draggedRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
  }

  function onDropInColumn(colId: string) {
    const dragged = draggedRef.current;
    if (dragged) {
      const before =
        dropTarget && dropTarget.colId === colId ? dropTarget.beforeCardId : null;
      moveCard(dragged.cardId, dragged.fromColId, colId, before);
    }
    onDragEnd();
  }

  const boardTitle = board.preamble.match(/^#\s+(.*)$/m)?.[1]?.trim();

  return (
    <section className="kanban-wrap">
      {boardTitle && <p className="kanban-board-title">{boardTitle}</p>}

      <div className="kanban-board">
        {board.columns.map((col) => {
          const isDragOverCol = dropTarget?.colId === col.id;
          return (
            <section
              key={col.id}
              className={`kanban-column${isDragOverCol ? " drag-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (!dropTarget || dropTarget.colId !== col.id) {
                  setDropTarget({ colId: col.id, beforeCardId: null });
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDropInColumn(col.id);
              }}
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

              <ul className="kanban-cards">
                {col.cards.map((card) => {
                  const isDropBefore =
                    dropTarget?.colId === col.id &&
                    dropTarget.beforeCardId === card.id;
                  return (
                    <li
                      key={card.id}
                      className={
                        "kanban-card" +
                        (card.done ? " done" : "") +
                        (draggingId === card.id ? " dragging" : "") +
                        (isDropBefore ? " drop-before" : "")
                      }
                      draggable={editingId !== card.id}
                      onDragStart={() => onDragStart(card.id, col.id)}
                      onDragEnd={onDragEnd}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (
                          !dropTarget ||
                          dropTarget.colId !== col.id ||
                          dropTarget.beforeCardId !== card.id
                        ) {
                          setDropTarget({ colId: col.id, beforeCardId: card.id });
                        }
                      }}
                    >
                      <input
                        type="checkbox"
                        className="kanban-card-check"
                        checked={card.done}
                        onChange={() => toggleCard(col.id, card.id)}
                      />
                      <input
                        className="kanban-card-text"
                        value={card.text}
                        placeholder="할 일 입력…"
                        autoFocus={card.id === justAddedId}
                        onFocus={() => setEditingId(card.id)}
                        onBlur={() => {
                          setEditingId(null);
                          setJustAddedId(null);
                        }}
                        onChange={(e) => setCardText(col.id, card.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            e.currentTarget.blur();
                            addCard(col.id);
                          }
                        }}
                      />
                      <button
                        className="kanban-card-delete"
                        title="카드 삭제"
                        onClick={() => deleteCard(col.id, card.id)}
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
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
    </section>
  );
}

export default KanbanBoard;
