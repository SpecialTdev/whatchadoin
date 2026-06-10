import { useEffect, useRef, useState } from "react";
import {
  type Widget,
  type WidgetConfig,
  WIDGET_CATALOG,
  DEFAULT_TIMER_SEC,
  DEFAULT_POSTURE_SEC,
  DEFAULT_POMODORO_FOCUS_SEC,
  DEFAULT_POMODORO_BREAK_SEC,
  newWidget,
  loadWidgets,
  saveWidgets,
} from "../lib/widgets";
import WidgetTimer from "./WidgetTimer";
import WidgetPostureCheck from "./WidgetPostureCheck";
import WidgetPomodoro from "./WidgetPomodoro";

function WidgetList() {
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  // ----- 드래그 상태 (pointer 기반: WebView에서 안정적, KanbanBoard와 동일 패턴) -----
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // 삽입 위치 = widgets 배열의 인덱스(0..length). null = 표시 없음(제자리/리스트 밖).
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const draggedRef = useRef<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // 마운트 시 한 번 디스크에서 로드.
  useEffect(() => {
    let cancelled = false;
    loadWidgets().then((w) => {
      if (!cancelled) setWidgets(w);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 상태 변경 + 영속을 함께 수행. 영속은 사용자 동작(추가/삭제/재정렬) 핸들러에서만
  // 호출하므로, 로드 완료 전 초기 빈 목록이 파일을 덮어쓸 일이 없다.
  function commit(next: Widget[]) {
    setWidgets(next);
    saveWidgets(next);
  }

  function addWidget(type: Widget["type"]) {
    commit([...widgets, newWidget(type)]);
    setPickerOpen(false);
  }

  function removeWidget(id: string) {
    commit(widgets.filter((w) => w.id !== id));
  }

  // 위젯별 설정 변경 → 병합 후 영속 (예: 타이머의 최근 사용 시간).
  function setWidgetConfig(id: string, patch: Partial<WidgetConfig>) {
    commit(
      widgets.map((w) =>
        w.id === id ? { ...w, config: { ...w.config, ...patch } } : w,
      ),
    );
  }

  // ----- drag & drop -----
  function startDrag(id: string) {
    draggedRef.current = id;
    setDraggingId(id);
  }

  // 커서의 Y만으로 삽입 인덱스를 정한다 (R1, R2). 리스트 밖이거나(R5) 제자리면(R4) null.
  function computeDropIndex(x: number, y: number): number | null {
    const listEl = listRef.current;
    if (!listEl) return null;

    const rect = listEl.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      return null; // R5: 리스트 밖 → 표시 없음(놓으면 제자리)
    }

    const items = Array.from(
      listEl.querySelectorAll<HTMLElement>("[data-widget-id]"),
    );
    let index = items.length; // R2: 모든 midpoint보다 아래면 맨 끝
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        index = i;
        break;
      }
    }

    const from = widgets.findIndex((w) => w.id === draggedRef.current);
    if (index === from || index === from + 1) return null; // R4: 제자리 → 표시 없음
    return index;
  }

  function moveDrag(x: number, y: number) {
    if (!draggedRef.current) return;
    setGhostPos({ x, y });
    const next = computeDropIndex(x, y);
    setDropIndex((prev) => (prev === next ? prev : next));
  }

  function endDrag() {
    const id = draggedRef.current;
    if (id && dropIndex != null) {
      const from = widgets.findIndex((w) => w.id === id);
      if (from !== -1) {
        const list = [...widgets];
        const [moved] = list.splice(from, 1);
        // dropIndex는 원본 배열 기준 → 드래그 항목 제거로 한 칸 당겨진 만큼 보정.
        const adjusted = dropIndex > from ? dropIndex - 1 : dropIndex;
        list.splice(adjusted, 0, moved);
        commit(list);
      }
    }
    draggedRef.current = null;
    setDraggingId(null);
    setDropIndex(null);
    setGhostPos(null);
  }

  const draggingWidget = draggingId
    ? widgets.find((w) => w.id === draggingId)
    : null;

  return (
    <div className="widget-list-wrap">
      <ul className="widget-list" ref={listRef}>
        {widgets.map((w, i) => (
          <WidgetItem
            key={w.id}
            widget={w}
            isDragging={draggingId === w.id}
            isDropBefore={dropIndex === i}
            isDropAfter={i === widgets.length - 1 && dropIndex === widgets.length}
            onRemove={() => removeWidget(w.id)}
            onConfigChange={(patch) => setWidgetConfig(w.id, patch)}
            onDragStart={() => startDrag(w.id)}
            onDragMove={moveDrag}
            onDragEnd={endDrag}
          />
        ))}
      </ul>

      <div className="add-widget">
        {pickerOpen && (
          <ul className="widget-catalog">
            {WIDGET_CATALOG.map((def) => (
              <li key={def.type}>
                <button
                  className="widget-catalog-item"
                  onClick={() => addWidget(def.type)}
                >
                  {def.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          className={`add-widget-btn${pickerOpen ? " open" : ""}`}
          onClick={() => setPickerOpen((o) => !o)}
        >
          + Add widget
        </button>
      </div>

      {draggingWidget && ghostPos && (
        <div
          className="widget-drag-ghost"
          style={{ left: ghostPos.x + 12, top: ghostPos.y + 8 }}
        >
          {draggingWidget.title}
        </div>
      )}
    </div>
  );
}

interface ItemProps {
  widget: Widget;
  isDragging: boolean;
  isDropBefore: boolean;
  isDropAfter: boolean;
  onRemove: () => void;
  onConfigChange: (patch: Partial<WidgetConfig>) => void;
  onDragStart: () => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: () => void;
}

function WidgetItem({
  widget,
  isDragging,
  isDropBefore,
  isDropAfter,
  onRemove,
  onConfigChange,
  onDragStart,
  onDragMove,
  onDragEnd,
}: ItemProps) {
  const headerRef = useRef<HTMLDivElement>(null);

  return (
    <li
      data-widget-id={widget.id}
      data-widget-type={widget.type}
      className={
        "widget-item" +
        (isDragging ? " dragging" : "") +
        (isDropBefore ? " drop-before" : "") +
        (isDropAfter ? " drop-after" : "")
      }
    >
      <div
        ref={headerRef}
        className="widget-header"
        title="드래그해 이동"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          // remove 버튼 클릭은 드래그를 시작하지 않는다.
          if ((e.target as HTMLElement).closest(".widget-remove")) return;
          e.preventDefault();
          headerRef.current?.setPointerCapture(e.pointerId);
          onDragStart();
        }}
        onPointerMove={(e) => onDragMove(e.clientX, e.clientY)}
        onPointerUp={(e) => {
          if (headerRef.current?.hasPointerCapture(e.pointerId)) {
            headerRef.current.releasePointerCapture(e.pointerId);
          }
          onDragEnd();
        }}
        onPointerCancel={(e) => {
          if (headerRef.current?.hasPointerCapture(e.pointerId)) {
            headerRef.current.releasePointerCapture(e.pointerId);
          }
          onDragEnd();
        }}
      >
        <span className="widget-title">{widget.title}</span>
        <button
          className="widget-remove"
          title="위젯 제거"
          onClick={onRemove}
        />
      </div>
      <div className="widget-body">{renderBody(widget, onConfigChange)}</div>
    </li>
  );
}

// 위젯 종류별 본문.
function renderBody(
  widget: Widget,
  onConfigChange: (patch: Partial<WidgetConfig>) => void,
) {
  switch (widget.type) {
    case "basic-timer":
      return (
        <WidgetTimer
          initialDurationSec={widget.config?.durationSec ?? DEFAULT_TIMER_SEC}
          onDurationChange={(sec) => onConfigChange({ durationSec: sec })}
        />
      );
    case "posture-check":
      return (
        <WidgetPostureCheck
          initialIntervalSec={widget.config?.intervalSec ?? DEFAULT_POSTURE_SEC}
          onIntervalChange={(sec) => onConfigChange({ intervalSec: sec })}
        />
      );
    case "ppomodoro-timer":
      return (
        <WidgetPomodoro
          initialFocusSec={widget.config?.focusSec ?? DEFAULT_POMODORO_FOCUS_SEC}
          initialBreakSec={widget.config?.breakSec ?? DEFAULT_POMODORO_BREAK_SEC}
          onConfigChange={onConfigChange}
        />
      );
    default:
      return null; // 알 수 없는(레거시) 타입은 본문 없이 표시
  }
}

export default WidgetList;
