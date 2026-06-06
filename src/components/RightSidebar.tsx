// background tracking이 기록한 업무 이벤트 로그 피드.
// 초기 목록은 get_events로 로드하고, 이후 events://new로 증분 갱신한다.
import { useEffect, useState } from "react";

type EventKind = "note" | "checkin";

interface TrackedEvent {
  id: number;
  ts: number; // unix epoch millis
  kind: EventKind;
  text: string;
}

// 이벤트 종류별 색상 (점). phase 2/3에서 app/web/comm 추가 예정.
const KIND_COLOR: Record<EventKind, string> = {
  note: "#2ecc71", // 노트(todo) 변경
  checkin: "#4f8cff", // 체크인 응답
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function RightSidebar() {
  const [events, setEvents] = useState<TrackedEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function setup() {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const initial = await invoke<TrackedEvent[]>("get_events");
        console.log("[RightSidebar] get_events →", initial.length, "event(s)");
        if (!cancelled) setEvents(initial);
      } catch (e) {
        console.error("[RightSidebar] get_events failed:", e);
      }

      try {
        const { listen } = await import("@tauri-apps/api/event");
        const un = await listen<TrackedEvent>("events://new", (event) => {
          console.log("[RightSidebar] events://new ←", event.payload);
          setEvents((prev) => [event.payload, ...prev]);
        });
        if (cancelled) un();
        else unlisten = un;
      } catch (e) {
        console.error("[RightSidebar] events://new listen failed:", e);
      }
    }

    setup();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <aside className="right-sidebar">
      <div className="events-header">
        <span className="events-title">Events</span>
        <span className="tracking-status">
          <span className="tracking-dot" />
          live
        </span>
      </div>

      <ul className="event-list">
        {events.map((ev) => (
          <li key={ev.id} className="event-item">
            <span
              className="event-dot"
              style={{ background: KIND_COLOR[ev.kind] }}
            />
            <div className="event-body">
              <span className="event-time">{formatTime(ev.ts)}</span>
              <span className="event-text">{ev.text}</span>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export default RightSidebar;
