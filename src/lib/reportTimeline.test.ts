import { describe, expect, it } from "vitest";
import { groupTaskOptions } from "./checkin";
import { checkInMemoPoints, type CheckInMemoPoint } from "./checkinMemo";
import { extractOpenTaskOptions } from "./kanban";
import { buildReportRows, groupReportRows } from "./reportTimeline";

const NOTE = `# Product
## Doing
- [ ] Alpha
  - [ ] Child
- [x] Finished
  - [x] Archived child
## Review
- [ ] Beta
# Personal
## Doing
- [ ] Gamma
`;
const point = (id: number, task: string, taskContext?: CheckInMemoPoint["taskContext"]): CheckInMemoPoint =>
  ({ id, ts: id * 1000, task, memo: `memo ${id}`, taskContext });

describe("column and task grouping", () => {
  it("carries column metadata to children and separates equal column names in different rows", () => {
    const options = extractOpenTaskOptions(NOTE);
    expect(options.find((option) => option.value === "Alpha › Child")).toMatchObject({
      rowTitle: "Product", columnTitle: "Doing", parentValue: "Alpha",
    });
    const groups = groupTaskOptions(options);
    expect(groups.map((group) => [group.rowTitle, group.columnTitle, group.tasks.map((task) => task.value)]))
      .toEqual([["Product", "Doing", ["Alpha"]], ["Product", "Review", ["Beta"]], ["Personal", "Doing", ["Gamma"]]]);
    expect(groupTaskOptions([{ kind: "parent", value: "Legacy", label: "Legacy" }])[0].columnTitle)
      .toBeUndefined();
  });

  it("groups legacy events under completed tasks as well as open tasks", () => {
    const points = [point(1, "Alpha › Child"), point(2, "Beta"), point(3, "Alpha"), point(4, "Finished › Archived child"), point(5, "Deleted")];
    const groups = groupReportRows(buildReportRows(points, 1000, extractOpenTaskOptions(NOTE, true)));
    expect(groups[0].context.columnTitle).toBe("Doing");
    expect(groups[0].parents.map((parent) => [parent.task, parent.rows.map((row) => row.task)]))
      .toEqual([["Alpha", ["Alpha", "Alpha › Child"]], ["Finished", ["Finished › Archived child"]]]);
    expect(groups[1].context.columnTitle).toBe("Review");
    expect(groups[2].context.columnTitle).toBeUndefined();
  });

  it("retains historical columns and keeps intervals and memos separate after a move", () => {
    const points = [
      point(1, "Alpha", { rowTitle: "Product", columnTitle: "Old column" }),
      point(2, "Alpha", { rowTitle: "Product", columnTitle: "New column" }),
      point(3, "Alpha", { rowTitle: "Product", columnTitle: "New column" }),
      point(10, "Alpha", { rowTitle: "Product", columnTitle: "New column" }),
    ];
    const rows = buildReportRows(points, 2000, extractOpenTaskOptions(NOTE));
    expect(rows).toHaveLength(2);
    expect(rows[0].segments).toEqual([{ start: 1000, end: 2000 }]);
    expect(rows[1].segments).toEqual([{ start: 2000, end: 5000 }, { start: 10000, end: 12000 }]);
    expect(rows[0].points.map((item) => item.memo)).toEqual(["memo 1"]);
    expect(rows[1].points.map((item) => item.memo)).toEqual(["memo 2", "memo 3", "memo 10"]);
    expect(groupReportRows(rows).map((group) => group.context.columnTitle)).toEqual(["Old column", "New column"]);
  });

  it("preserves stored context when parsing event memos", () => {
    const taskContext = { rowTitle: "Product", columnTitle: "Doing", parentTask: "Alpha" };
    const points = checkInMemoPoints([{ id: 1, ts: 1, kind: "checkin", text: "체크인 — 'Alpha › Child' 작업 중\n\nA memo", taskContext }]);
    expect(points[0]).toMatchObject({ task: "Alpha › Child", memo: "A memo", taskContext });
  });
});
