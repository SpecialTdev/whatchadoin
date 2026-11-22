import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { workDayKey } from "./events";

interface ActiveUsage {
  app: string;
  start: number;
  observed: number;
}

interface ScreenTime {
  apps: { app: string; ms: number }[];
  active: ActiveUsage | null;
  supported: boolean;
}

const SAMPLE_MS = 2_000;

export function useScreenTime(enabled: boolean, date: string, boundaryHour: number) {
  const [dates, setDates] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<{ key: string; value: ScreenTime | null }>();
  const [now, setNow] = useState(Date.now);
  const key = `${date}/${boundaryHour}`;
  const midnight = new Date(`${date}T00:00:00`);
  const start = midnight.getTime() + boundaryHour * 3_600_000;
  const end = midnight.setDate(midnight.getDate() + 1) + boundaryHour * 3_600_000;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let request = 0;
    let day = workDayKey(Date.now(), boundaryHour);
    let datesIncludeToday = false;
    let unlisten: (() => void) | undefined;

    function refreshSummary() {
      const revision = ++request;
      if (!date) return;
      void invoke<ScreenTime>("get_screen_time", { start, end }).then((value) => {
        if (!cancelled && revision === request) setSnapshot({ key, value });
      }).catch(() => {
        if (!cancelled && revision === request) setSnapshot({ key, value: null });
      });
    }

    function refreshDates() {
      void invoke<[number, number][]>("get_screen_time_dates").then((ranges) => {
        if (cancelled) return;
        const keys = new Set<string>();
        for (const [first, last] of ranges) {
          const day = new Date(workDayKey(first, boundaryHour));
          const lastDay = new Date(workDayKey(last - 1, boundaryHour));
          while (day <= lastDay) {
            keys.add(day.toISOString().slice(0, 10));
            day.setUTCDate(day.getUTCDate() + 1);
          }
        }
        datesIncludeToday = keys.has(workDayKey(Date.now(), boundaryHour));
        setDates([...keys]);
      }).catch(console.error);
    }

    function refresh() {
      refreshDates();
      refreshSummary();
    }

    void listen<{ changed: boolean; active: ActiveUsage | null }>("screen-time://sample", ({ payload }) => {
      if (cancelled) return;
      const nextDay = workDayKey(Date.now(), boundaryHour);
      if (day !== nextDay || (payload.changed && payload.active && !datesIncludeToday)) {
        day = nextDay;
        refreshDates();
      }
      if (payload.changed) {
        refreshSummary();
      } else if (payload.active) {
        const active = payload.active;
        setSnapshot((previous) => {
          if (previous?.key !== key || previous.value?.active?.start !== active.start) return previous;
          return { key, value: { ...previous.value, active } };
        });
      }
    }).then((stop) => {
      if (cancelled) stop();
      else {
        unlisten = stop;
        refresh();
      }
    }).catch(refresh);

    const tick = window.setInterval(() => {
      if (date === workDayKey(Date.now(), boundaryHour)) setNow(Date.now());
    }, 1000);
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      unlisten?.();
      window.clearInterval(tick);
      window.removeEventListener("focus", refresh);
    };
  }, [enabled, date, boundaryHour, start, end, key]);

  const value = snapshot?.key === key ? snapshot.value : undefined;
  const apps = new Map(value?.apps.map(({ app, ms }) => [app, ms]));
  const active = value?.active;
  if (active) {
    const live = now < end && now >= start ? Math.max(now, active.observed) : active.observed;
    const observedEnd = Math.min(end, active.observed + SAMPLE_MS, live);
    const ms = Math.max(0, observedEnd - Math.max(start, active.start));
    if (ms) apps.set(active.app, (apps.get(active.app) ?? 0) + ms);
  }

  return {
    dates,
    status: value === undefined ? "loading" : value === null ? "error" : value.supported ? "ready" : "unsupported",
    apps: [...apps].map(([app, ms]) => ({ app, ms })).sort((a, b) => b.ms - a.ms),
  } as const;
}
