// 좌측 사이드바 위젯 목록의 공유 타입·카탈로그·영속 유틸.
// 위젯 목록은 Rust(app_data_dir/widgets.json)에 JSON으로 영속하고,
// 프런트(WidgetList)는 invoke로 읽고 쓴다. (events와 같은 "Rust가 영속" 패턴)

export type WidgetType = "stub-a" | "stub-b";

export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
}

export interface WidgetDef {
  type: WidgetType;
  label: string;
}

// 추가 가능한 위젯 종류. 지금은 순서 변경을 눈으로 확인하기 쉽게 2종의 stub (이후 확장).
export const WIDGET_CATALOG: WidgetDef[] = [
  { type: "stub-a", label: "Stub A" },
  { type: "stub-b", label: "Stub B" },
];

// 새 위젯 인스턴스 생성. 디스크에서 로드한 id와 충돌하지 않도록 randomUUID 사용.
export function newWidget(type: WidgetType): Widget {
  const def = WIDGET_CATALOG.find((d) => d.type === type)!;
  return { id: crypto.randomUUID(), type, title: def.label };
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
