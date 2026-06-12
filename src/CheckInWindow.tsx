import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CheckInStatus } from "./lib/checkin";
import { latestMemoByTask } from "./lib/checkinMemo";
import { fetchEvents } from "./lib/events";
import { renderMarkdown } from "./lib/markdown";
import "./app-view/App.css";
import "./CheckInWindow.css";

interface CheckInData extends CheckInStatus {
  tasks: string[];
}

function CheckInWindow() {
  const [data, setData] = useState<CheckInData | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [newTask, setNewTask] = useState("");
  const [memo, setMemo] = useState("");
  const [memoByTask, setMemoByTask] = useState<Record<string, string>>({});
  const [memoDirty, setMemoDirty] = useState(false);
  const [showNewTaskInput, setShowNewTaskInput] = useState(false);

  function fillMemoForTask(task: string, memos = memoByTask) {
    setMemo(task ? memos[task] ?? "" : "");
    setMemoDirty(false);
  }

  function selectExistingTask(task: string) {
    setSelected(task);
    fillMemoForTask(task);
  }

  function handleNewTaskChange(value: string) {
    setNewTask(value);
    if (!memoDirty) fillMemoForTask(value.trim());
  }

  function handleMemoChange(value: string) {
    setMemo(value);
    setMemoDirty(true);
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
        setData(d);
        setMemoByTask(memos);
        setSelected(task);
        setNewTask("");
        setMemo(task ? memos[task] ?? "" : "");
        setMemoDirty(false);
        setShowNewTaskInput(d.active_task === null);
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

  return (
    <div className="checkin-window">
      <div className="checkin-header">
        <p className="checkin-title">지금 뭐 하고 있어?</p>
        <span className="checkin-status-pill working">근무 중</span>
      </div>

      {!showNewTaskInput ? (
        <div className="checkin-task-list">
          {data.tasks.map((task) => (
            <button
              key={task}
              className={`checkin-task-btn${selected === task ? " selected" : ""}`}
              onClick={() => selectExistingTask(task)}
            >
              {task}
            </button>
          ))}
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

      <div className="checkin-memo-grid">
        <section className="checkin-memo-pane">
          <label className="checkin-memo-label" htmlFor="checkin-memo">
            메모
          </label>
          <textarea
            id="checkin-memo"
            className="checkin-memo-editor"
            placeholder="지금 작업 중인 맥락을 마크다운으로 남기기..."
            value={memo}
            onChange={(e) => handleMemoChange(e.target.value)}
            spellCheck={false}
          />
        </section>
        <section className="checkin-memo-pane preview">
          <span className="checkin-memo-label">미리보기</span>
          <div className="markdown-preview">
            {renderMarkdown(memo, "메모를 쓰면 여기에 미리보기가 표시됩니다.")}
          </div>
        </section>
      </div>

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
