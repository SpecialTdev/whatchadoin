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
}

export interface CheckInSubmitEvent {
  task: string;
  memo: string;
}
