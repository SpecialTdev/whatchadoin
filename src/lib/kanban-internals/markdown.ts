// Kanban <-> markdown todo note 변환 로직.
//
// 모델: 마크다운 노트가 single source of truth.
//   "# 제목"       -> 칸반 row
//   "## 제목"      -> row 내부 컬럼
//   "- [ ] / [x]"  -> 카드 또는 subitem (indent depth 기준)
//   "- 항목"        -> 카드 또는 subitem (done=false)
//   그 외 자유 텍스트 -> preamble/row preface/column note로 round-trip 보존

import type {
  CardDropTarget,
  KanbanBoard,
  KanbanCard,
  KanbanColumn,
  KanbanRow,
  KanbanSubitem,
} from "./model";

const ROW_RE = /^#\s+(.*)$/;
const COLUMN_RE = /^##\s+(.*)$/;
const LIST_RE = /^(\s*)[-*]\s+(?:\[([ xX])\]\s*)?(.*)$/;
const FENCE_RE = /^\s*```/;
const DEFAULT_ROW_TITLE = "Tasks";

let _seq = 0;
function uid(prefix: string): string {
  _seq += 1;
  return `${prefix}-${_seq.toString(36)}`;
}

/** 배열 앞뒤의 빈 줄 제거 */
function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end);
}

function normalizeTextLines(lines: string[]): string {
  return trimBlankLines(lines).join("\n");
}

function indentDepth(indent: string): number {
  const normalized = indent.replace(/\t/g, "  ");
  return Math.floor(normalized.length / 2);
}

interface PendingSubitem {
  id: string;
  text: string;
  done: boolean;
  children: PendingSubitem[];
}

interface PendingCard {
  id: string;
  text: string;
  done: boolean;
  children: PendingSubitem[];
}

interface PendingColumn {
  id: string;
  title: string;
  cards: PendingCard[];
  note: string[];
}

interface PendingRow {
  id: string;
  title: string;
  columns: PendingColumn[];
  preface: string[];
}

function createPendingRow(title = DEFAULT_ROW_TITLE): PendingRow {
  return { id: uid("row"), title, columns: [], preface: [] };
}

function createPendingColumn(title = "진행 중"): PendingColumn {
  return { id: uid("col"), title, cards: [], note: [] };
}

function toSubitem(item: PendingSubitem): KanbanSubitem {
  return {
    id: item.id,
    text: item.text,
    done: item.done,
    children: item.children.map(toSubitem),
  };
}

function resetStack(stack: Array<PendingCard | PendingSubitem | undefined>): void {
  stack.length = 0;
}

function ensureRow(rows: PendingRow[], current: PendingRow | null): PendingRow {
  if (current) return current;
  const row = createPendingRow();
  rows.push(row);
  return row;
}

function ensureColumn(row: PendingRow, current: PendingColumn | null): PendingColumn {
  if (current) return current;
  const col = createPendingColumn();
  row.columns.push(col);
  return col;
}

export function parseMarkdown(md: string): KanbanBoard {
  const lines = md.split("\n");
  const preamble: string[] = [];
  const rows: PendingRow[] = [];
  const stack: Array<PendingCard | PendingSubitem | undefined> = [];
  let curRow: PendingRow | null = null;
  let curCol: PendingColumn | null = null;
  let inFence = false;

  for (const raw of lines) {
    if (FENCE_RE.test(raw)) inFence = !inFence;

    if (!inFence) {
      const rowMatch = raw.match(ROW_RE);
      if (rowMatch && !raw.startsWith("##")) {
        curRow = createPendingRow(rowMatch[1].trim());
        rows.push(curRow);
        curCol = null;
        resetStack(stack);
        continue;
      }

      const colMatch = raw.match(COLUMN_RE);
      if (colMatch) {
        curRow = ensureRow(rows, curRow);
        curCol = createPendingColumn(colMatch[1].trim());
        curRow.columns.push(curCol);
        resetStack(stack);
        continue;
      }

      const listMatch = raw.match(LIST_RE);
      if (listMatch) {
        curRow = ensureRow(rows, curRow);
        curCol = ensureColumn(curRow, curCol);

        const depth = indentDepth(listMatch[1]);
        const item = {
          id: uid(depth === 0 ? "card" : "sub"),
          done: Boolean(listMatch[2] && listMatch[2].toLowerCase() === "x"),
          text: listMatch[3].trim(),
          children: [],
        };

        if (depth === 0) {
          curCol.cards.push(item);
          stack[0] = item;
          stack.length = 1;
          continue;
        }

        const parent = stack[depth - 1];
        if (!parent) {
          curCol.note.push(raw);
          continue;
        }

        parent.children.push(item);
        stack[depth] = item;
        stack.length = depth + 1;
        continue;
      }
    }

    resetStack(stack);
    if (curCol) {
      curCol.note.push(raw);
    } else if (curRow) {
      curRow.preface.push(raw);
    } else {
      preamble.push(raw);
    }
  }

  return {
    preamble: normalizeTextLines(preamble),
    rows: rows.map((row) => ({
      id: row.id,
      title: row.title,
      preface: normalizeTextLines(row.preface),
      columns: row.columns.map((col) => ({
        id: col.id,
        title: col.title,
        note: normalizeTextLines(col.note),
        cards: col.cards.map((card) => ({
          id: card.id,
          text: card.text,
          done: card.done,
          children: card.children.map(toSubitem),
        })),
      })),
    })),
  };
}

function serializeItem(
  item: KanbanCard | KanbanSubitem,
  depth: number,
  out: string[],
): void {
  const indent = "  ".repeat(depth);
  const box = item.done ? "x" : " ";
  out.push(`${indent}- [${box}] ${item.text}`.replace(/\s+$/g, ""));
  for (const child of item.children) serializeItem(child, depth + 1, out);
}

export function serializeBoard(board: KanbanBoard): string {
  const blocks: string[] = [];

  const pre = board.preamble.replace(/\s+$/g, "");
  if (pre) blocks.push(pre);

  for (const row of board.rows) {
    const rowLines: string[] = [`# ${row.title}`.replace(/\s+$/g, "")];
    const preface = row.preface.replace(/\s+$/g, "");
    if (preface) rowLines.push(preface);
    blocks.push(rowLines.join("\n"));

    for (const col of row.columns) {
      const section: string[] = [`## ${col.title}`.replace(/\s+$/g, "")];

      const note = col.note.replace(/\s+$/g, "");
      if (note) section.push(note);

      for (const card of col.cards) serializeItem(card, 0, section);
      blocks.push(section.join("\n"));
    }
  }

  return blocks.join("\n\n") + "\n";
}

export function moveCard(
  board: KanbanBoard,
  cardId: string,
  from: { rowId: string; colId: string },
  to: CardDropTarget,
): KanbanBoard {
  if (to.beforeCardId === cardId) return board;

  let moved: KanbanCard | undefined;
  let inserted = false;

  const strippedRows = board.rows.map((row) => {
    if (row.id !== from.rowId) return row;
    return {
      ...row,
      columns: row.columns.map((col) => {
        if (col.id !== from.colId) return col;
        moved = col.cards.find((card) => card.id === cardId);
        return { ...col, cards: col.cards.filter((card) => card.id !== cardId) };
      }),
    };
  });

  if (!moved) return board;

  const rows = strippedRows.map((row) => {
    if (row.id !== to.rowId) return row;
    return {
      ...row,
      columns: row.columns.map((col) => {
        if (col.id !== to.colId) return col;
        const cards = [...col.cards];
        const idx =
          to.beforeCardId === null
            ? cards.length
            : cards.findIndex((card) => card.id === to.beforeCardId);
        cards.splice(idx === -1 ? cards.length : idx, 0, moved!);
        inserted = true;
        return { ...col, cards };
      }),
    };
  });

  return inserted ? { ...board, rows } : board;
}

/** 빈 카드/컬럼/row 생성 헬퍼 */
export function newCard(text = ""): KanbanCard {
  return { id: uid("card"), text, done: false, children: [] };
}

export function newColumn(title = "새 컬럼"): KanbanColumn {
  return { id: uid("col"), title, cards: [], note: "" };
}

export function newRow(title = DEFAULT_ROW_TITLE): KanbanRow {
  return { id: uid("row"), title, columns: [], preface: "" };
}
