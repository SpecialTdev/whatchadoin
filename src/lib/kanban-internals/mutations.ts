import type {
  DragSource,
  DropTarget,
  FocusRequest,
  KanbanBoard as Board,
  KanbanCard,
  KanbanColumn,
  KanbanSubitem,
  SubitemLocation,
} from "./model";
import { moveCard as moveCardInBoard } from "./markdown";

export function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function cardToSubitem(card: KanbanCard): KanbanSubitem {
  return {
    id: `sub-${card.id}`,
    text: card.text,
    done: card.done,
    children: card.children,
  };
}

function subitemToCard(item: KanbanSubitem): KanbanCard {
  return {
    id: `card-${item.id}`,
    text: item.text,
    done: item.done,
    children: item.children,
  };
}

function cloneSubitem(item: KanbanSubitem): KanbanSubitem {
  return { ...item, children: item.children.map(cloneSubitem) };
}

function cloneCard(card: KanbanCard): KanbanCard {
  return { ...card, children: card.children.map(cloneSubitem) };
}

function findSubitemInList(
  items: KanbanSubitem[],
  id: string,
  context: Omit<SubitemLocation, "index" | "item" | "parentSubitemId" | "depth">,
  parentSubitemId: string | null,
  depth: number,
): SubitemLocation | null {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.id === id) return { ...context, parentSubitemId, index, depth, item };
    const found = findSubitemInList(
      item.children,
      id,
      context,
      item.id,
      depth + 1,
    );
    if (found) return found;
  }
  return null;
}

export function findSubitemLocation(board: Board, subitemId: string): SubitemLocation | null {
  for (const row of board.rows) {
    for (const col of row.columns) {
      for (const card of col.cards) {
        const found = findSubitemInList(
          card.children,
          subitemId,
          { rowId: row.id, colId: col.id, cardId: card.id },
          null,
          1,
        );
        if (found) return found;
      }
    }
  }
  return null;
}

function mapSubitems(
  items: KanbanSubitem[],
  fn: (item: KanbanSubitem) => KanbanSubitem,
): KanbanSubitem[] {
  return items.map((item) => fn({ ...item, children: mapSubitems(item.children, fn) }));
}

export function updateSubitem(board: Board, subitemId: string, patch: Partial<KanbanSubitem>): Board {
  return {
    ...board,
    rows: board.rows.map((row) => ({
      ...row,
      columns: row.columns.map((col) => ({
        ...col,
        cards: col.cards.map((card) => ({
          ...card,
          children: mapSubitems(card.children, (item) =>
            item.id === subitemId ? { ...item, ...patch } : item,
          ),
        })),
      })),
    })),
  };
}

function removeSubitemFromList(
  items: KanbanSubitem[],
  subitemId: string,
): { items: KanbanSubitem[]; removed: KanbanSubitem | null } {
  let removed: KanbanSubitem | null = null;
  const next: KanbanSubitem[] = [];

  for (const item of items) {
    if (item.id === subitemId) {
      removed = cloneSubitem(item);
      continue;
    }
    const childResult = removeSubitemFromList(item.children, subitemId);
    if (childResult.removed) removed = childResult.removed;
    next.push({ ...item, children: childResult.items });
  }

  return { items: next, removed };
}

export function removeSubitem(board: Board, subitemId: string): { board: Board; item: KanbanSubitem | null } {
  let removed: KanbanSubitem | null = null;
  const rows = board.rows.map((row) => ({
    ...row,
    columns: row.columns.map((col) => ({
      ...col,
      cards: col.cards.map((card) => {
        const result = removeSubitemFromList(card.children, subitemId);
        if (result.removed) removed = result.removed;
        return { ...card, children: result.items };
      }),
    })),
  }));
  return { board: { ...board, rows }, item: removed };
}

function insertSubitemInList(
  items: KanbanSubitem[],
  parentSubitemId: string | null,
  beforeSubitemId: string | null,
  item: KanbanSubitem,
): { items: KanbanSubitem[]; inserted: boolean } {
  if (parentSubitemId === null) {
    const next = [...items];
    const idx =
      beforeSubitemId === null
        ? next.length
        : next.findIndex((child) => child.id === beforeSubitemId);
    next.splice(idx === -1 ? next.length : idx, 0, item);
    return { items: next, inserted: true };
  }

  let inserted = false;
  const next = items.map((child) => {
    if (child.id === parentSubitemId) {
      const children = [...child.children];
      const idx =
        beforeSubitemId === null
          ? children.length
          : children.findIndex((grandchild) => grandchild.id === beforeSubitemId);
      children.splice(idx === -1 ? children.length : idx, 0, item);
      inserted = true;
      return { ...child, children };
    }
    const result = insertSubitemInList(
      child.children,
      parentSubitemId,
      beforeSubitemId,
      item,
    );
    if (result.inserted) inserted = true;
    return { ...child, children: result.items };
  });
  return { items: next, inserted };
}

export function insertSubitem(board: Board, target: Extract<DropTarget, { kind: "subitem" }>, item: KanbanSubitem): Board {
  let inserted = false;
  const rows = board.rows.map((row) =>
    row.id !== target.rowId
      ? row
      : {
          ...row,
          columns: row.columns.map((col) =>
            col.id !== target.colId
              ? col
              : {
                  ...col,
                  cards: col.cards.map((card) => {
                    if (card.id !== target.cardId) return card;
                    const result = insertSubitemInList(
                      card.children,
                      target.parentSubitemId,
                      target.beforeSubitemId,
                      item,
                    );
                    if (result.inserted) inserted = true;
                    return { ...card, children: result.items };
                  }),
                },
          ),
        },
  );
  return inserted ? { ...board, rows } : board;
}

function isDescendant(item: KanbanSubitem, id: string): boolean {
  return item.children.some((child) => child.id === id || isDescendant(child, id));
}

function isSelfOrDescendant(board: Board, sourceSubitemId: string, targetParentSubitemId: string | null): boolean {
  if (!targetParentSubitemId) return false;
  if (sourceSubitemId === targetParentSubitemId) return true;
  const source = findSubitemLocation(board, sourceSubitemId)?.item;
  return source ? isDescendant(source, targetParentSubitemId) : false;
}

export function isInvalidDropTarget(board: Board, source: DragSource, target: DropTarget): boolean {
  if (source.kind === "column") {
    return target.kind !== "column" || source.colId === target.beforeColId;
  }
  if (target.kind === "column") return true;

  if (source.kind === "card" && target.kind === "subitem") {
    return source.cardId === target.cardId;
  }
  if (source.kind === "subitem" && target.kind === "subitem") {
    return (
      isSelfOrDescendant(board, source.subitemId, target.parentSubitemId) ||
      source.subitemId === target.beforeSubitemId
    );
  }
  return false;
}

export function findCard(board: Board, cardId: string): KanbanCard | null {
  for (const row of board.rows) {
    for (const col of row.columns) {
      const card = col.cards.find((item) => item.id === cardId);
      if (card) return card;
    }
  }
  return null;
}

export function moveColumn(
  board: Board,
  colId: string,
  fromRowId: string,
  target: Extract<DropTarget, { kind: "column" }>,
): Board {
  const fromRow = board.rows.find((row) => row.id === fromRowId);
  const sourceIndex = fromRow?.columns.findIndex((col) => col.id === colId) ?? -1;
  if (!fromRow || sourceIndex < 0) return board;

  const nextSourceColId = fromRow.columns[sourceIndex + 1]?.id ?? null;
  if (
    fromRowId === target.rowId &&
    (target.beforeColId === colId || target.beforeColId === nextSourceColId)
  ) {
    return board;
  }

  let moved: KanbanColumn | null = null;
  const strippedRows = board.rows.map((row) => {
    if (row.id !== fromRowId) return row;
    return {
      ...row,
      columns: row.columns.filter((col) => {
        if (col.id !== colId) return true;
        moved = col;
        return false;
      }),
    };
  });

  if (!moved) return board;

  let inserted = false;
  const rows = strippedRows.map((row) => {
    if (row.id !== target.rowId) return row;
    const columns = [...row.columns];
    const idx =
      target.beforeColId === null
        ? columns.length
        : columns.findIndex((col) => col.id === target.beforeColId);
    columns.splice(idx === -1 ? columns.length : idx, 0, moved!);
    inserted = true;
    return { ...row, columns };
  });

  return inserted ? { ...board, rows } : board;
}

export function removeCard(board: Board, cardId: string): { board: Board; card: KanbanCard | null } {
  let removed: KanbanCard | null = null;
  const rows = board.rows.map((row) => ({
    ...row,
    columns: row.columns.map((col) => ({
      ...col,
      cards: col.cards.filter((card) => {
        if (card.id !== cardId) return true;
        removed = cloneCard(card);
        return false;
      }),
    })),
  }));
  return { board: { ...board, rows }, card: removed };
}

export function insertCard(board: Board, target: Extract<DropTarget, { kind: "card" }>, card: KanbanCard): Board {
  let inserted = false;
  const rows = board.rows.map((row) =>
    row.id !== target.rowId
      ? row
      : {
          ...row,
          columns: row.columns.map((col) => {
            if (col.id !== target.colId) return col;
            const cards = [...col.cards];
            const idx =
              target.beforeCardId === null
                ? cards.length
                : cards.findIndex((item) => item.id === target.beforeCardId);
            cards.splice(idx === -1 ? cards.length : idx, 0, card);
            inserted = true;
            return { ...col, cards };
          }),
        },
  );
  return inserted ? { ...board, rows } : board;
}

export function insertCardAfter(board: Board, rowId: string, colId: string, afterCardId: string, card: KanbanCard): Board {
  const row = board.rows.find((item) => item.id === rowId);
  const col = row?.columns.find((item) => item.id === colId);
  const idx = col ? col.cards.findIndex((item) => item.id === afterCardId) : -1;
  const beforeCardId = col && idx >= 0 ? col.cards[idx + 1]?.id ?? null : null;
  return insertCard(board, { kind: "card", rowId, colId, beforeCardId }, card);
}

export function findCardLocation(board: Board, cardId: string): { rowId: string; colId: string; index: number } | null {
  for (const row of board.rows) {
    for (const col of row.columns) {
      const index = col.cards.findIndex((card) => card.id === cardId);
      if (index >= 0) return { rowId: row.id, colId: col.id, index };
    }
  }
  return null;
}

export function getSubitemSiblings(
  board: Board,
  location: SubitemLocation,
): KanbanSubitem[] {
  const card = findCard(board, location.cardId);
  if (!card) return [];
  if (location.parentSubitemId === null) return card.children;
  const parent = findSubitemLocation(board, location.parentSubitemId)?.item;
  return parent?.children ?? [];
}

export function indentCard(board: Board, cardId: string): { board: Board; focus: FocusRequest } {
  const location = findCardLocation(board, cardId);
  if (!location) return { board, focus: null };
  const row = board.rows.find((item) => item.id === location.rowId);
  const col = row?.columns.find((item) => item.id === location.colId);
  const previous = col?.cards[location.index - 1];
  if (!previous) return { board, focus: null };

  const removed = removeCard(board, cardId);
  if (!removed.card) return { board, focus: null };

  const subitem = cardToSubitem(removed.card);
  const target: Extract<DropTarget, { kind: "subitem" }> = {
    kind: "subitem",
    rowId: location.rowId,
    colId: location.colId,
    cardId: previous.id,
    parentSubitemId: null,
    beforeSubitemId: null,
  };
  return { board: insertSubitem(removed.board, target, subitem), focus: { kind: "subitem", id: subitem.id } };
}

export function indentSubitem(board: Board, subitemId: string): { board: Board; focus: FocusRequest } {
  const location = findSubitemLocation(board, subitemId);
  if (!location) return { board, focus: null };
  const siblings = getSubitemSiblings(board, location);
  const previous = siblings[location.index - 1];
  if (!previous) return { board, focus: null };

  const removed = removeSubitem(board, subitemId);
  if (!removed.item) return { board, focus: null };
  const target: Extract<DropTarget, { kind: "subitem" }> = {
    kind: "subitem",
    rowId: location.rowId,
    colId: location.colId,
    cardId: location.cardId,
    parentSubitemId: previous.id,
    beforeSubitemId: null,
  };
  return { board: insertSubitem(removed.board, target, removed.item), focus: { kind: "subitem", id: removed.item.id } };
}

export function outdentSubitem(board: Board, subitemId: string): { board: Board; focus: FocusRequest } {
  const location = findSubitemLocation(board, subitemId);
  if (!location) return { board, focus: null };
  const removed = removeSubitem(board, subitemId);
  if (!removed.item) return { board, focus: null };

  if (location.parentSubitemId === null) {
    const card = subitemToCard(removed.item);
    return {
      board: insertCardAfter(removed.board, location.rowId, location.colId, location.cardId, card),
      focus: { kind: "card", id: card.id },
    };
  }

  const parentLocation = findSubitemLocation(removed.board, location.parentSubitemId);
  if (!parentLocation) return { board, focus: null };
  const siblings = getSubitemSiblings(removed.board, parentLocation);
  const beforeSubitemId = siblings[parentLocation.index + 1]?.id ?? null;
  const target: Extract<DropTarget, { kind: "subitem" }> = {
    kind: "subitem",
    rowId: parentLocation.rowId,
    colId: parentLocation.colId,
    cardId: parentLocation.cardId,
    parentSubitemId: parentLocation.parentSubitemId,
    beforeSubitemId,
  };
  return { board: insertSubitem(removed.board, target, removed.item), focus: { kind: "subitem", id: removed.item.id } };
}

export function addSubitemAfter(board: Board, subitemId: string): { board: Board; focus: FocusRequest } {
  const location = findSubitemLocation(board, subitemId);
  if (!location) return { board, focus: null };
  const siblings = getSubitemSiblings(board, location);
  const item = newSubitem();
  const target: Extract<DropTarget, { kind: "subitem" }> = {
    kind: "subitem",
    rowId: location.rowId,
    colId: location.colId,
    cardId: location.cardId,
    parentSubitemId: location.parentSubitemId,
    beforeSubitemId: siblings[location.index + 1]?.id ?? null,
  };
  return { board: insertSubitem(board, target, item), focus: { kind: "subitem", id: item.id } };
}

function newSubitem(text = ""): KanbanSubitem {
  return { id: `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, text, done: false, children: [] };
}

export function applyDrop(board: Board, source: DragSource, target: DropTarget): Board {
  if (isInvalidDropTarget(board, source, target)) return board;

  if (source.kind === "column" && target.kind === "column") {
    return moveColumn(board, source.colId, source.fromRowId, target);
  }

  if (source.kind === "card" && target.kind === "card") {
    return moveCardInBoard(
      board,
      source.cardId,
      { rowId: source.fromRowId, colId: source.fromColId },
      target,
    );
  }

  if (source.kind === "card" && target.kind === "subitem") {
    const removed = removeCard(board, source.cardId);
    if (!removed.card) return board;
    return insertSubitem(removed.board, target, cardToSubitem(removed.card));
  }

  if (source.kind === "subitem" && target.kind === "subitem") {
    const removed = removeSubitem(board, source.subitemId);
    if (!removed.item) return board;
    return insertSubitem(removed.board, target, removed.item);
  }

  if (source.kind === "subitem" && target.kind === "card") {
    const removed = removeSubitem(board, source.subitemId);
    if (!removed.item) return board;
    return insertCard(removed.board, target, subitemToCard(removed.item));
  }

  return board;
}
