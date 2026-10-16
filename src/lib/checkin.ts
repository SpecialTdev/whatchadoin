export type CheckInMode = "off" | "working" | "break";

export interface CheckInStatus {
  active_task: string | null;
  mode: CheckInMode;
}

export type CheckInTaskKind = "parent" | "subitem";

export interface CheckInTaskOption {
  kind: CheckInTaskKind;
  label: string;
  value: string;
  parentValue?: string;
  rowTitle?: string;
  columnTitle?: string;
}

export interface TaskContext {
  rowTitle?: string;
  columnTitle?: string;
  parentTask?: string;
}

export function columnGroupKey(context: TaskContext): string {
  return JSON.stringify([context.rowTitle ?? "", context.columnTitle ?? ""]);
}

export function groupTaskOptions(options: CheckInTaskOption[]) {
  const groups = new Map<string, {
    key: string;
    rowTitle?: string;
    columnTitle?: string;
    tasks: CheckInTaskOption[];
  }>();
  for (const option of options) {
    if (option.kind !== "parent") continue;
    const key = columnGroupKey(option);
    if (!groups.has(key)) {
      groups.set(key, { key, rowTitle: option.rowTitle, columnTitle: option.columnTitle, tasks: [] });
    }
    groups.get(key)!.tasks.push(option);
  }
  return [...groups.values()];
}

export interface CheckInSubmitEvent {
  task: string;
  memo: string;
}
