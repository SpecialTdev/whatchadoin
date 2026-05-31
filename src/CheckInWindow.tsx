import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./app-view/App.css";
import "./CheckInWindow.css";

interface CheckInData {
  tasks: string[];
  active_task: string | null;
}

function CheckInWindow() {
  const [data, setData] = useState<CheckInData | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [newTask, setNewTask] = useState("");
  const [showNewTaskInput, setShowNewTaskInput] = useState(false);

  useEffect(() => {
    console.log("[CheckInWindow] mounted, calling get_checkin_data");
    invoke<CheckInData>("get_checkin_data")
      .then((d) => {
        console.log("[CheckInWindow] get_checkin_data returned:", d);
        setData(d);
        setSelected(d.active_task ?? "");
        setShowNewTaskInput(d.active_task === null);
      })
      .catch((e) => console.error("[CheckInWindow] get_checkin_data error:", e));
  }, []);

  async function handleSubmit() {
    const task = showNewTaskInput ? newTask.trim() : selected;
    if (!task) return;

    console.log("[CheckInWindow] invoking submit_checkin, task:", task);
    try {
      await invoke("submit_checkin", { task });
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

  const submitDisabled = showNewTaskInput ? !newTask.trim() : !selected;

  return (
    <div className="checkin-window">
      <p className="checkin-title">지금 뭐 하고 있어?</p>

      {!showNewTaskInput ? (
        <div className="checkin-task-list">
          {data.tasks.map((task) => (
            <button
              key={task}
              className={`checkin-task-btn${selected === task ? " selected" : ""}`}
              onClick={() => setSelected(task)}
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
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          autoFocus
        />
      )}

      <div className="checkin-actions">
        {!showNewTaskInput ? (
          <button
            className="checkin-new-btn"
            onClick={() => {
              setShowNewTaskInput(true);
              setNewTask("");
            }}
          >
            새로운 작업
          </button>
        ) : data.tasks.length > 0 ? (
          <button
            className="checkin-new-btn"
            onClick={() => setShowNewTaskInput(false)}
          >
            뒤로
          </button>
        ) : null}
        <button
          className="checkin-submit-btn"
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
