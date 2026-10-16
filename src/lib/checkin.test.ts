import { describe, expect, it } from "vitest";
import { groupTaskOptions } from "./checkin";
import { checkInMemoPoints } from "./checkinMemo";
import { extractOpenTaskOptions } from "./kanban";

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

  it("preserves stored context when parsing event memos", () => {
    const taskContext = { rowTitle: "Product", columnTitle: "Doing", parentTask: "Alpha" };
    const points = checkInMemoPoints([{ id: 1, ts: 1, kind: "checkin", text: "체크인 — 'Alpha › Child' 작업 중\n\nA memo", taskContext }]);
    expect(points[0]).toMatchObject({ task: "Alpha › Child", memo: "A memo", taskContext });
  });
});
