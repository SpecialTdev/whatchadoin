// 업무 이벤트 공유 타입·유틸.
// Rust collection crate가 생성·영속하는 Event를 프런트(RightSidebar, ReportView)에서
// 공통으로 다룬다.

export type EventKind = "note" | "checkin" | "process" | "window";

export interface TrackedEvent {
  id: number;
  ts: number; // unix epoch millis
  kind: EventKind;
  text: string;
}

export interface EventsPageRequest {
  limit: number;
  offset: number;
}

// 이벤트 종류별 색상 (점). phase 2/3에서 app/web/comm 추가 예정.
export const KIND_COLOR: Record<EventKind, string> = {
  note: "#2ecc71", // 노트(todo) 변경
  checkin: "#4f8cff", // 체크인 응답
  process: "#e67e22", // OS 프로세스 변화
  window: "#9b59b6", // 포커스된 최상위 윈도우 변화
};

export function isReportEvent(ev: TrackedEvent): boolean {
  return ev.kind === "note" || ev.kind === "checkin";
}

// Rust에서 저장된 모든 이벤트를 최신순으로 가져온다.
export async function fetchEvents(): Promise<TrackedEvent[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TrackedEvent[]>("get_events");
}

// Rust에서 저장된 이벤트를 최신순 페이지 단위로 가져온다.
export async function fetchEventsPage({
  limit,
  offset,
}: EventsPageRequest): Promise<TrackedEvent[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TrackedEvent[]>("get_events", { limit, offset });
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// ts → "HH:MM" (로컬)
export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// 업무일(work day) 키. 하루 경계를 boundaryHour(예: 새벽 5시)로 잡아,
// 자정~경계 사이의 이벤트는 전날 업무일로 묶는다 (자정 넘긴 작업 대응).
export function workDayKey(ts: number, boundaryHour: number): string {
  return dateStr(new Date(ts - boundaryHour * 3_600_000));
}

// ts의 달력 날짜(로컬). 업무일과 비교해 '익일' 여부 판단에 쓴다.
export function calendarDate(ts: number): string {
  return dateStr(new Date(ts));
}
