import {
  memo,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  type CardDropTarget,
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

type FocusRequest =
  | { kind: "card"; id: string }
  | { kind: "subitem"; id: string }
  | null;

type DragSource =
  | { kind: "card"; cardId: string; fromRowId: string; fromColId: string }
  | { kind: "subitem"; subitemId: string };

type DropTarget =
  | ({ kind: "card" } & CardDropTarget)
  | {
      kind: "subitem";
      rowId: string;
      colId: string;
      cardId: string;
      parentSubitemId: string | null;
      beforeSubitemId: string | null;
    };

interface SubitemLocation {
  rowId: string;
  colId: string;
  cardId: string;
  parentSubitemId: string | null;
  index: number;
  depth: number;
  item: KanbanSubitem;
}

function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
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

function findSubitemLocation(board: Board, subitemId: string): SubitemLocation | null {
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

function updateSubitem(board: Board, subitemId: string, patch: Partial<KanbanSubitem>): Board {
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

function removeSubitem(board: Board, subitemId: string): { board: Board; item: KanbanSubitem | null } {
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

function insertSubitem(board: Board, target: Extract<DropTarget, { kind: "subitem" }>, item: KanbanSubitem): Board {
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

function isInvalidDropTarget(board: Board, source: DragSource, target: DropTarget): boolean {
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

function findCard(board: Board, cardId: string): KanbanCard | null {
  for (const row of board.rows) {
    for (const col of row.columns) {
      const card = col.cards.find((item) => item.id === cardId);
      if (card) return card;
    }
  }
  return null;
}

function removeCard(board: Board, cardId: string): { board: Board; card: KanbanCard | null } {
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

function insertCard(board: Board, target: Extract<DropTarget, { kind: "card" }>, card: KanbanCard): Board {
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

function insertCardAfter(board: Board, rowId: string, colId: string, afterCardId: string, card: KanbanCard): Board {
  const row = board.rows.find((item) => item.id === rowId);
  const col = row?.columns.find((item) => item.id === colId);
  const idx = col ? col.cards.findIndex((item) => item.id === afterCardId) : -1;
  const beforeCardId = col && idx >= 0 ? col.cards[idx + 1]?.id ?? null : null;
  return insertCard(board, { kind: "card", rowId, colId, beforeCardId }, card);
}

function findCardLocation(board: Board, cardId: string): { rowId: string; colId: string; index: number } | null {
  for (const row of board.rows) {
    for (const col of row.columns) {
      const index = col.cards.findIndex((card) => card.id === cardId);
      if (index >= 0) return { rowId: row.id, colId: col.id, index };
    }
  }
  return null;
}

function getSubitemSiblings(
  board: Board,
  location: SubitemLocation,
): KanbanSubitem[] {
  const card = findCard(board, location.cardId);
  if (!card) return [];
  if (location.parentSubitemId === null) return card.children;
  const parent = findSubitemLocation(board, location.parentSubitemId)?.item;
  return parent?.children ?? [];
}

function indentCard(board: Board, cardId: string): { board: Board; focus: FocusRequest } {
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

function indentSubitem(board: Board, subitemId: string): { board: Board; focus: FocusRequest } {
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

function outdentSubitem(board: Board, subitemId: string): { board: Board; focus: FocusRequest } {
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

function addSubitemAfter(board: Board, subitemId: string): { board: Board; focus: FocusRequest } {
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

function applyDrop(board: Board, source: DragSource, target: DropTarget): Board {
  if (isInvalidDropTarget(board, source, target)) return board;

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

function KanbanBoard({ markdown, onChange }: Props) {
  const [board, setBoard] = useState<Board>(() => parseMarkdown(markdown));

  // 우리가 직접 직렬화해 내보낸 마크다운인지 추적해, 외부(note) 편집만 re-parse.
  const lastSerialized = useRef<string>(markdown);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest>(null);

  const draggedRef = useRef<DragSource | null>(null);

  useEffect(() => {
    if (markdown !== lastSerialized.current) {
      setBoard(parseMarkdown(markdown));
      lastSerialized.current = markdown;
    }
  }, [markdown]);

  function commit(next: Board, focus: FocusRequest = null) {
    setBoard(next);
    if (focus) setFocusRequest(focus);
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

  // ----- subitem ops -----
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
    const result = shiftKey ? outdentSubitem(board, subitemId) : indentSubitem(board, subitemId);
    if (result.board !== board) commit(result.board, result.focus);
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
  function startCardDrag(cardId: string, fromRowId: string, fromColId: string) {
    draggedRef.current = { kind: "card", cardId, fromRowId, fromColId };
    setDraggingId(cardId);
  }

  function startSubitemDrag(subitemId: string) {
    draggedRef.current = { kind: "subitem", subitemId };
    setDraggingId(subitemId);
  }

  function findRow(rowId: string): KanbanRow | undefined {
    return board.rows.find((row) => row.id === rowId);
  }

  function computeCardTarget(rowId: string, colId: string, cardId: string, y: number): Extract<DropTarget, { kind: "card" }> {
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

  function computeDropTarget(x: number, y: number): DropTarget | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const rowEl = el?.closest("[data-row-id]") as HTMLElement | null;
    const colEl = el?.closest("[data-col-id]") as HTMLElement | null;
    if (!rowEl || !colEl) return null;

    const rowId = rowEl.getAttribute("data-row-id")!;
    const colId = colEl.getAttribute("data-col-id")!;
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
      findSubitemLocation(board, draggingId)?.item.text ??
      null
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
                          onDragStart={() => startCardDrag(card.id, row.id, col.id)}
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

interface CardItemProps {
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
}

function KanbanCardItem({
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
            <Subitem
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
            />
          ))}
        </ul>
      )}
    </li>
  );
}

interface SubitemProps {
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
}

function Subitem({
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
    }
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
            <Subitem
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
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default memo(KanbanBoard);
