import { memo } from "react";
import {
  addSubitemAfter,
  indentCard,
  indentSubitem,
  insertCardAfter,
  type KanbanCard,
  type KanbanColumn,
  type KanbanRow,
  newCard,
  newColumn,
  newRow,
  outdentSubitem,
  removeSubitem,
  updateSubitem,
} from "../../lib/kanban";
import { KanbanCardItem } from "./KanbanCardItem";
import { useKanbanBoardState } from "./useKanbanBoardState";
import { useKanbanDrag } from "./useKanbanDrag";
import { useKanbanKeyboardNavigation } from "./useKanbanKeyboardNavigation";
import "./KanbanBoard.css";

interface Props {
  /** source of truth: markdown todo note */
  markdown: string;
  onChange: (markdown: string) => void;
}

function KanbanBoard({ markdown, onChange }: Props) {
  const { board, commit, focusRequest, setFocusRequest } =
    useKanbanBoardState(markdown, onChange);

  const {
    draggingId,
    draggingText,
    dropTarget,
    endDrag,
    ghostPos,
    moveDrag,
    startCardDrag,
    startColumnDrag,
    startSubitemDrag,
  } = useKanbanDrag(board, commit);
  const { handleArrowNavigation } = useKanbanKeyboardNavigation();

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

  function addCard(rowId: string, colId: string, afterCardId?: string) {
    const card = newCard();
    if (!afterCardId) {
      mapCardsIn(rowId, colId, (cards) => [...cards, card]);
      setFocusRequest({ kind: "card", id: card.id });
      return;
    }
    commit(insertCardAfter(board, rowId, colId, afterCardId, card), {
      kind: "card",
      id: card.id,
    });
  }

  function handleCardTab(cardId: string) {
    const result = indentCard(board, cardId);
    if (result.board !== board) commit(result.board, result.focus);
  }

  function toggleSubitem(subitemId: string, done: boolean) {
    commit(updateSubitem(board, subitemId, { done }));
  }

  function setSubitemText(subitemId: string, text: string) {
    commit(updateSubitem(board, subitemId, { text }));
  }

  function deleteSubitem(subitemId: string) {
    const result = removeSubitem(board, subitemId);
    if (result.item) commit(result.board);
  }

  function handleSubitemEnter(subitemId: string) {
    const result = addSubitemAfter(board, subitemId);
    if (result.board !== board) commit(result.board, result.focus);
  }

  function handleSubitemTab(subitemId: string, shiftKey: boolean) {
    const result = shiftKey
      ? outdentSubitem(board, subitemId)
      : indentSubitem(board, subitemId);
    if (result.board !== board) commit(result.board, result.focus);
  }

  function setRowTitle(rowId: string, title: string) {
    mapRows((row) => (row.id === rowId ? { ...row, title } : row));
  }

  function addRow() {
    commit({ ...board, rows: [...board.rows, newRow()] });
  }

  function deleteRow(rowId: string) {
    commit({ ...board, rows: board.rows.filter((row) => row.id !== rowId) });
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

  return (
    <section className="kanban-wrap">
      <div className={`kanban-rows${draggingId ? " dragging" : ""}`}>
        {board.rows.map((row) => {
          const isColumnDropEnd =
            dropTarget?.kind === "column" &&
            dropTarget.rowId === row.id &&
            dropTarget.beforeColId === null;

          return (
            <section key={row.id} data-row-id={row.id} className="kanban-row">
              <header className="kanban-row-header">
                <input
                  className="kanban-row-title"
                  value={row.title}
                  placeholder="Row 이름"
                  onChange={(e) => setRowTitle(row.id, e.target.value)}
                />
                <button
                  className="kanban-row-delete"
                  title="Row 삭제"
                  onClick={() => deleteRow(row.id)}
                >
                  ×
                </button>
              </header>

              {row.preface && <p className="kanban-row-preface">{row.preface}</p>}

              <div className="kanban-board">
                {row.columns.map((col) => {
                  const isDropCol =
                    (dropTarget?.kind === "card" ||
                      dropTarget?.kind === "subitem") &&
                    dropTarget?.rowId === row.id &&
                    dropTarget?.colId === col.id;
                  const isColumnDropBefore =
                    dropTarget?.kind === "column" &&
                    dropTarget.rowId === row.id &&
                    dropTarget.beforeColId === col.id;
                  return (
                    <section
                      key={col.id}
                      data-col-id={col.id}
                      className={
                        `kanban-column${isDropCol ? " drag-over" : ""}` +
                        `${draggingId === col.id ? " dragging" : ""}` +
                        `${isColumnDropBefore ? " column-drop-before" : ""}`
                      }
                    >
                      <header className="kanban-col-header">
                        <span
                          className="kanban-col-handle"
                          title="드래그해 컬럼 이동"
                          onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            e.preventDefault();
                            e.currentTarget.setPointerCapture(e.pointerId);
                            startColumnDrag(col.id, row.id);
                          }}
                          onPointerMove={(e) => moveDrag(e.clientX, e.clientY)}
                          onPointerUp={(e) => {
                            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                              e.currentTarget.releasePointerCapture(e.pointerId);
                            }
                            endDrag();
                          }}
                          onPointerCancel={(e) => {
                            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                              e.currentTarget.releasePointerCapture(e.pointerId);
                            }
                            endDrag();
                          }}
                        >
                          ⠿
                        </span>
                        <input
                          data-kanban-focus="column-title"
                          className="kanban-col-title"
                          value={col.title}
                          placeholder="컬럼 이름"
                          onChange={(e) =>
                            setColumnTitle(row.id, col.id, e.target.value)
                          }
                          onKeyDown={handleArrowNavigation}
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
                          isDropCol &&
                          dropTarget?.kind === "card" &&
                          dropTarget.beforeCardId === null
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
                              isDropCol &&
                              dropTarget?.kind === "card" &&
                              dropTarget.beforeCardId === card.id
                            }
                            isSubitemDrop={
                              isDropCol &&
                              dropTarget?.kind === "subitem" &&
                              dropTarget.cardId === card.id &&
                              dropTarget.parentSubitemId === null &&
                              dropTarget.beforeSubitemId === null
                            }
                            focusRequest={focusRequest}
                            onFocusHandled={() => setFocusRequest(null)}
                            onToggle={() => toggleCard(row.id, col.id, card.id)}
                            onTextChange={(t) =>
                              setCardText(row.id, col.id, card.id, t)
                            }
                            onDelete={() => deleteCard(row.id, col.id, card.id)}
                            onEnter={() => addCard(row.id, col.id, card.id)}
                            onTab={() => handleCardTab(card.id)}
                            onDragStart={() =>
                              startCardDrag(card.id, row.id, col.id)
                            }
                            onDragMove={moveDrag}
                            onDragEnd={endDrag}
                            draggingId={draggingId}
                            dropTarget={dropTarget}
                            onSubitemToggle={toggleSubitem}
                            onSubitemTextChange={setSubitemText}
                            onSubitemDelete={deleteSubitem}
                            onSubitemEnter={handleSubitemEnter}
                            onSubitemTab={handleSubitemTab}
                            onSubitemDragStart={startSubitemDrag}
                            onArrowNavigate={handleArrowNavigation}
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

                <button
                  className={`kanban-add-column${
                    isColumnDropEnd ? " column-drop-before" : ""
                  }`}
                  onClick={() => addColumn(row.id)}
                >
                  + 컬럼
                </button>
              </div>
            </section>
          );
        })}

        <button className="kanban-add-row" onClick={addRow}>
          + Row
        </button>
      </div>

      {draggingText && ghostPos && (
        <div
          className="kanban-drag-ghost"
          style={{ left: ghostPos.x + 12, top: ghostPos.y + 8 }}
        >
          {draggingText || "할 일"}
        </div>
      )}
    </section>
  );
}

export default memo(KanbanBoard);
