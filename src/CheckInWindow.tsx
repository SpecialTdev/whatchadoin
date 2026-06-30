import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CheckInStatus, CheckInTaskOption } from "./lib/checkin";
import { latestMemoByTask } from "./lib/checkinMemo";
import { fetchEvents } from "./lib/events";
import { renderMarkdown } from "./lib/markdown";
import "./app-view/App.css";
import "./CheckInWindow.css";

interface CheckInData extends CheckInStatus {
  tasks: string[];
  task_options?: CheckInTaskOption[];
}

const MEMO_COLLAPSED_STORAGE_KEY = "checkin:memo-collapsed";
const CHECKIN_MEMO_HEIGHT_DELTA = 220;
const CHECKIN_MIN_HEIGHT = 320;

function CheckInWindow() {
  const [data, setData] = useState<CheckInData | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [newTask, setNewTask] = useState("");
  const [memo, setMemo] = useState("");
  const [memoByTask, setMemoByTask] = useState<Record<string, string>>({});
  const [memoDirty, setMemoDirty] = useState(false);
  const [showNewTaskInput, setShowNewTaskInput] = useState(false);
  const [showSubtasks, setShowSubtasks] = useState(false);
  const [memoCollapsed, setMemoCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(MEMO_COLLAPSED_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const initialCollapsedResizeAppliedRef = useRef(false);
  const taskOptionsRef = useRef<CheckInTaskOption[]>([]);

  function fillMemoForTask(task: string, memos = memoByTask) {
    setMemo(task ? memos[task] ?? "" : "");
    setMemoDirty(false);
  }

  function selectExistingTask(task: string) {
    setSelected(task);
    fillMemoForTask(task);
  }

  function getTaskOptions(d: CheckInData): CheckInTaskOption[] {
    return d.task_options && d.task_options.length > 0
      ? d.task_options
      : d.tasks.map((task) => ({ kind: "parent", label: task, value: task }));
  }

  function handleNewTaskChange(value: string) {
    setNewTask(value);
    if (!memoDirty) fillMemoForTask(value.trim());
  }

  function handleMemoChange(value: string) {
    setMemo(value);
    setMemoDirty(true);
  }

  async function offsetCheckInWindowHeight(delta: number) {
    const win = getCurrentWindow();
    const [innerSize, scaleFactor] = await Promise.all([win.innerSize(), win.scaleFactor()]);
    const logicalSize = innerSize.toLogical(scaleFactor);
    await win.setSize(
      new LogicalSize(logicalSize.width, Math.max(CHECKIN_MIN_HEIGHT, logicalSize.height + delta)),
    );
  }

  async function resizeMemoWindow(collapsed: boolean) {
    try {
      await offsetCheckInWindowHeight(collapsed ? -CHECKIN_MEMO_HEIGHT_DELTA : CHECKIN_MEMO_HEIGHT_DELTA);
    } catch (e) {
      console.error("[CheckInWindow] resize failed:", e);
    }
  }

  function toggleMemoCollapsed() {
    const next = !memoCollapsed;
    setMemoCollapsed(next);
    try {
      window.localStorage.setItem(MEMO_COLLAPSED_STORAGE_KEY, String(next));
    } catch (e) {
      console.error("[CheckInWindow] memo collapse preference save failed:", e);
    }
    resizeMemoWindow(next);
  }

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    async function loadData() {
      console.log("[CheckInWindow] loading get_checkin_data");
      try {
        const d = await invoke<CheckInData>("get_checkin_data");
        if (cancelled) return;
        let memos: Record<string, string> = {};
        try {
          memos = latestMemoByTask(await fetchEvents());
        } catch (e) {
          console.error("[CheckInWindow] latest memo load failed:", e);
        }
        if (cancelled) return;
        console.log("[CheckInWindow] get_checkin_data returned:", d);
        const task = d.active_task ?? d.tasks[0] ?? "";
        const options = getTaskOptions(d);
        const selectedOption = options.find((option) => option.value === task);
        taskOptionsRef.current = options;
        setData(d);
        setMemoByTask(memos);
        setSelected(task);
        setNewTask("");
        setMemo(task ? memos[task] ?? "" : "");
        setMemoDirty(false);
        setShowNewTaskInput(d.active_task === null);
        setShowSubtasks(selectedOption?.kind === "subitem");
      } catch (e) {
        console.error("[CheckInWindow] get_checkin_data error:", e);
      }
    }

    loadData();

    // 숨겼다가 다시 보여줄 때 Rust가 보내는 refresh 이벤트로 최신 데이터를 다시 가져온다.
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const refreshUnlisten = await listen("checkin://refresh", () => {
          console.log("[CheckInWindow] received checkin://refresh");
          loadData();
        });
        const statusUnlisten = await listen<CheckInStatus>("checkin://status", (event) => {
          console.log("[CheckInWindow] received checkin://status", event.payload);
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  active_task: event.payload.active_task,
                  mode: event.payload.mode,
                }
              : prev,
          );
          setSelected((prev) => event.payload.active_task ?? prev);
          setShowSubtasks((prev) => {
            if (!event.payload.active_task) return prev;
            return (
              taskOptionsRef.current.find(
                (option) => option.value === event.payload.active_task,
              )?.kind === "subitem" || prev
            );
          });
        });
        if (cancelled) {
          refreshUnlisten();
          statusUnlisten();
        } else {
          unlisteners.push(refreshUnlisten, statusUnlisten);
        }
      } catch (e) {
        console.error("[CheckInWindow] refresh listen failed:", e);
      }
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (data?.mode !== "working") return;
    if (!memoCollapsed || initialCollapsedResizeAppliedRef.current) return;
    initialCollapsedResizeAppliedRef.current = true;

    async function applyInitialCollapsedHeight() {
      try {
        await offsetCheckInWindowHeight(-CHECKIN_MEMO_HEIGHT_DELTA);
      } catch (e) {
        console.error("[CheckInWindow] initial collapsed resize failed:", e);
      }
    }

    applyInitialCollapsedHeight();
  }, [data?.mode, memoCollapsed]);

  function applyStatus(status: CheckInStatus) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            active_task: status.active_task,
            mode: status.mode,
          }
        : prev,
    );
    setSelected((prev) => status.active_task ?? prev);
  }

  async function handleClockIn() {
    try {
      const status = await invoke<CheckInStatus>("clock_in");
      applyStatus(status);
    } catch (e) {
      console.error("[CheckInWindow] clock_in error:", e);
    }
  }

  async function handleClockOut() {
    try {
      await invoke<CheckInStatus>("clock_out");
    } catch (e) {
      console.error("[CheckInWindow] clock_out error:", e);
    }
    await getCurrentWindow().hide();
  }

  async function handleStartBreak() {
    try {
      await invoke<CheckInStatus>("start_break");
    } catch (e) {
      console.error("[CheckInWindow] start_break error:", e);
    }
    await getCurrentWindow().hide();
  }

  async function handleEndBreak() {
    try {
      await invoke<CheckInStatus>("end_break");
    } catch (e) {
      console.error("[CheckInWindow] end_break error:", e);
    }
    await getCurrentWindow().hide();
  }

  async function handleSubmit() {
    const task = showNewTaskInput ? newTask.trim() : selected;
    if (!task || data?.mode !== "working") return;

    console.log("[CheckInWindow] invoking submit_checkin, task:", task);
    try {
      await invoke("submit_checkin", { task, memo: memo.trim() });
      setMemoByTask((prev) => ({ ...prev, [task]: memo.trim() }));
      setMemoDirty(false);
      console.log("[CheckInWindow] submit_checkin returned");
    } catch (e) {
      console.error("[CheckInWindow] submit_checkin error:", e);
    }
    await getCurrentWindow().hide();
  }

  async function handleDirectInput() {
    // 메인 창을 띄워 Work view를 활성화 (창 포커스/숨김은 Rust가 처리)
    console.log("[CheckInWindow] invoking direct_input");
    try {
      await invoke("direct_input");
    } catch (e) {
      console.error("[CheckInWindow] direct_input error:", e);
    }
  }

  if (!data) {
    return <div className="checkin-loading">로딩 중...</div>;
  }

  if (data.mode === "off") {
    return (
      <div className="checkin-window checkin-state-window">
        <div className="checkin-header">
          <p className="checkin-title">체크인 대기 중</p>
          <span className="checkin-status-pill off">퇴근 상태</span>
        </div>
        <div className="checkin-empty-state">
          <strong>출근 후 체크인 팝업이 활성화됩니다.</strong>
          <span>출근을 누르면 설정한 주기대로 현재 작업을 물어봅니다.</span>
        </div>
        <div className="checkin-actions">
          <button className="checkin-submit-btn" type="button" onClick={handleClockIn}>
            출근
          </button>
        </div>
      </div>
    );
  }

  if (data.mode === "break") {
    return (
      <div className="checkin-window checkin-state-window">
        <div className="checkin-header">
          <p className="checkin-title">휴식 중</p>
          <span className="checkin-status-pill break">체크인 일시 중지</span>
        </div>
        <div className="checkin-empty-state">
          <strong>휴식 종료 전까지 체크인 팝업이 뜨지 않습니다.</strong>
          <span>다시 일을 시작할 때 휴식 종료를 눌러 주세요.</span>
        </div>
        <div className="checkin-actions">
          <button className="checkin-new-btn" type="button" onClick={handleClockOut}>
            퇴근
          </button>
          <button className="checkin-submit-btn" type="button" onClick={handleEndBreak}>
            휴식 종료
          </button>
        </div>
      </div>
    );
  }

  const submitDisabled = showNewTaskInput ? !newTask.trim() : !selected;
  const taskOptions = getTaskOptions(data);
  const parentTaskOptions = taskOptions.filter((option) => option.kind === "parent");
  const subtaskOptions = taskOptions.filter((option) => option.kind === "subitem");
  const memoSnippet = memo.trim().replace(/\s+/g, " ");
  const memoSummary = memoSnippet
    ? memoSnippet.length > 36
      ? `${memoSnippet.slice(0, 36)}...`
      : memoSnippet
    : "비어 있음";

  return (
    <div className="checkin-window">
      <div className="checkin-header">
        <p className="checkin-title">지금 뭐 하고 있어?</p>
        <span className="checkin-status-pill working">근무 중</span>
      </div>

      {!showNewTaskInput ? (
        <div className="checkin-task-list">
          {parentTaskOptions.map((option) => (
            <button
              key={option.value}
              className={`checkin-task-btn${selected === option.value ? " selected" : ""}`}
              onClick={() => selectExistingTask(option.value)}
            >
              {option.label}
            </button>
          ))}
          {subtaskOptions.length > 0 && (
            <>
              <button
                className="checkin-subtask-toggle"
                type="button"
                onClick={() => setShowSubtasks((prev) => !prev)}
                aria-expanded={showSubtasks}
              >
                <span>하위 작업</span>
                <span>{showSubtasks ? "접기" : `${subtaskOptions.length}개 보기`}</span>
              </button>
              {showSubtasks &&
                subtaskOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`checkin-task-btn subtask${
                      selected === option.value ? " selected" : ""
                    }`}
                    onClick={() => selectExistingTask(option.value)}
                    title={option.value}
                  >
                    <span className="checkin-task-kind">하위</span>
                    <span className="checkin-task-label">{option.label}</span>
                  </button>
                ))}
            </>
          )}
        </div>
      ) : (
        <input
          className="checkin-input"
          type="text"
          placeholder="새 작업 입력..."
          value={newTask}
          onChange={(e) => handleNewTaskChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          autoFocus
        />
      )}

      <section className={`checkin-memo-section${memoCollapsed ? " collapsed" : ""}`}>
        <button
          className="checkin-memo-divider"
          type="button"
          onClick={toggleMemoCollapsed}
          aria-expanded={!memoCollapsed}
          aria-controls="checkin-memo-body"
        >
          <span className="checkin-memo-rule" aria-hidden="true" />
          <span className="checkin-memo-divider-content">
            <span className="checkin-memo-title">메모</span>
            <span className="checkin-memo-summary">{memoSummary}</span>
            <span className="checkin-memo-chevron" aria-hidden="true">
              {memoCollapsed ? "˅" : "˄"}
            </span>
          </span>
          <span className="checkin-memo-rule" aria-hidden="true" />
        </button>

        <div
          id="checkin-memo-body"
          className="checkin-memo-body"
          aria-hidden={memoCollapsed}
        >
          <div className="checkin-memo-grid">
            <section className="checkin-memo-pane">
              <label className="checkin-memo-label" htmlFor="checkin-memo">
                작성
              </label>
              <textarea
                id="checkin-memo"
                className="checkin-memo-editor"
                placeholder="지금 작업 중인 맥락을 마크다운으로 남기기..."
                value={memo}
                onChange={(e) => handleMemoChange(e.target.value)}
                spellCheck={false}
                tabIndex={memoCollapsed ? -1 : undefined}
              />
            </section>
            <section className="checkin-memo-pane preview">
              <span className="checkin-memo-label">미리보기</span>
              <div className="markdown-preview">
                {renderMarkdown(memo, "메모를 쓰면 여기에 미리보기가 표시됩니다.")}
              </div>
            </section>
          </div>
        </div>
      </section>

      <div className="checkin-actions">
        {!showNewTaskInput ? (
          <button
            className="checkin-new-btn"
            type="button"
            onClick={() => {
              setShowNewTaskInput(true);
              setNewTask("");
              setMemo("");
              setMemoDirty(false);
            }}
          >
            새로운 작업
          </button>
        ) : data.tasks.length > 0 ? (
          <button
            className="checkin-new-btn"
            type="button"
            onClick={() => {
              setShowNewTaskInput(false);
              fillMemoForTask(selected);
            }}
          >
            뒤로
          </button>
        ) : null}
        <button className="checkin-break-btn" type="button" onClick={handleStartBreak}>
          휴식
        </button>
        <button
          className="checkin-submit-btn"
          type="button"
          onClick={handleSubmit}
          disabled={submitDisabled}
        >
          제출
        </button>
      </div>

      <button className="checkin-direct-btn" onClick={handleDirectInput}>
        ✎ Work에서 직접 입력하기
      </button>
    </div>
  );
}

export default CheckInWindow;
