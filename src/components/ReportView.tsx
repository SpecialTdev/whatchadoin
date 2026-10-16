import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  checkInMemoPoints,
  type CheckInMemoPoint,
} from "../lib/checkinMemo";
import { calendarDate, formatTime, type TrackedEvent } from "../lib/events";
import { renderMarkdown } from "../lib/markdown";

interface Props {
  date: string;
  events: TrackedEvent[]; // 선택한 업무일의 이벤트 (시간 오름차순)
  checkinIntervalSec: number; // 집중 구간 캡 추정에 사용 (체크인 주기)
}

const HOUR = 3_600_000;

// task별 막대 색상 팔레트 (등장 순서대로 배정).
const TASK_PALETTE = [
  "#4f8cff",
  "#2ecc71",
  "#e67e22",
  "#9b59b6",
  "#e74c3c",
  "#1abc9c",
  "#f1c40f",
];

// 노트 이벤트 종류별 색상 (활동 트랙 틱).
function noteColor(text: string): string {
  if (text.startsWith("완료 —")) return "#2ecc71"; // 완료 = 진행
  if (text.startsWith("할 일 추가")) return "#4f8cff";
  if (text.startsWith("할 일 삭제")) return "#e74c3c";
  return "#9b59b6";
}

function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

interface Segment {
  start: number;
  end: number;
}
interface Row {
  task: string;
  color: string;
  segments: Segment[];
}
interface MemoPopup {
  task: string;
  time: number;
}

// 체크인들 → task별 집중 구간(Row). 각 체크인은 [ts, min(다음 체크인, ts+cap)) 동안
// 해당 task에 집중한 것으로 보고, 같은 task가 맞닿으면 하나의 막대로 병합한다.
// 체크인 간격이 cap을 넘으면 그 사이는 추적 공백(분절)으로 비워둔다.
function buildRows(
  checkins: { ts: number; task: string }[],
  capMs: number,
): Row[] {
  const taskOrder: string[] = [];
  const byTask = new Map<string, Segment[]>();

  checkins.forEach((c, i) => {
    const natural =
      i + 1 < checkins.length ? checkins[i + 1].ts : c.ts + capMs;
    const seg = { start: c.ts, end: Math.min(natural, c.ts + capMs) };

    if (!byTask.has(c.task)) {
      byTask.set(c.task, []);
      taskOrder.push(c.task);
    }
    const arr = byTask.get(c.task)!;
    const last = arr[arr.length - 1];
    if (last && seg.start - last.end <= 1) last.end = seg.end; // 맞닿음 → 연장
    else arr.push(seg);
  });

  return taskOrder.map((task, i) => ({
    task,
    color: TASK_PALETTE[i % TASK_PALETTE.length],
    segments: byTask.get(task)!,
  }));
}

function memoAtTime(
  points: CheckInMemoPoint[],
  task: string,
  time: number,
): CheckInMemoPoint | null {
  let selected: CheckInMemoPoint | null = null;
  for (const point of points) {
    if (point.task === task && point.ts <= time) selected = point;
  }
  return selected;
}

function ReportView({ date, events, checkinIntervalSec }: Props) {
  const [memoPopup, setMemoPopup] = useState<MemoPopup | null>(null);
  const [reportNote, setReportNote] = useState("");
  const [reportNoteStatus, setReportNoteStatus] = useState<
    "loading" | "saved" | "saving" | "error"
  >("loading");
  const reportNoteLoadedRef = useRef(false);
  const lastSavedReportNoteRef = useRef("");
  const memoPoints = useMemo(() => checkInMemoPoints(events), [events]);
  const noteEvents = useMemo(() => events.filter((e) => e.kind === "note"), [events]);
  const checkins = useMemo(
    () => memoPoints.map((point) => ({ ts: point.ts, task: point.task })),
    [memoPoints],
  );

  useEffect(() => {
    setMemoPopup(null);
  }, [date]);

  useEffect(() => {
    let cancelled = false;
    reportNoteLoadedRef.current = false;
    lastSavedReportNoteRef.current = "";
    setReportNoteStatus("loading");
    setReportNote("");

    if (!date) {
      setReportNoteStatus("saved");
      return;
    }

    invoke<string>("get_report_note", { date })
      .then((note) => {
        if (cancelled) return;
        setReportNote(note);
        lastSavedReportNoteRef.current = note;
        reportNoteLoadedRef.current = true;
        setReportNoteStatus("saved");
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[ReportView] get_report_note failed:", e);
        reportNoteLoadedRef.current = true;
        setReportNoteStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [date]);

  useEffect(() => {
    if (!date || !reportNoteLoadedRef.current) return;
    if (reportNote === lastSavedReportNoteRef.current) {
      setReportNoteStatus("saved");
      return;
    }
    setReportNoteStatus("saving");
    const timer = window.setTimeout(() => {
      invoke("save_report_note", { date, note: reportNote })
        .then(() => {
          lastSavedReportNoteRef.current = reportNote;
          setReportNoteStatus("saved");
        })
        .catch((e) => {
          console.error("[ReportView] save_report_note failed:", e);
          setReportNoteStatus("error");
        });
    }, 600);

    return () => window.clearTimeout(timer);
  }, [date, reportNote]);

  const reportNoteStatusText =
    reportNoteStatus === "loading"
      ? "불러오는 중"
      : reportNoteStatus === "saving"
        ? "저장 중"
        : reportNoteStatus === "error"
          ? "저장 실패"
          : "저장됨";

  const reportNoteSection = (
    <section className="report-section report-note-section">
      <div className="report-note-header">
        <h2>내 note</h2>
        <span className={`report-note-status ${reportNoteStatus}`}>
          {reportNoteStatusText}
        </span>
      </div>
      <textarea
        className="report-note-editor"
        value={reportNote}
        placeholder="오늘의 판단, 다음 액션, 신경 쓰이는 점을 적어두기..."
        disabled={!date || reportNoteStatus === "loading"}
        onChange={(event) => setReportNote(event.target.value)}
      />
    </section>
  );

  if (!date || events.length === 0) {
    return (
      <div className="report-view">
        <header className="report-header">
          <h1>Report</h1>
          {date && <span className="report-date">{date}</span>}
        </header>
        <div className="insights-placeholder">
          <p>이 날짜에 기록된 이벤트가 없습니다.</p>
          <p className="hint">
            노트를 수정하거나 체크인에 응답하면 이벤트가 쌓입니다.
          </p>
        </div>
        {date && reportNoteSection}
      </div>
    );
  }

  // 집중 구간 캡: 체크인 주기의 2배 (응답 누락/자리비움을 공백으로 끊기 위함).
  const capMs = Math.max(checkinIntervalSec * 1000 * 2, 5 * 60 * 1000);
  const rows = buildRows(checkins, capMs);

  // 시간축 범위: 첫 이벤트 ~ (마지막 이벤트 / 구간 끝) 중 최대를 시간 경계로 반올림.
  const segEnds = rows.flatMap((r) => r.segments.map((s) => s.end));
  const minTs = Math.min(...events.map((e) => e.ts));
  const maxTs = Math.max(...events.map((e) => e.ts), ...segEnds);
  const t0 = Math.floor(minTs / HOUR) * HOUR;
  const t1 = Math.max(Math.ceil(maxTs / HOUR) * HOUR, t0 + HOUR);
  const span = t1 - t0;
  const pct = (ts: number) => ((ts - t0) / span) * 100;
  const hourCount = Math.round(span / HOUR);
  const ticks = Array.from({ length: hourCount + 1 }, (_, i) => t0 + i * HOUR);
  const labelStep = hourCount > 12 ? 2 : 1;

  const tickHour = (ts: number) => formatTime(ts); // HH:MM (정시)

  // 인사이트 (계산형 — AI 분석은 추후 processing crate에서).
  const first = events[0];
  const last = events[events.length - 1];
  const added = noteEvents.filter((e) => e.text.startsWith("할 일 추가")).length;
  const completed = noteEvents.filter((e) => e.text.startsWith("완료 —")).length;
  let longestGap = 0;
  for (let i = 1; i < events.length; i++) {
    longestGap = Math.max(longestGap, events[i].ts - events[i - 1].ts);
  }
  const crossesDay = (ts: number) => calendarDate(ts) !== date;
  const timeWithDay = (ts: number) =>
    `${formatTime(ts)}${crossesDay(ts) ? " (익일)" : ""}`;
  const openMemoPopup = (
    task: string,
    segment: Segment,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio =
      rect.width > 0
        ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
        : 0;
    setMemoPopup({
      task,
      time: Math.round(segment.start + (segment.end - segment.start) * ratio),
    });
  };

  const renderGrid = () =>
    ticks.map((ts) => (
      <span key={ts} className="gantt-grid" style={{ left: `${pct(ts)}%` }} />
    ));
  const selectedMemoPoint = memoPopup
    ? memoAtTime(memoPoints, memoPopup.task, memoPopup.time)
    : null;

  return (
    <div className="report-view">
      <header className="report-header">
        <h1>Report</h1>
        <span className="report-date">{date}</span>
      </header>

      <section className="report-section">
        <h2>집중 타임라인</h2>

        <div className="gantt">
          {/* 시간축 */}
          <div className="gantt-row gantt-axis">
            <div className="gantt-label" />
            <div className="gantt-track gantt-axis-track">
              {ticks.map((ts, i) =>
                i % labelStep === 0 ? (
                  <span
                    key={ts}
                    className="gantt-tick"
                    style={{ left: `${pct(ts)}%` }}
                  >
                    {tickHour(ts)}
                  </span>
                ) : null,
              )}
            </div>
          </div>

          {/* task별 집중 구간 */}
          {rows.map((row) => (
            <div key={row.task} className="gantt-row">
              <div className="gantt-label" title={row.task}>
                {row.task}
              </div>
              <div className="gantt-track">
                {renderGrid()}
                {row.segments.map((s, i) => (
                  <button
                    key={i}
                    className="gantt-bar"
                    type="button"
                    style={{
                      left: `${pct(s.start)}%`,
                      width: `${Math.max(pct(s.end) - pct(s.start), 0.4)}%`,
                      background: row.color,
                    }}
                    aria-label={`${row.task} 메모 보기 ${formatTime(s.start)}-${formatTime(s.end)}`}
                    onClick={(event) => openMemoPopup(row.task, s, event)}
                    title={`${row.task} ${formatTime(s.start)}–${formatTime(s.end)}`}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* 노트 활동 (진행) */}
          {noteEvents.length > 0 && (
            <div className="gantt-row">
              <div className="gantt-label">노트 활동</div>
              <div className="gantt-track">
                {renderGrid()}
                {noteEvents.map((ev) => (
                  <span
                    key={ev.id}
                    className="gantt-note-tick"
                    style={{
                      left: `${pct(ev.ts)}%`,
                      background: noteColor(ev.text),
                    }}
                    title={`${formatTime(ev.ts)} ${ev.text}`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {rows.length === 0 && (
          <p className="hint">
            체크인 응답이 없어 집중 구간이 없습니다. 체크인에 답하면 어떤 작업에
            집중했는지 막대로 표시됩니다.
          </p>
        )}
        <p className="hint">빈 구간 = 추적 공백 (집중 분절)</p>
      </section>

      <section className="report-section">
        <h2>Insights</h2>
        <div className="insights">
          <div className="insight-item">
            <span className="insight-label">활동 구간</span>
            <span className="insight-value">
              {timeWithDay(first.ts)} – {timeWithDay(last.ts)}
            </span>
          </div>
          <div className="insight-item">
            <span className="insight-label">총 이벤트</span>
            <span className="insight-value">{events.length}건</span>
          </div>
          <div className="insight-item">
            <span className="insight-label">노트 변경</span>
            <span className="insight-value">
              {noteEvents.length}건 · 추가 {added} · 완료 {completed}
            </span>
          </div>
          <div className="insight-item">
            <span className="insight-label">체크인</span>
            <span className="insight-value">{checkins.length}회</span>
          </div>
          <div className="insight-item">
            <span className="insight-label">최장 공백</span>
            <span className="insight-value">
              {longestGap > 0 ? fmtDuration(longestGap) : "—"}
            </span>
          </div>
        </div>
      </section>

      {reportNoteSection}

      {memoPopup && (
        <div
          className="report-memo-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMemoPopup(null);
          }}
        >
          <section
            className="report-memo-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-memo-title"
          >
            <header className="report-memo-header">
              <div>
                <h2 id="report-memo-title">{memoPopup.task}</h2>
                <span>{timeWithDay(memoPopup.time)}</span>
              </div>
              <button
                className="report-memo-close"
                type="button"
                aria-label="닫기"
                onClick={() => setMemoPopup(null)}
              >
                ×
              </button>
            </header>

            <div className="report-memo-slider-row">
              <label htmlFor="report-memo-time">시간대</label>
              <input
                id="report-memo-time"
                className="report-memo-range"
                type="range"
                min={t0}
                max={t1}
                step={60_000}
                value={memoPopup.time}
                onChange={(event) =>
                  setMemoPopup({
                    ...memoPopup,
                    time: Number(event.target.value),
                  })
                }
              />
            </div>

            <div className="report-memo-meta">
              {selectedMemoPoint
                ? `메모 기록 ${timeWithDay(selectedMemoPoint.ts)}`
                : "선택한 시간대 이전 메모 없음"}
            </div>

            <div className="markdown-preview report-memo-preview">
              {renderMarkdown(
                selectedMemoPoint?.memo ?? "",
                "이 시간대에 보여줄 메모가 없습니다.",
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default ReportView;
