import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import { calendarDate } from "./events";

const SIZE_KEY = "checkin:daily-window-size";
const DEFAULT_WIDTH = 760;
const MIN_AUTO_HEIGHT = 320;

interface Size {
  width: number;
  height: number;
}

export function dailyCheckInSize(raw: string | null, day: string): Size | null {
  try {
    const saved = raw ? JSON.parse(raw) : null;
    if (saved?.day === day && Number.isFinite(saved.width) && saved.width > 0
        && Number.isFinite(saved.height) && saved.height > 0) {
      return { width: saved.width, height: saved.height };
    }
  } catch {
    // A malformed preference should behave like a fresh day.
  }
  return null;
}

function measureHeight(element: HTMLElement, width: number) {
  element.style.width = `${width}px`;
  element.dataset.fitting = "";
  try {
    return Math.max(MIN_AUTO_HEIGHT, Math.ceil(element.getBoundingClientRect().height));
  } finally {
    delete element.dataset.fitting;
    element.style.removeProperty("width");
  }
}

export function useCheckInWindowSize(
  data: object | null,
  memoCollapsed: boolean,
  showNewTaskInput: boolean,
  expandedTask: string | null,
) {
  const elementRef = useRef<HTMLDivElement>(null);
  const requestFit = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    let fitting = false;
    let expected: Size | null = null;
    let pending = false;
    let ready = false;
    let resizeRevision = 0;
    const win = getCurrentWindow();

    async function fit() {
      pending = true;
      if (fitting || !elementRef.current) return;
      fitting = true;
      try {
        while (pending && !disposed && elementRef.current) {
          pending = false;
          const element: HTMLDivElement = elementRef.current;
          const saved = dailyCheckInSize(localStorage.getItem(SIZE_KEY), calendarDate(Date.now()));
          const width = saved?.width ?? DEFAULT_WIDTH;
          const height = saved?.height ?? measureHeight(element, width);
          expected = await invoke<Size | null>("fit_checkin_window", { width, height });
          if (!saved && expected && Math.abs(expected.width - width) > 1 && elementRef.current === element && !disposed) {
            expected = await invoke<Size | null>("fit_checkin_window", {
              width: expected.width, height: measureHeight(element, expected.width),
            });
          }
          ready = true;
        }
      } catch (error) {
        if (!disposed) console.error("[CheckInWindow] fit failed:", error);
      } finally {
        fitting = false;
      }
    }

    requestFit.current = () => { void fit(); };

    void win.onResized(({ payload }) => {
      if (disposed || fitting || !ready) return;
      const scale = window.devicePixelRatio;
      const size = { width: payload.width / scale, height: payload.height / scale };
      if (expected && Math.abs(size.width - expected.width) <= 2
          && Math.abs(size.height - expected.height) <= 2) return;
      if (size.width <= 0 || size.height <= 0) return;
      const revision = ++resizeRevision;
      const day = calendarDate(Date.now());
      void win.isMaximized().then((maximized) => {
        if (disposed || maximized || fitting || revision !== resizeRevision || day !== calendarDate(Date.now())) return;
        try {
          localStorage.setItem(SIZE_KEY, JSON.stringify({ day, ...size }));
        } catch (error) {
          console.error("[CheckInWindow] save window size failed:", error);
        }
      }).catch(console.error);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    }).catch(console.error);

    return () => {
      disposed = true;
      requestFit.current = () => {};
      stop?.();
    };
  }, []);

  useEffect(() => {
    if (data) requestFit.current();
  }, [data, memoCollapsed, showNewTaskInput, expandedTask]);

  return elementRef;
}
