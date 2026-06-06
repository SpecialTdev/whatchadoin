// background tracking이 기록한 업무 이벤트 로그 피드.
// 초기 목록은 get_events로 로드하고, 이후 events://new로 증분 갱신한다.
import { useEffect, useState } from "react";
import {
  KIND_COLOR,
  fetchEvents,
  formatTime,
  type TrackedEvent,
} from "../lib/events";

function RightSidebar() {
  const [events, setEvents] = useState<TrackedEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function setup() {
      try {
        const initial = await fetchEvents();
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
