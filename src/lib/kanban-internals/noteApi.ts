import { newCard, newColumn, newRow, parseMarkdown, serializeBoard } from "./markdown";
import type { CheckInTaskOption } from "../checkin";
import type { KanbanSubitem } from "./model";

const TASK_PATH_SEPARATOR = " › ";

// 노트(todo)에서 체크인 후보를 뽑는다: 미완료·비어있지 않은 항목, 중복 제거.
export function extractOpenTasks(note: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const board = parseMarkdown(note);

  for (const row of board.rows) {
    for (const col of row.columns) {
      for (const card of col.cards) {
        const task = card.text.trim();
        if (!card.done && task && !seen.has(task)) {
          seen.add(task);
          out.push(task);
        }
      }
    }
  }

  return out;
}

function pushTaskOption(
  out: CheckInTaskOption[],
  seen: Set<string>,
  option: CheckInTaskOption,
) {
  if (!option.value || seen.has(option.value)) return;
  seen.add(option.value);
  out.push(option);
}

function collectSubitemOptions(
  items: KanbanSubitem[],
  parentPath: string[],
  out: CheckInTaskOption[],
  seen: Set<string>,
) {
  for (const item of items) {
    const label = item.text.trim();
    const path = label ? [...parentPath, label] : parentPath;
    if (!item.done && label) {
      pushTaskOption(out, seen, {
        kind: "subitem",
        label,
        parentValue: parentPath[0],
        value: path.join(TASK_PATH_SEPARATOR),
      });
      collectSubitemOptions(item.children, path, out, seen);
    }
  }
}

// 체크인 전용 후보: parent task와 사용자가 펼쳐 볼 subitem 후보를 함께 만든다.
export function extractOpenTaskOptions(note: string): CheckInTaskOption[] {
  const seen = new Set<string>();
  const out: CheckInTaskOption[] = [];
  const board = parseMarkdown(note);

  for (const row of board.rows) {
    for (const col of row.columns) {
      for (const card of col.cards) {
        const task = card.text.trim();
        if (card.done || !task) continue;
        pushTaskOption(out, seen, { kind: "parent", label: task, value: task });
        collectSubitemOptions(card.children, [task], out, seen);
      }
    }
  }

  return out;
}

// 체크인에서 입력한 새 작업을 노트의 '진행 중'(없으면 첫 컬럼/신규 컬럼)에 추가한다.
export function appendTaskToProgress(note: string, task: string): string {
  const board = parseMarkdown(note);
  if (board.rows.length === 0) board.rows.push(newRow());
  let target = board.rows
    .flatMap((row) => row.columns)
    .find((col) => col.title.includes("진행"));
  if (!target) {
    target = newColumn("진행 중");
    board.rows[0].columns.push(target);
  }
  target.cards.push(newCard(task));
  return serializeBoard(board);
}
