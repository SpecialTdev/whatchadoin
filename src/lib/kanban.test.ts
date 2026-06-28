import { describe, expect, it } from "vitest";
import {
  appendTaskToProgress,
  applyDrop,
  extractOpenTasks,
  indentCard,
  outdentSubitem,
  parseMarkdown,
  serializeBoard,
} from "./kanban";
import {
  resolveCrossRowVerticalTargetIndex,
  resolveHorizontalTargetIndex,
  resolveVerticalTargetIndex,
} from "../components/kanban/useKanbanKeyboardNavigation";

const SAMPLE = `# 오늘의 작업

## 진행 중
- [ ] Alpha
  - [ ] Alpha child
- [ ] Beta

## 완료
- [x] Done
`;

describe("kanban markdown domain", () => {
  it("round-trips markdown todo notes", () => {
    expect(serializeBoard(parseMarkdown(SAMPLE))).toBe(SAMPLE);
  });

  it("extracts unique open parent tasks", () => {
    const note = `${SAMPLE}
## Backlog
- [ ] Alpha
- [ ] Gamma
`;

    expect(extractOpenTasks(note)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("appends new tasks to the progress column", () => {
    const next = appendTaskToProgress(SAMPLE, "New task");

    expect(next).toContain("## 진행 중\n- [ ] Alpha");
    expect(next).toContain("- [ ] New task");
  });

  it("indents a card under the previous card and can outdent it back", () => {
    const board = parseMarkdown(SAMPLE);
    const progress = board.rows[0].columns[0];
    const beta = progress.cards.find((card) => card.text === "Beta")!;

    const indented = indentCard(board, beta.id);
    const alphaAfterIndent = indented.board.rows[0].columns[0].cards[0];
    const betaSubitem = alphaAfterIndent.children.find((item) => item.text === "Beta")!;

    expect(betaSubitem).toBeTruthy();
    expect(indented.focus).toEqual({ kind: "subitem", id: betaSubitem.id });

    const outdented = outdentSubitem(indented.board, betaSubitem.id);
    const cards = outdented.board.rows[0].columns[0].cards.map((card) => card.text);

    expect(cards).toEqual(["Alpha", "Beta"]);
    expect(outdented.focus?.kind).toBe("card");
  });

  it("applies card drops across columns", () => {
    const board = parseMarkdown(SAMPLE);
    const progress = board.rows[0].columns[0];
    const done = board.rows[0].columns[1];
    const alpha = progress.cards.find((card) => card.text === "Alpha")!;

    const next = applyDrop(
      board,
      { kind: "card", cardId: alpha.id, fromRowId: board.rows[0].id, fromColId: progress.id },
      { kind: "card", rowId: board.rows[0].id, colId: done.id, beforeCardId: null },
    );

    expect(next.rows[0].columns[0].cards.map((card) => card.text)).toEqual(["Beta"]);
    expect(next.rows[0].columns[1].cards.map((card) => card.text)).toEqual([
      "Done",
      "Alpha",
    ]);
  });
});

describe("kanban keyboard navigation helpers", () => {
  it("resolves vertical movement within visible items", () => {
    expect(resolveVerticalTargetIndex(1, "ArrowUp", 3)).toBe(0);
    expect(resolveVerticalTargetIndex(1, "ArrowDown", 3)).toBe(2);
    expect(resolveVerticalTargetIndex(0, "ArrowUp", 3)).toBeNull();
    expect(resolveVerticalTargetIndex(2, "ArrowDown", 3)).toBeNull();
  });

  it("clamps horizontal movement to the target column item count", () => {
    expect(resolveHorizontalTargetIndex(2, 5)).toBe(2);
    expect(resolveHorizontalTargetIndex(4, 2)).toBe(1);
    expect(resolveHorizontalTargetIndex(0, 0)).toBeNull();
  });

  it("resolves cross-row vertical movement at column boundaries", () => {
    expect(resolveCrossRowVerticalTargetIndex("ArrowUp", 3)).toBe(2);
    expect(resolveCrossRowVerticalTargetIndex("ArrowDown", 3)).toBe(0);
    expect(resolveCrossRowVerticalTargetIndex("ArrowUp", 0)).toBeNull();
    expect(resolveCrossRowVerticalTargetIndex("ArrowDown", 0)).toBeNull();
  });
});
