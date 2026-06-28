import { newCard, newColumn, newRow, parseMarkdown, serializeBoard } from "./markdown";

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
