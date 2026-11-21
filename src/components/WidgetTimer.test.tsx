// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { notifyAlarm } from "../lib/notify";
import WidgetTimer from "./WidgetTimer";

vi.mock("../lib/notify", () => ({ notifyAlarm: vi.fn() }));

it("uses wall time after skipped ticks and only alerts once on expiry", async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    vi.setSystemTime(0);
    await act(async () => root.render(<WidgetTimer initialDurationSec={1800} onDurationChange={() => {}} />));
    await act(async () => host.querySelector("button")!.click());
    vi.setSystemTime(25 * 60_000);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.textContent).toContain("00:05:00");

    await act(async () => host.querySelector("button")!.click());
    vi.setSystemTime(40 * 60_000);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.textContent).toContain("00:05:00");
    await act(async () => host.querySelector("button")!.click());

    vi.setSystemTime(46 * 60_000);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(host.textContent).toContain("00:00:00");
    await act(async () => vi.advanceTimersByTime(2000));
    expect(notifyAlarm).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
  }
});
