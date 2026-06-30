import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import LeftSidebar from "../components/LeftSidebar";
import RightSidebar from "../components/RightSidebar";
import WorkView from "../components/WorkView";
import ReportView from "../components/ReportView";
import SettingsView from "../components/SettingsView";
import {
  appendTaskToProgress,
  extractOpenTaskOptions,
  extractOpenTasks,
} from "../lib/kanban";
import { DEFAULT_NOTE, loadNote } from "../lib/note";
import {
  fetchEvents,
  isReportEvent,
  workDayKey,
  type TrackedEvent,
} from "../lib/events";
import { latestMemoByTask } from "../lib/checkinMemo";
import type {
  CheckInMode,
  CheckInStatus,
  CheckInSubmitEvent,
} from "../lib/checkin";
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
const LEFT_SIDEBAR_KEY = "layout.leftSidebarVisible";
const RIGHT_SIDEBAR_KEY = "layout.rightSidebarVisible";
const RIGHT_SIDEBAR_WIDTH_KEY = "layout.rightSidebarWidth";
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 200;
const MIN_RIGHT_SIDEBAR_WIDTH = 160;
const MAX_RIGHT_SIDEBAR_WIDTH = 420;
const MIN_MAIN_WIDTH = 320;
const RIGHT_SIDEBAR_KEYBOARD_STEP = 10;

type TauriCore = typeof import("@tauri-apps/api/core");

type PlatformInfo = {
  os: string;
};

let coreApiPromise: Promise<TauriCore> | null = null;

function coreApi(): Promise<TauriCore> {
  if (!coreApiPromise) {
    coreApiPromise = import("@tauri-apps/api/core").catch((e) => {
      coreApiPromise = null;
      throw e;
    });
  }
  return coreApiPromise;
}

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

function loadStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

function loadStoredNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function storeBoolean(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // 저장 실패는 무시 (세션 한정으로 동작)
  }
}

function storeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // 저장 실패는 무시 (세션 한정으로 동작)
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readCssPixelValue(style: CSSStyleDeclaration, name: string): number {
  const value = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(value) ? value : 0;
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function useStableStringArray(values: string[]): string[] {
  const ref = useRef(values);
  return useMemo(() => {
    if (!sameStringArray(ref.current, values)) ref.current = values;
    return ref.current;
  }, [values]);
}

function App() {
  const [tab, setTab] = useState<Tab>("work");
  const [isMacos, setIsMacos] = useState<boolean>(() => {
    const platform = navigator.platform || navigator.userAgent;
    return /mac/i.test(platform);
  });
  const [leftSidebarVisible, setLeftSidebarVisible] = useState<boolean>(() =>
    loadStoredBoolean(LEFT_SIDEBAR_KEY, true),
  );
  const [rightSidebarVisible, setRightSidebarVisible] = useState<boolean>(() =>
    loadStoredBoolean(RIGHT_SIDEBAR_KEY, true),
  );
  const [rightSidebarWidth, setRightSidebarWidth] = useState<number>(() =>
    clampNumber(
      loadStoredNumber(RIGHT_SIDEBAR_WIDTH_KEY, DEFAULT_RIGHT_SIDEBAR_WIDTH),
      MIN_RIGHT_SIDEBAR_WIDTH,
      MAX_RIGHT_SIDEBAR_WIDTH,
    ),
  );
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [note, setNote] = useState<string>(DEFAULT_NOTE);
  const [activeTask, setActiveTask] = useState<string | null>(null);
  const [checkInMode, setCheckInMode] = useState<CheckInMode>("off");
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
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const rightSidebarWidthRef = useRef(rightSidebarWidth);
  const noteRef = useRef(note);

  useEffect(() => {
    rightSidebarWidthRef.current = rightSidebarWidth;
  }, [rightSidebarWidth]);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  // 시작 시 OS 알림 권한을 확보한다 (없으면 체크인·타이머 알림이 조용히 무시됨).
  useEffect(() => {
    (async () => {
      try {
        const { isPermissionGranted, requestPermission } = await import(
          "@tauri-apps/plugin-notification"
        );
        if (!(await isPermissionGranted())) await requestPermission();
      } catch (e) {
        console.error("[App] notification permission failed:", e);
      }
    })();
  }, []);

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

  const handleNoteDraftChange = useCallback((draft: string) => {
    noteRef.current = draft;
  }, []);

  // 체크인 후보 = 노트의 실제 todo 항목
  const derivedTasks = useMemo(() => extractOpenTasks(note), [note]);
  const tasks = useStableStringArray(derivedTasks);
  const taskOptions = useMemo(() => extractOpenTaskOptions(note), [note]);

  const tasksRef = useRef(tasks);
  const taskOptionsRef = useRef(taskOptions);
  const activeTaskRef = useRef(activeTask);
  const checkInModeRef = useRef(checkInMode);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    taskOptionsRef.current = taskOptions;
  }, [taskOptions]);
  useEffect(() => {
    activeTaskRef.current = activeTask;
  }, [activeTask]);
  useEffect(() => {
    checkInModeRef.current = checkInMode;
  }, [checkInMode]);

  const applyCheckInStatus = useCallback((status: CheckInStatus) => {
    setCheckInMode(status.mode);
    setActiveTask(status.active_task);
  }, []);

  useEffect(() => {
    noteRef.current = note;
  }, [note]);

  useEffect(() => {
    coreApi()
      .then(({ invoke }) => invoke<PlatformInfo>("get_platform_info"))
      .then((info) => setIsMacos(info.os === "macos"))
      .catch((e) => console.error("[App] get_platform_info failed:", e));
  }, []);

  useEffect(() => {
    storeBoolean(LEFT_SIDEBAR_KEY, leftSidebarVisible);
  }, [leftSidebarVisible]);

  useEffect(() => {
    storeBoolean(RIGHT_SIDEBAR_KEY, rightSidebarVisible);
  }, [rightSidebarVisible]);

  const getClampedRightSidebarWidth = useCallback((value: number): number => {
    const layoutEl = layoutRef.current;
    if (!layoutEl) {
      return clampNumber(value, MIN_RIGHT_SIDEBAR_WIDTH, MAX_RIGHT_SIDEBAR_WIDTH);
    }

    const rect = layoutEl.getBoundingClientRect();
    const style = getComputedStyle(layoutEl);
    const leftWidth = readCssPixelValue(style, "--left-sidebar-width");
    const maxByLayout = Math.max(
      MIN_RIGHT_SIDEBAR_WIDTH,
      rect.width - leftWidth - MIN_MAIN_WIDTH,
    );
    return clampNumber(
      value,
      MIN_RIGHT_SIDEBAR_WIDTH,
      Math.min(MAX_RIGHT_SIDEBAR_WIDTH, maxByLayout),
    );
  }, []);

  const commitRightSidebarWidth = useCallback(
    (value: number) => {
      const nextWidth = getClampedRightSidebarWidth(Math.round(value));
      rightSidebarWidthRef.current = nextWidth;
      layoutRef.current?.style.setProperty(
        "--right-sidebar-width",
        `${nextWidth}px`,
      );
      setRightSidebarWidth(nextWidth);
      storeNumber(RIGHT_SIDEBAR_WIDTH_KEY, nextWidth);
    },
    [getClampedRightSidebarWidth],
  );

  const widthFromPointerX = useCallback(
    (clientX: number): number => {
      const layoutEl = layoutRef.current;
      if (!layoutEl) return rightSidebarWidthRef.current;
      const rect = layoutEl.getBoundingClientRect();
      return getClampedRightSidebarWidth(rect.right - clientX);
    },
    [getClampedRightSidebarWidth],
  );

  const handleRightSidebarSplitterPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!rightSidebarVisible || event.button !== 0) return;

      event.preventDefault();
      const splitter = event.currentTarget;
      const layoutEl = layoutRef.current;
      splitter.setPointerCapture(event.pointerId);
      document.body.classList.add("right-sidebar-resizing");
      layoutEl?.classList.add("right-sidebar-resizing");

      const updateWidth = (clientX: number) => {
        const nextWidth = widthFromPointerX(clientX);
        rightSidebarWidthRef.current = nextWidth;
        layoutEl?.style.setProperty("--right-sidebar-width", `${nextWidth}px`);
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        updateWidth(moveEvent.clientX);
      };

      const finishDrag = (upEvent?: PointerEvent) => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", finishDrag);
        window.removeEventListener("pointercancel", finishDrag);
        document.body.classList.remove("right-sidebar-resizing");
        layoutEl?.classList.remove("right-sidebar-resizing");
        dragCleanupRef.current = null;

        if (splitter.hasPointerCapture(event.pointerId)) {
          splitter.releasePointerCapture(event.pointerId);
        }
        if (upEvent) updateWidth(upEvent.clientX);
        commitRightSidebarWidth(rightSidebarWidthRef.current);
      };

      dragCleanupRef.current = () => finishDrag();
      updateWidth(event.clientX);
      window.addEventListener("pointermove", handlePointerMove, {
        passive: false,
      });
      window.addEventListener("pointerup", finishDrag);
      window.addEventListener("pointercancel", finishDrag);
    },
    [
      commitRightSidebarWidth,
      rightSidebarVisible,
      widthFromPointerX,
    ],
  );

  const handleRightSidebarSplitterKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!rightSidebarVisible) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? 1 : -1;
      commitRightSidebarWidth(
        rightSidebarWidthRef.current + direction * RIGHT_SIDEBAR_KEYBOARD_STEP,
      );
    },
    [commitRightSidebarWidth, rightSidebarVisible],
  );

  // 체크인 주기는 Rust 백그라운드 타이머가 관리한다. 메인 웹뷰가 닫혀도
  // 최신 후보/활성 작업/주기만 유지되면 checkin 창을 계속 띄울 수 있다.
  useEffect(() => {
    coreApi()
      .then(({ invoke }) =>
        invoke("update_checkin_context", {
          tasks,
          taskOptions,
          activeTask,
          intervalSec,
        }),
      )
      .catch((e) => console.error("[App] update_checkin_context failed:", e));
  }, [tasks, taskOptions, activeTask, intervalSec]);

  const handleCheckInSubmit = useCallback((task: string) => {
    setActiveTask(task);
    // 노트에 없던 새 작업이면 실제 todo로 편입
    setNote((prev) => {
      const latest = noteRef.current || prev;
      const next = extractOpenTaskOptions(latest).some((option) => option.value === task)
        ? latest
        : appendTaskToProgress(latest, task);
      noteRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    coreApi()
      .then(({ invoke }) => invoke<CheckInStatus>("get_checkin_status"))
      .then(applyCheckInStatus)
      .catch((e) => console.error("[App] get_checkin_status failed:", e));
  }, [applyCheckInStatus]);

  // 시작 시 저장된 노트를 디스크에서 불러온다. 저장본이 없으면(최초 실행)
  // DEFAULT_NOTE를 그대로 두고, 빈 문자열이면 사용자가 비운 상태를 존중한다.
  // 저장은 프런트가 하지 않는다 — Rust가 15s poll 주기·종료 시점에 영속한다.
  useEffect(() => {
    let cancelled = false;
    loadNote()
      .then((stored) => {
        if (!cancelled && stored !== null) {
          noteRef.current = stored;
          setNote(stored);
        }
      })
      .catch((e) => console.error("[App] loadNote failed:", e));
    return () => {
      cancelled = true;
    };
  }, []);

  // note 변경을 Rust 수집기에 push한다 (백그라운드 15s diff의 입력 + 영속 소스).
  // 추적/이벤트 기록과 디스크 저장은 Rust collection crate/타이머가 담당하고,
  // 여기선 최신 스냅샷만 넘긴다.
  useEffect(() => {
    coreApi()
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
          await listen<CheckInSubmitEvent>("checkin://submit", (event) => {
            console.log("[App] received checkin://submit, payload:", event.payload);
            handleCheckInSubmit(event.payload.task);
          }),
        );

        register(
          await listen<CheckInStatus>("checkin://status", (event) => {
            console.log("[App] received checkin://status, payload:", event.payload);
            applyCheckInStatus(event.payload);
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
  }, [applyCheckInStatus, handleCheckInSubmit]);

  const openCheckIn = useCallback(async () => {
    try {
      const { invoke } = await coreApi();
      console.log("[App] invoking open_checkin, tasks:", tasksRef.current, "activeTask:", activeTaskRef.current);
      await invoke("open_checkin", {
        tasks: tasksRef.current,
        taskOptions: taskOptionsRef.current,
        activeTask: activeTaskRef.current,
      });
      console.log("[App] open_checkin returned");
    } catch (e) {
      console.error("[App] open_checkin error:", e);
    }
  }, []);

  const handleTaskChipCheckIn = useCallback(async (task: string) => {
    try {
      const { invoke } = await coreApi();
      const events = await fetchEvents();
      const memo = latestMemoByTask(events)[task] ?? "";

      if (checkInModeRef.current !== "working") {
        const status = await invoke<CheckInStatus>("clock_in");
        applyCheckInStatus(status);
      }

      await invoke("submit_checkin", { task, memo });
    } catch (e) {
      console.error("[App] task chip check-in failed:", e);
      throw e;
    }
  }, [applyCheckInStatus]);

  const runCheckInStatusCommand = useCallback(
    async (command: "clock_in" | "clock_out" | "end_break") => {
      try {
        const { invoke } = await coreApi();
        const status = await invoke<CheckInStatus>(command);
        applyCheckInStatus(status);
      } catch (e) {
        console.error(`[App] ${command} failed:`, e);
      }
    },
    [applyCheckInStatus],
  );

  const sessionLabel =
    checkInMode === "off"
      ? "퇴근 상태"
      : checkInMode === "break"
        ? "휴식 중"
        : activeTask
          ? `근무 중 · ${activeTask}`
          : "근무 중";

  const workSessionControls = (
    <div className={`work-session-controls ${checkInMode}`}>
      <span className="work-session-label">{sessionLabel}</span>
      {checkInMode === "off" ? (
        <button
          className="work-session-btn primary"
          type="button"
          onClick={() => runCheckInStatusCommand("clock_in")}
        >
          출근
        </button>
      ) : (
        <>
          {checkInMode === "break" ? (
            <button
              className="work-session-btn primary"
              type="button"
              onClick={() => runCheckInStatusCommand("end_break")}
            >
              휴식 종료
            </button>
          ) : (
            <button
              className="work-session-btn"
              type="button"
              onClick={openCheckIn}
            >
              체크인
            </button>
          )}
          <button
            className="work-session-btn danger"
            type="button"
            onClick={() => runCheckInStatusCommand("clock_out")}
          >
            퇴근
          </button>
        </>
      )}
    </div>
  );

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

  const layoutClassName = [
    "layout",
    isMacos ? "macos-titlebar" : "",
    leftSidebarVisible ? "" : "left-sidebar-collapsed",
    rightSidebarVisible ? "" : "right-sidebar-collapsed",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={layoutRef}
      className={layoutClassName}
      style={
        {
          "--right-sidebar-width": rightSidebarVisible
            ? `${rightSidebarWidth}px`
            : "0px",
        } as CSSProperties
      }
    >
      {isMacos && (
        <div className="native-titlebar-controls">
          <div className="titlebar-drag-region" data-tauri-drag-region />
          <div className="native-titlebar-title">Whatchadoin</div>
          <button
            className="sidebar-toggle left"
            type="button"
            aria-label={
              leftSidebarVisible ? "왼쪽 사이드바 접기" : "왼쪽 사이드바 펼치기"
            }
            aria-pressed={leftSidebarVisible}
            onClick={() => setLeftSidebarVisible((visible) => !visible)}
          >
            <span className="sidebar-toggle-icon" aria-hidden="true" />
          </button>
          <button
            className="sidebar-toggle right"
            type="button"
            aria-label={
              rightSidebarVisible
                ? "오른쪽 사이드바 접기"
                : "오른쪽 사이드바 펼치기"
            }
            aria-pressed={rightSidebarVisible}
            onClick={() => setRightSidebarVisible((visible) => !visible)}
          >
            <span className="sidebar-toggle-icon" aria-hidden="true" />
          </button>
        </div>
      )}

      <LeftSidebar
        className={leftSidebarVisible ? "" : "hidden"}
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
            onNoteDraftChange={handleNoteDraftChange}
            tasks={tasks}
            taskOptions={taskOptions}
            activeTask={activeTask}
            onTaskCheckIn={handleTaskChipCheckIn}
            focusSignal={noteFocusNonce}
            footerAction={workSessionControls}
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

      {rightSidebarVisible && (
        <div
          className="right-sidebar-splitter"
          role="separator"
          aria-label="오른쪽 사이드바 크기 조절"
          aria-orientation="vertical"
          aria-valuemin={MIN_RIGHT_SIDEBAR_WIDTH}
          aria-valuemax={MAX_RIGHT_SIDEBAR_WIDTH}
          aria-valuenow={rightSidebarWidth}
          tabIndex={0}
          onPointerDown={handleRightSidebarSplitterPointerDown}
          onKeyDown={handleRightSidebarSplitterKeyDown}
        />
      )}

      <RightSidebar className={rightSidebarVisible ? "" : "hidden"} />
    </div>
  );
}

export default App;
