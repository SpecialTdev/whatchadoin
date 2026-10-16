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

it("renders column and parent groups and opens the memo from the selected historical column", async () => {
  const base = new Date(2026, 9, 16, 9).getTime();
  const events: TrackedEvent[] = [
    { id: 1, ts: base, kind: "checkin", text: "체크인 — 'Alpha' 작업 중\n\nOld memo", taskContext: { rowTitle: "Product", columnTitle: "Old" } },
    { id: 2, ts: base + 60_000, kind: "checkin", text: "체크인 — 'Alpha' 작업 중\n\nNew memo", taskContext: { rowTitle: "Product", columnTitle: "Doing" } },
    { id: 3, ts: base + 120_000, kind: "checkin", text: "체크인 — 'Alpha › Child' 작업 중\n\nChild memo", taskContext: { rowTitle: "Product", columnTitle: "Doing", parentTask: "Alpha" } },
  ];
  await act(async () => root.render(<ReportView date="2026-10-16" events={events} checkinIntervalSec={60} note={NOTE} />));
  const groups = container.querySelectorAll(".gantt-column-group");
  expect(groups).toHaveLength(2);
  expect(groups[0].getAttribute("aria-label")).toBe("Old");
  expect(groups[1].getAttribute("aria-label")).toBe("Doing");
  expect(groups[1].querySelectorAll(".gantt-task-group")).toHaveLength(1);
  expect(groups[1].querySelector(".gantt-subtask-row")!.textContent).toContain("Child");
  await act(async () => groups[1].querySelector<HTMLButtonElement>(".gantt-bar")!.click());
  expect(container.querySelector(".report-memo-preview")!.textContent).toContain("New memo");
  expect(container.querySelector(".report-memo-preview")!.textContent).not.toContain("Old memo");
});
