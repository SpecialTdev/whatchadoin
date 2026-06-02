// Kanban <-> markdown todo note 변환 로직.
//
// 모델: 마크다운 노트가 single source of truth.
//   "## 제목"      → 칸반 컬럼
//   "- [ ] / [x]"  → 카드 (체크박스 = done 상태)
//   "- 항목"        → 카드 (done=false)
//   그 외 자유 텍스트 → 컬럼 note (round-trip 보존)
//   첫 "## " 이전 텍스트(예: "# 제목") → preamble (보존)

export interface KanbanCard {
  id: string;
  text: string;
  done: boolean;
}

export interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
  /** 체크리스트가 아닌 자유 텍스트 라인 (round-trip 보존용) */
  note: string;
}

export interface KanbanBoard {
  /** 첫 컬럼(## ) 이전의 원본 텍스트 — "# 제목" 등 */
  preamble: string;
  columns: KanbanColumn[];
}

const COLUMN_RE = /^##\s+(.*)$/;
const TASK_RE = /^\s*[-*]\s+\[([ xX])\]\s?(.*)$/;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;

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

interface PendingColumn {
  title: string;
  cards: KanbanCard[];
  note: string[];
}

export function parseMarkdown(md: string): KanbanBoard {
  const lines = md.split("\n");
  const preamble: string[] = [];
  const pending: PendingColumn[] = [];
  let cur: PendingColumn | null = null;

  for (const raw of lines) {
    const colMatch = raw.match(COLUMN_RE);
    if (colMatch) {
      cur = { title: colMatch[1].trim(), cards: [], note: [] };
      pending.push(cur);
      continue;
    }

    if (!cur) {
      preamble.push(raw);
      continue;
    }

    const taskMatch = raw.match(TASK_RE);
    if (taskMatch) {
      cur.cards.push({
        id: uid("card"),
        done: taskMatch[1].toLowerCase() === "x",
        text: taskMatch[2].trim(),
      });
      continue;
    }

    const bulletMatch = raw.match(BULLET_RE);
    if (bulletMatch) {
      cur.cards.push({ id: uid("card"), done: false, text: bulletMatch[1].trim() });
      continue;
    }

    cur.note.push(raw);
  }

  return {
    preamble: trimBlankLines(preamble).join("\n"),
    columns: pending.map((c) => ({
      id: uid("col"),
      title: c.title,
      cards: c.cards,
      note: trimBlankLines(c.note).join("\n"),
    })),
  };
}

export function serializeBoard(board: KanbanBoard): string {
  const blocks: string[] = [];

  const pre = board.preamble.replace(/\s+$/g, "");
  if (pre) blocks.push(pre);

  for (const col of board.columns) {
    const section: string[] = [`## ${col.title}`.replace(/\s+$/g, "")];

    const note = col.note.replace(/\s+$/g, "");
    if (note) section.push(note);

    for (const card of col.cards) {
      const box = card.done ? "x" : " ";
      section.push(`- [${box}] ${card.text}`.replace(/\s+$/g, ""));
    }

    blocks.push(section.join("\n"));
  }

  return blocks.join("\n\n") + "\n";
}

/** 빈 카드/컬럼 생성 헬퍼 */
export function newCard(text = ""): KanbanCard {
  return { id: uid("card"), text, done: false };
}

export function newColumn(title = "새 컬럼"): KanbanColumn {
  return { id: uid("col"), title, cards: [], note: "" };
}
