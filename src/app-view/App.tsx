import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import LeftSidebar from "../components/LeftSidebar";
import RightSidebar from "../components/RightSidebar";
import WorkView from "../components/WorkView";
import ReportView from "../components/ReportView";
import { parseMarkdown, serializeBoard, newCard, newColumn } from "../lib/kanban";
import "./App.css";

export type Tab = "work" | "report";

const SAMPLE_DATES = ["2026-05-29", "2026-05-28", "2026-05-27"];
const CHECK_IN_INTERVAL_MS = 60_000;

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
  const [selectedDate, setSelectedDate] = useState<string>(SAMPLE_DATES[0]);
  const [note, setNote] = useState<string>(SAMPLE_NOTE);
  const [activeTask, setActiveTask] = useState<string | null>(null);

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

  const handleCheckInSubmit = useCallback((task: string) => {
    setActiveTask(task);
    // 노트에 없던 새 작업이면 실제 todo로 편입
    setNote((prev) => (deriveTasks(prev).includes(task) ? prev : appendTask(prev, task)));
  }, []);

  // Listen for submit result emitted by Rust
  useEffect(() => {
    let cancelled = false;
    let unlistenSubmit: (() => void) | null = null;

    async function setup() {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        console.log("[App] registering listen(checkin://submit)");
        const unlisten = await listen<string>("checkin://submit", (event) => {
          console.log("[App] received checkin://submit, payload:", event.payload);
          handleCheckInSubmit(event.payload);
        });
        if (cancelled) {
          unlisten();
        } else {
          unlistenSubmit = unlisten;
          console.log("[App] listen(checkin://submit) registered");
        }
      } catch (e) {
        console.error("[App] listen setup failed:", e);
      }
    }

    setup();
    return () => {
      cancelled = true;
      unlistenSubmit?.();
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

  // Timer: open/show checkin window
  useEffect(() => {
    const id = setInterval(openCheckIn, CHECK_IN_INTERVAL_MS);
    return () => clearInterval(id);
  }, [openCheckIn]);

  return (
    <div className="layout">
      <LeftSidebar
        tab={tab}
        onTabChange={setTab}
        dates={SAMPLE_DATES}
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
          />
        ) : (
          <ReportView date={selectedDate} />
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
