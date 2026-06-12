import type { TrackedEvent } from "./events";

export interface ParsedCheckInMemo {
  task: string;
  memo: string;
}

export interface CheckInMemoPoint extends ParsedCheckInMemo {
  id: number;
  ts: number;
}

export function parseCheckInMemo(text: string): ParsedCheckInMemo | null {
  const [firstLine, ...memoLines] = text.split("\n");
  const match = firstLine.match(/^체크인 — '(.*)' 작업 중$/);
  if (!match) return null;

  let memo = memoLines.join("\n");
  if (memo.startsWith("\n")) memo = memo.slice(1);
  return {
    task: match[1],
    memo: memo.trimEnd(),
  };
}

export function checkInMemoPoints(events: TrackedEvent[]): CheckInMemoPoint[] {
  return events
    .filter((event) => event.kind === "checkin")
    .map((event) => {
      const parsed = parseCheckInMemo(event.text);
      return parsed
        ? {
            id: event.id,
            ts: event.ts,
            task: parsed.task,
            memo: parsed.memo,
          }
        : null;
    })
    .filter((point): point is CheckInMemoPoint => point !== null)
    .sort((a, b) => a.ts - b.ts || a.id - b.id);
}

export function latestMemoByTask(events: TrackedEvent[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const point of [...checkInMemoPoints(events)].reverse()) {
    if (out[point.task] == null) {
      out[point.task] = point.memo;
    }
  }
  return out;
}
