import { columnGroupKey, type CheckInTaskOption, type TaskContext } from "./checkin";
import type { CheckInMemoPoint } from "./checkinMemo";

const TASK_PALETTE = ["#4f8cff", "#2ecc71", "#e67e22", "#9b59b6", "#e74c3c", "#1abc9c", "#f1c40f"];

export interface Segment {
  start: number;
  end: number;
}

export interface TimelineRow {
  key: string;
  task: string;
  parentTask: string;
  context: TaskContext;
  color: string;
  segments: Segment[];
  points: CheckInMemoPoint[];
}

export function buildReportRows(
  points: CheckInMemoPoint[],
  capMs: number,
  taskOptions: CheckInTaskOption[],
): TimelineRow[] {
  const byTask = new Map<string, TimelineRow>();
  const options = new Map(taskOptions.map((option) => [option.value, option]));
  points.forEach((point, index) => {
    const option = options.get(point.task);
    // New events retain their recorded column, even after cards move. Legacy
    // events fall back to the current board, then to an unassigned group.
    const context: TaskContext = point.taskContext ?? {
      rowTitle: option?.rowTitle,
      columnTitle: option?.columnTitle,
      parentTask: option ? option.parentValue ?? option.value : undefined,
    };
    const parentTask = context.parentTask || point.task.split(" › ")[0];
    const key = JSON.stringify([columnGroupKey(context), point.task]);
    if (!byTask.has(key)) {
      byTask.set(key, {
        key, task: point.task, parentTask, context,
        color: TASK_PALETTE[byTask.size % TASK_PALETTE.length],
        segments: [], points: [],
      });
    }
    const row = byTask.get(key)!;
    const end = Math.min(points[index + 1]?.ts ?? point.ts + capMs, point.ts + capMs);
    const last = row.segments[row.segments.length - 1];
    if (last && point.ts - last.end <= 1) last.end = end;
    else row.segments.push({ start: point.ts, end });
    row.points.push(point);
  });
  return [...byTask.values()];
}

export function groupReportRows(rows: TimelineRow[]) {
  const groups = new Map<string, {
    key: string;
    context: TaskContext;
    parents: Map<string, TimelineRow[]>;
  }>();
  for (const row of rows) {
    const key = columnGroupKey(row.context);
    if (!groups.has(key)) groups.set(key, { key, context: row.context, parents: new Map() });
    const parents = groups.get(key)!.parents;
    if (!parents.has(row.parentTask)) parents.set(row.parentTask, []);
    parents.get(row.parentTask)!.push(row);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    parents: [...group.parents.entries()].map(([task, items]) => ({
      task,
      rows: [...items.filter((item) => item.task === task), ...items.filter((item) => item.task !== task)],
    })),
  }));
}
