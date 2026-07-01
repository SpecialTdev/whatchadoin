import { useRef, useState } from "react";
import {
  applyDrop,
  findCard,
  findSubitemLocation,
  getSubitemSiblings,
  isInvalidDropTarget,
  sameTarget,
  type DragSource,
  type DropTarget,
  type KanbanBoard as Board,
  type KanbanRow,
} from "../../lib/kanban";

export function useKanbanDrag(
  board: Board,
  commit: (next: Board) => void,
) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const draggedRef = useRef<DragSource | null>(null);

  function startCardDrag(cardId: string, fromRowId: string, fromColId: string) {
    draggedRef.current = { kind: "card", cardId, fromRowId, fromColId };
    setDraggingId(cardId);
  }

  function startColumnDrag(colId: string, fromRowId: string) {
    draggedRef.current = { kind: "column", colId, fromRowId };
    setDraggingId(colId);
  }

  function startSubitemDrag(subitemId: string) {
    draggedRef.current = { kind: "subitem", subitemId };
    setDraggingId(subitemId);
  }

  function findRow(rowId: string): KanbanRow | undefined {
    return board.rows.find((row) => row.id === rowId);
  }

  function computeCardTarget(
    rowId: string,
    colId: string,
    cardId: string,
    y: number,
  ): Extract<DropTarget, { kind: "card" }> {
    const card = document.querySelector(`[data-card-id="${cardId}"]`) as HTMLElement | null;
    const rect = card?.getBoundingClientRect();
    if (rect && y <= rect.top + rect.height / 2) {
      return { kind: "card", rowId, colId, beforeCardId: cardId };
    }
    const col = findRow(rowId)?.columns.find((c) => c.id === colId);
    const idx = col ? col.cards.findIndex((c) => c.id === cardId) : -1;
    const next = col && idx >= 0 ? col.cards[idx + 1] : undefined;
    return { kind: "card", rowId, colId, beforeCardId: next ? next.id : null };
  }

  function computeColumnTarget(
    rowId: string,
    colId: string | null,
    x: number,
  ): Extract<DropTarget, { kind: "column" }> {
    const row = findRow(rowId);
    if (!colId) {
      const firstCol = row?.columns[0];
      const firstColId = firstCol?.id;
      const firstColEl = firstCol
        ? (document.querySelector(`[data-col-id="${firstCol.id}"]`) as HTMLElement | null)
        : null;
      const firstRect = firstColEl?.getBoundingClientRect();
      if (firstColId && firstRect && x <= firstRect.left + firstRect.width / 2) {
        return { kind: "column", rowId, beforeColId: firstColId };
      }
      return { kind: "column", rowId, beforeColId: null };
    }

    const colEl = document.querySelector(`[data-col-id="${colId}"]`) as HTMLElement | null;
    const rect = colEl?.getBoundingClientRect();
    if (rect && x <= rect.left + rect.width / 2) {
      return { kind: "column", rowId, beforeColId: colId };
    }

    const idx = row ? row.columns.findIndex((col) => col.id === colId) : -1;
    const next = row && idx >= 0 ? row.columns[idx + 1] : undefined;
    return { kind: "column", rowId, beforeColId: next ? next.id : null };
  }

  function computeDropTarget(x: number, y: number): DropTarget | null {
    const dragged = draggedRef.current;
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const rowEl = el?.closest("[data-row-id]") as HTMLElement | null;
    const colEl = el?.closest("[data-col-id]") as HTMLElement | null;
    if (!rowEl) return null;

    const rowId = rowEl.getAttribute("data-row-id")!;
    const colId = colEl?.getAttribute("data-col-id") ?? null;
    if (dragged?.kind === "column") return computeColumnTarget(rowId, colId, x);
    if (!colId) return null;

    const subitemEl = el?.closest("[data-subitem-id]") as HTMLElement | null;
    const cardEl = el?.closest("[data-card-id]") as HTMLElement | null;

    if (subitemEl && cardEl) {
      const cardId = cardEl.getAttribute("data-card-id")!;
      const cardRect = cardEl.getBoundingClientRect();
      if (x < cardRect.left + 44) return computeCardTarget(rowId, colId, cardId, y);

      const subitemId = subitemEl.getAttribute("data-subitem-id")!;
      const location = findSubitemLocation(board, subitemId);
      if (location) {
        const rect = subitemEl.getBoundingClientRect();
        const isAfter = y > rect.top + rect.height / 2;
        const siblings = getSubitemSiblings(board, location);
        const next = siblings[location.index + 1];
        return {
          kind: "subitem",
          rowId,
          colId,
          cardId: location.cardId,
          parentSubitemId: location.parentSubitemId,
          beforeSubitemId: isAfter ? next?.id ?? null : subitemId,
        };
      }
    }

    if (!cardEl) return { kind: "card", rowId, colId, beforeCardId: null };

    const cardId = cardEl.getAttribute("data-card-id")!;
    const rect = cardEl.getBoundingClientRect();
    const preferParent = x < rect.left + 44;
    if (preferParent) return computeCardTarget(rowId, colId, cardId, y);

    return {
      kind: "subitem",
      rowId,
      colId,
      cardId,
      parentSubitemId: null,
      beforeSubitemId: null,
    };
  }

  function moveDrag(x: number, y: number) {
    const dragged = draggedRef.current;
    if (!dragged) return;
    setGhostPos({ x, y });
    const computed = computeDropTarget(x, y);
    const next =
      computed && !isInvalidDropTarget(board, dragged, computed) ? computed : null;
    setDropTarget((prev) => (sameTarget(prev, next) ? prev : next));
  }

  function endDrag() {
    const dragged = draggedRef.current;
    if (dragged && dropTarget) {
      const next = applyDrop(board, dragged, dropTarget);
      if (next !== board) commit(next);
    }
    draggedRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
    setGhostPos(null);
  }

  const draggingText = draggingId
    ? findCard(board, draggingId)?.text ??
      board.rows
        .flatMap((row) => row.columns)
        .find((col) => col.id === draggingId)?.title ??
      findSubitemLocation(board, draggingId)?.item.text ??
      null
    : null;

  return {
    draggingId,
    draggingText,
    dropTarget,
    endDrag,
    ghostPos,
    moveDrag,
    startCardDrag,
    startColumnDrag,
    startSubitemDrag,
  };
}
