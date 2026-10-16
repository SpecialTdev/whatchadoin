// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { mockIPC, mockWindows, clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, expect, it } from "vitest";
import CheckInWindow from "../CheckInWindow";
import { extractOpenTaskOptions, extractOpenTasks } from "../lib/kanban";
import type { TrackedEvent } from "../lib/events";
import ReportView from "./ReportView";

const NOTE = `# Product
## Doing
- [ ] Alpha
  - [ ] Child
## Review
- [ ] Beta
`;
let root: Root;
let container: HTMLDivElement;
let calls: { cmd: string; args: unknown }[];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  calls = [];
  mockWindows("checkin");
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "get_checkin_data") return {
      tasks: extractOpenTasks(NOTE), task_options: extractOpenTaskOptions(NOTE),
      active_task: "Alpha", mode: "working",
    };
    if (cmd === "get_events") return [];
    if (cmd === "get_report_note") return "";
  }, { shouldMockEvents: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  clearMocks();
});

it("shows column dividers without changing parent/subtask selection or submission", async () => {
  await act(async () => root.render(<CheckInWindow />));
  const groups = container.querySelectorAll(".checkin-column-group");
  expect(groups).toHaveLength(2);
  expect(groups[0].getAttribute("aria-label")).toBe("Doing");
  expect(groups[1].getAttribute("aria-label")).toBe("Review");
  expect(groups[1].textContent).toContain("Beta");
  await act(async () => groups[0].querySelector<HTMLButtonElement>(".checkin-task-btn")!.click());
  const child = groups[0].querySelector<HTMLButtonElement>(".subtask")!;
  expect(child.textContent).toContain("Child");
  await act(async () => child.click());
  expect(child.classList.contains("selected")).toBe(true);
  await act(async () => container.querySelector<HTMLButtonElement>(".checkin-submit-btn")!.click());
  expect(calls).toContainEqual({ cmd: "submit_checkin", args: { task: "Alpha › Child", memo: "" } });
});

it("keeps the original flat report, full task labels and chronological memo lookup", async () => {
  const base = new Date(2026, 9, 16, 9).getTime();
  const task = "아주 긴 작업 이름과 띄어쓰기없는매우긴식별자".repeat(4);
  const events: TrackedEvent[] = [
    { id: 1, ts: base, kind: "checkin", text: `체크인 — '${task}' 작업 중\n\nOld memo`, taskContext: { rowTitle: "Product", columnTitle: "Old" } },
    { id: 2, ts: base + 60_000, kind: "checkin", text: `체크인 — '${task}' 작업 중\n\nNew memo`, taskContext: { rowTitle: "Product", columnTitle: "Doing" } },
    { id: 3, ts: base + 120_000, kind: "checkin", text: `체크인 — '${task} › Child' 작업 중\n\nChild memo`, taskContext: { rowTitle: "Product", columnTitle: "Doing", parentTask: task } },
  ];
  await act(async () => root.render(<ReportView date="2026-10-16" events={events} checkinIntervalSec={60} />));
  const gantt = container.querySelector(".gantt")!;
  expect(gantt.querySelector("section")).toBeNull();
  const rows = gantt.querySelectorAll(":scope > .gantt-row");
  expect(rows).toHaveLength(3);
  expect(rows[1].querySelector(".gantt-label")!.textContent).toBe(task);
  expect(rows[2].querySelector(".gantt-label")!.textContent).toBe(`${task} › Child`);
  expect(rows[1].querySelectorAll(".gantt-bar")).toHaveLength(1);
  await act(async () => rows[1].querySelector<HTMLButtonElement>(".gantt-bar")!.click());
  expect(container.querySelector(".report-memo-preview")!.textContent).toContain("Old memo");
  const slider = container.querySelector<HTMLInputElement>(".report-memo-range")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, String(base + 60_000));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelector(".report-memo-preview")!.textContent).toContain("New memo");
  expect(container.querySelector(".report-memo-preview")!.textContent).not.toContain("Old memo");
});
