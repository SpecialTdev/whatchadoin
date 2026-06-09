// 좌측 사이드바 위젯 목록의 공유 타입·카탈로그·영속 유틸.
// 위젯 목록은 Rust(app_data_dir/widgets.json)에 JSON으로 영속하고,
// 프런트(WidgetList)는 invoke로 읽고 쓴다. (events와 같은 "Rust가 영속" 패턴)

export type WidgetType = "stub-a" | "stub-b" | "basic-timer";

// 위젯 종류별 설정. JSON으로 그대로 영속된다.
export interface WidgetConfig {
  /** basic-timer: 마지막으로 사용한 카운트다운 길이(초). */
  durationSec?: number;
}

export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  /** 위젯별 설정 (없는 종류는 생략). */
  config?: WidgetConfig;
}

export interface WidgetDef {
  type: WidgetType;
  label: string;
}

// basic-timer 처음 추가 시 기본 길이(초).
export const DEFAULT_TIMER_SEC = 5 * 60;

// 추가 가능한 위젯 종류.
export const WIDGET_CATALOG: WidgetDef[] = [
  { type: "stub-a", label: "Stub A" },
  { type: "stub-b", label: "Stub B" },
  { type: "basic-timer", label: "타이머" },
];

// 새 위젯 인스턴스 생성. 디스크에서 로드한 id와 충돌하지 않도록 randomUUID 사용.
export function newWidget(type: WidgetType): Widget {
  const def = WIDGET_CATALOG.find((d) => d.type === type)!;
  const widget: Widget = { id: crypto.randomUUID(), type, title: def.label };
  if (type === "basic-timer") widget.config = { durationSec: DEFAULT_TIMER_SEC };
  return widget;
}

// 저장된 위젯 목록을 불러온다. 실패(웹/개발 환경 등) 시 빈 목록.
export async function loadWidgets(): Promise<Widget[]> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<Widget[]>("get_widgets");
  } catch {
    return [];
  }
}

// 위젯 목록을 디스크에 저장한다. 실패는 무시(콘솔 기록만).
export async function saveWidgets(widgets: Widget[]): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_widgets", { widgets });
  } catch (e) {
    console.error("[widgets] save failed:", e);
  }
}
