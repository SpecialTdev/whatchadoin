import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import LeftSidebar from "../components/LeftSidebar";
import RightSidebar from "../components/RightSidebar";
import WorkView from "../components/WorkView";
import ReportView from "../components/ReportView";
import SettingsView from "../components/SettingsView";
import { parseMarkdown, serializeBoard, newCard, newColumn } from "../lib/kanban";
import {
  fetchEvents,
  isReportEvent,
  workDayKey,
  type TrackedEvent,
} from "../lib/events";
import "./App.css";

export type Tab = "work" | "report" | "settings";

// 체크인 팝업 주기 (초 단위): 1분~30분, 10초 단위
const MIN_SEC = 60;
const MAX_SEC = 1800;
const DEFAULT_SEC = 60;
const STORAGE_KEY = "checkin.intervalSec";

// 리포트 하루 경계 시각(시): 자정~오전 11시. 이 시각 전 이벤트는 전날 업무일로 묶인다.
const MIN_BOUNDARY = 0;
const MAX_BOUNDARY = 11;
const DEFAULT_BOUNDARY = 5;
const BOUNDARY_KEY = "report.dayBoundaryHour";

// localStorage에서 저장된 주기를 읽어 [MIN_SEC, MAX_SEC]로 clamp, 없으면 기본값.
function loadIntervalSec(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return DEFAULT_SEC;
    const sec = Number(raw);
    if (!Number.isFinite(sec)) return DEFAULT_SEC;
    return Math.min(MAX_SEC, Math.max(MIN_SEC, Math.round(sec)));
  } catch {
    return DEFAULT_SEC;
  }
}

// 저장된 하루 경계 시각을 읽어 [MIN_BOUNDARY, MAX_BOUNDARY]로 clamp, 없으면 기본값.
function loadBoundaryHour(): number {
  try {
    const raw = localStorage.getItem(BOUNDARY_KEY);
    if (raw == null) return DEFAULT_BOUNDARY;
    const h = Number(raw);
    if (!Number.isFinite(h)) return DEFAULT_BOUNDARY;
    return Math.min(MAX_BOUNDARY, Math.max(MIN_BOUNDARY, Math.round(h)));
  } catch {
    return DEFAULT_BOUNDARY;
  }
}

const SAMPLE_NOTE = `# 오늘의 작업

## 진행 중
- [ ] 칸반 리포트 레이아웃 구현
- [ ] tracking 이벤트 스키마 정의

## 완료
- [x] Tauri 개발 환경 셋업
- [x] mockup 브랜치 생성

## 메모
화면만 띄워두지 말고 실제로 밀도있게...
`;

// 노트(todo)에서 체크인 후보를 뽑는다: 미완료·비어있지 않은 항목, 중복 제거.
function deriveTasks(note: string): string[] {
  const board = parseMarkdown(note);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const col of board.columns) {
    for (const card of col.cards) {
      const t = card.text.trim();
      if (!card.done && t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out;
}

// 체크인에서 입력한 새 작업을 노트의 '진행 중'(없으면 첫 컬럼/신규 컬럼)에 추가한다.
function appendTask(note: string, task: string): string {
  const board = parseMarkdown(note);
  if (board.columns.length === 0) board.columns.push(newColumn("진행 중"));
  const target =
    board.columns.find((c) => c.title.includes("진행")) ?? board.columns[0];
  target.cards.push(newCard(task));
  return serializeBoard(board);
}

function App() {
  const [tab, setTab] = useState<Tab>("work");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [note, setNote] = useState<string>(SAMPLE_NOTE);
  const [activeTask, setActiveTask] = useState<string | null>(null);
  // 체크인의 '직접 입력' → Work view 활성화 신호 (값이 바뀌면 노트 에디터 포커스)
  const [noteFocusNonce, setNoteFocusNonce] = useState(0);
  // 체크인 팝업 주기(초). 슬라이더로 조절, localStorage에 유지.
  const [intervalSec, setIntervalSec] = useState<number>(() => loadIntervalSec());
  // 리포트 하루 경계 시각(시). 슬라이더로 조절, localStorage에 유지.
  const [dayBoundaryHour, setDayBoundaryHour] = useState<number>(() =>
    loadBoundaryHour(),
  );
  // 리포트용 이벤트 목록 (report 탭 진입 시 Rust에서 로드).
  const [reportEvents, setReportEvents] = useState<TrackedEvent[]>([]);

  const handleIntervalChange = useCallback((sec: number) => {
    setIntervalSec(sec);
    try {
      localStorage.setItem(STORAGE_KEY, String(sec));
    } catch {
      // 저장 실패는 무시 (세션 한정으로 동작)
    }
  }, []);

  const handleBoundaryChange = useCallback((hour: number) => {
    setDayBoundaryHour(hour);
    try {
      localStorage.setItem(BOUNDARY_KEY, String(hour));
    } catch {
      // 저장 실패는 무시
    }
  }, []);

  // 체크인 후보 = 노트의 실제 todo 항목
  const tasks = useMemo(() => deriveTasks(note), [note]);

  const tasksRef = useRef(tasks);
  const activeTaskRef = useRef(activeTask);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    activeTaskRef.current = activeTask;
  }, [activeTask]);

  // 체크인 주기는 Rust 백그라운드 타이머가 관리한다. 메인 웹뷰가 닫혀도
  // 최신 후보/활성 작업/주기만 유지되면 checkin 창을 계속 띄울 수 있다.
  useEffect(() => {
    import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke("update_checkin_context", {
          tasks,
          activeTask,
          intervalSec,
        }),
      )
      .catch((e) => console.error("[App] update_checkin_context failed:", e));
  }, [tasks, activeTask, intervalSec]);

  const handleCheckInSubmit = useCallback((task: string) => {
    setActiveTask(task);
    // 노트에 없던 새 작업이면 실제 todo로 편입
    setNote((prev) => (deriveTasks(prev).includes(task) ? prev : appendTask(prev, task)));
  }, []);

  // note 변경을 Rust 수집기에 push한다 (백그라운드 15s diff의 입력). 추적/이벤트
  // 기록은 Rust collection crate가 담당하고, 여기선 최신 스냅샷만 넘긴다.
  useEffect(() => {
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("update_note", { note }))
      .catch((e) => console.error("[App] update_note failed:", e));
  }, [note]);

  // Listen for events emitted by Rust (submit / direct-input)
  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    async function setup() {
      try {
        const { listen } = await import("@tauri-apps/api/event");

        const register = (un: () => void) => {
          if (cancelled) un();
          else unlisteners.push(un);
        };

        register(
          await listen<string>("checkin://submit", (event) => {
            console.log("[App] received checkin://submit, payload:", event.payload);
            handleCheckInSubmit(event.payload);
          }),
        );

        register(
          await listen("checkin://direct", () => {
            console.log("[App] received checkin://direct → Work view 활성화");
            setTab("work");
            setNoteFocusNonce((n) => n + 1);
          }),
        );
      } catch (e) {
        console.error("[App] listen setup failed:", e);
      }
    }

    setup();
    return () => {
      cancelled = true;
      unlisteners.forEach((un) => un());
    };
  }, [handleCheckInSubmit]);

  const openCheckIn = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      console.log("[App] invoking open_checkin, tasks:", tasksRef.current, "activeTask:", activeTaskRef.current);
      await invoke("open_checkin", {
        tasks: tasksRef.current,
        activeTask: activeTaskRef.current,
      });
      console.log("[App] open_checkin returned");
    } catch (e) {
      console.error("[App] open_checkin error:", e);
    }
  }, []);

  // report 탭 진입 시 이벤트를 로드한다 (리포트는 회고용이라 진입 시 새로고침으로 충분).
  useEffect(() => {
    if (tab !== "report") return;
    let cancelled = false;
    fetchEvents()
      .then((evs) => {
        if (!cancelled) setReportEvents(evs);
      })
      .catch((e) => console.error("[App] fetchEvents (report) failed:", e));
    return () => {
      cancelled = true;
    };
  }, [tab]);

  // 이벤트에서 업무일 목록을 도출 (최신순). 하루 경계 설정을 반영.
  const reportDates = useMemo(() => {
    const set = new Set<string>();
    for (const ev of reportEvents) {
      if (isReportEvent(ev)) set.add(workDayKey(ev.ts, dayBoundaryHour));
    }
    return Array.from(set).sort().reverse();
  }, [reportEvents, dayBoundaryHour]);

  // 선택 날짜가 목록에 없으면 가장 최근 업무일로 맞춘다.
  useEffect(() => {
    if (reportDates.length === 0) return;
    if (!reportDates.includes(selectedDate)) setSelectedDate(reportDates[0]);
  }, [reportDates, selectedDate]);

  // 선택한 업무일의 이벤트 (시간 오름차순).
  const reportDayEvents = useMemo(
    () =>
      reportEvents
        .filter(
          (ev) =>
            isReportEvent(ev) &&
            workDayKey(ev.ts, dayBoundaryHour) === selectedDate,
        )
        .sort((a, b) => a.ts - b.ts),
    [reportEvents, dayBoundaryHour, selectedDate],
  );

  return (
    <div className="layout">
      <LeftSidebar
        tab={tab}
        onTabChange={setTab}
        dates={reportDates}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />

      <main className="main">
        {tab === "work" ? (
          <WorkView
            note={note}
            onNoteChange={setNote}
            tasks={tasks}
            activeTask={activeTask}
            focusSignal={noteFocusNonce}
          />
        ) : tab === "report" ? (
          <ReportView
            date={selectedDate}
            events={reportDayEvents}
            checkinIntervalSec={intervalSec}
          />
        ) : (
          <SettingsView
            intervalSec={intervalSec}
            minSec={MIN_SEC}
            maxSec={MAX_SEC}
            onIntervalChange={handleIntervalChange}
            boundaryHour={dayBoundaryHour}
            minBoundary={MIN_BOUNDARY}
            maxBoundary={MAX_BOUNDARY}
            onBoundaryChange={handleBoundaryChange}
          />
        )}
      </main>

      <RightSidebar />

      <button className="debug-checkin-btn" onClick={openCheckIn}>
        체크인
      </button>
    </div>
  );
}

export default App;
