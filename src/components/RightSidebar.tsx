// background tracking이 기록한 업무 이벤트 로그 피드.
// 초기 목록은 get_events로 로드하고, 이후 events://new로 증분 갱신한다.
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  KIND_COLOR,
  fetchEventsPage,
  formatTime,
  type TrackedEvent,
} from "../lib/events";

interface Props {
  className?: string;
}

const PAGE_SIZE = 50;

function mergeEvents(prev: TrackedEvent[], next: TrackedEvent[]): TrackedEvent[] {
  const seen = new Set<number>();
  const merged: TrackedEvent[] = [];
  for (const event of [...prev, ...next]) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    merged.push(event);
  }
  return merged;
}

function RightSidebar({ className = "" }: Props) {
  const [events, setEvents] = useState<TrackedEvent[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const loadMoreRef = useRef<HTMLLIElement | null>(null);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  const loadPage = useCallback(async (startOffset: number) => {
    if (loadingRef.current || !hasMoreRef.current) return;

    loadingRef.current = true;
    setLoading(true);
    try {
      const page = await fetchEventsPage({
        limit: PAGE_SIZE,
        offset: startOffset,
      });
      console.log(
        "[RightSidebar] get_events page →",
        page.length,
        "event(s)",
      );
      setEvents((prev) => mergeEvents(prev, page));
      setOffset((prev) => Math.max(prev, startOffset + page.length));
      setHasMore(page.length === PAGE_SIZE);
    } catch (e) {
      console.error("[RightSidebar] get_events page failed:", e);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function setup() {
      await loadPage(0);
      if (cancelled) return;

      try {
        const { listen } = await import("@tauri-apps/api/event");
        const un = await listen<TrackedEvent>("events://new", (event) => {
          console.log("[RightSidebar] events://new ←", event.payload);
          setEvents((prev) => mergeEvents([event.payload], prev));
          setOffset((prev) => prev + 1);
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
  }, [loadPage]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        loadPage(offset);
      },
      { root: null, rootMargin: "160px 0px", threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadPage, offset]);

  return (
    <aside className={`right-sidebar${className ? ` ${className}` : ""}`}>
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
        {events.length === 0 && !loading && (
          <li className="event-list-status">No events yet</li>
        )}
        {(hasMore || loading) && (
          <li ref={loadMoreRef} className="event-list-status">
            {loading ? "Loading..." : "Scroll for more"}
          </li>
        )}
      </ul>
    </aside>
  );
}

export default memo(RightSidebar);
