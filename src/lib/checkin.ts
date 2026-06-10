export type CheckInMode = "off" | "working" | "break";

export interface CheckInStatus {
  active_task: string | null;
  mode: CheckInMode;
}

export interface CheckInSubmitEvent {
  task: string;
  memo: string;
}
