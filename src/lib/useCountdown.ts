import { useCallback, useEffect, useRef, useState } from "react";

export function useCountdown(initialSeconds: number) {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(initialSeconds);
  const pausedMs = useRef(initialSeconds * 1000);

  useEffect(() => {
    if (deadline === null) return;

    // Callbacks can be delayed or suspended. The deadline remains authoritative.
    const refresh = () => setRemaining(Math.ceil(Math.max(0, deadline - Date.now()) / 1000));
    refresh();
    const interval = window.setInterval(refresh, 1000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [deadline]);

  function toggle() {
    if (deadline !== null) {
      const ms = Math.max(0, deadline - Date.now());
      setRemaining(Math.ceil(ms / 1000));
      // Leave the expired countdown running until its completion handler runs.
      if (ms === 0) return;
      pausedMs.current = ms;
      setDeadline(null);
    } else if (pausedMs.current > 0) {
      setDeadline(Date.now() + pausedMs.current);
    }
  }

  const reset = useCallback((seconds: number, start = false) => {
    pausedMs.current = seconds * 1000;
    setRemaining(seconds);
    setDeadline(start && seconds > 0 ? Date.now() + pausedMs.current : null);
  }, []);

  return { remaining, running: deadline !== null, toggle, reset };
}
