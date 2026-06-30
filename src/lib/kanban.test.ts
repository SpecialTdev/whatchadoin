import { describe, expect, it } from "vitest";
import {
  appendTaskToProgress,
  applyDrop,
  extractOpenTaskOptions,
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

  it("extracts check-in subitem options without expanding the parent task list", () => {
    const note = `${SAMPLE}
## Backlog
- [ ] Alpha
  - [ ] Duplicate child
- [ ] Gamma
  - [ ] Duplicate child
    - [ ] Deep child
`;

    expect(extractOpenTasks(note)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(extractOpenTaskOptions(note)).toEqual([
      { kind: "parent", label: "Alpha", value: "Alpha" },
      {
        kind: "subitem",
        label: "Alpha child",
        parentValue: "Alpha",
        value: "Alpha › Alpha child",
      },
      { kind: "parent", label: "Beta", value: "Beta" },
      {
        kind: "subitem",
        label: "Duplicate child",
        parentValue: "Alpha",
        value: "Alpha › Duplicate child",
      },
      { kind: "parent", label: "Gamma", value: "Gamma" },
      {
        kind: "subitem",
        label: "Duplicate child",
        parentValue: "Gamma",
        value: "Gamma › Duplicate child",
      },
      {
        kind: "subitem",
        label: "Deep child",
        parentValue: "Gamma",
        value: "Gamma › Duplicate child › Deep child",
      },
    ]);
  });

  it("does not expose subitems under completed parents as check-in options", () => {
    const note = `# Tasks

## Done
- [x] Parent
  - [ ] Hidden child
- [ ] Visible
  - [x] Done child
  - [ ] Open child
`;

    expect(extractOpenTaskOptions(note)).toEqual([
      { kind: "parent", label: "Visible", value: "Visible" },
      {
        kind: "subitem",
        label: "Open child",
        parentValue: "Visible",
        value: "Visible › Open child",
      },
    ]);
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

  it("applies column drops within a row", () => {
    const board = parseMarkdown(SAMPLE);
    const progress = board.rows[0].columns[0];

    const next = applyDrop(
      board,
      { kind: "column", colId: progress.id, fromRowId: board.rows[0].id },
      { kind: "column", rowId: board.rows[0].id, beforeColId: null },
    );

    expect(next.rows[0].columns.map((col) => col.title)).toEqual([
      "완료",
      "진행 중",
    ]);
  });

  it("applies column drops across rows", () => {
    const board = parseMarkdown(`${SAMPLE}
# 나중에

## Backlog
- [ ] Later
`);
    const progress = board.rows[0].columns[0];
    const backlog = board.rows[1].columns[0];

    const next = applyDrop(
      board,
      { kind: "column", colId: progress.id, fromRowId: board.rows[0].id },
      {
        kind: "column",
        rowId: board.rows[1].id,
        beforeColId: backlog.id,
      },
    );

    expect(next.rows[0].columns.map((col) => col.title)).toEqual(["완료"]);
    expect(next.rows[1].columns.map((col) => col.title)).toEqual([
      "진행 중",
      "Backlog",
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
