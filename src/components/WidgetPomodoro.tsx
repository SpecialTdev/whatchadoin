import { useEffect, useState } from "react";
import type { WidgetConfig } from "../lib/widgets";
import { notifyAlarm } from "../lib/notify";

interface Props {
  initialFocusSec: number;
  initialBreakSec: number;
  /** 집중/휴식 시간을 바꾸면 호출 — 현재 설정으로 영속. */
  onConfigChange: (patch: Partial<WidgetConfig>) => void;
}

type Mode = "work" | "break";

// 모드별 인디케이터 채움 색 (track은 검정). 집중=red, 휴식=green.
const FILL: Record<Mode, string> = { work: "#e74c3c", break: "#2ecc71" };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatMS(total: number): string {
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

// 뽀모도로 타이머: 집중/휴식을 번갈아 카운트다운. 완료 시 알람 + 자동으로 반대 모드 시작.
// 실행 상태는 휘발(컴포넌트 로컬), 집중/휴식 길이만 영속한다.
function WidgetPomodoro({
  initialFocusSec,
  initialBreakSec,
  onConfigChange,
}: Props) {
  const [focusSec, setFocusSec] = useState(initialFocusSec);
  const [breakSec, setBreakSec] = useState(initialBreakSec);
  const [mode, setMode] = useState<Mode>("work");
  const [remaining, setRemaining] = useState(initialFocusSec);
  const [running, setRunning] = useState(false);

  const duration = mode === "work" ? focusSec : breakSec;

  // 실행 중이면 1초마다 카운트다운.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(id);
  }, [running]);

  // 0 도달: 알람을 띄우고 반대 모드로 전환해 자동으로 이어서 시작.
  useEffect(() => {
    if (!(running && remaining === 0)) return;
    const next: Mode = mode === "work" ? "break" : "work";
    const nextDur = next === "work" ? focusSec : breakSec;
    notifyAlarm(
      next === "break" ? "집중 완료" : "휴식 완료",
      next === "break" ? "휴식 시간이에요 ☕" : "다시 집중할 시간! 💪",
    );
    setMode(next);
    setRemaining(nextDur);
    if (nextDur === 0) setRunning(false); // 길이 0이면 무한 전환 방지
  }, [running, remaining, mode, focusSec, breakSec]);

  const idle = !running && remaining === duration;
  const m = Math.floor(duration / 60);
  const s = duration % 60;

  function applyDuration(sec: number) {
    if (mode === "work") {
      setFocusSec(sec);
      onConfigChange({ focusSec: sec });
    } else {
      setBreakSec(sec);
      onConfigChange({ breakSec: sec });
    }
    setRemaining(sec);
  }

  function setPart(part: "m" | "s", raw: string) {
    const v = clampInt(Number(raw), 0, part === "m" ? 99 : 59);
    applyDuration(part === "m" ? v * 60 + s : m * 60 + v);
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setRunning(false);
    setRemaining(next === "work" ? focusSec : breakSec);
  }

  function toggle() {
    if (running) setRunning(false);
    else if (remaining > 0) setRunning(true);
  }

  function reset() {
    setRunning(false);
    setRemaining(duration);
  }

  // 남은 시간 비율만큼 채운 원형 인디케이터. 시간이 흐르면 채움이 반시계방향으로 줄어든다.
  const angle = duration > 0 ? (remaining / duration) * 360 : 0;
  const dial = `conic-gradient(${FILL[mode]} 0deg, ${FILL[mode]} ${angle}deg, #1a1a1a ${angle}deg, #1a1a1a 360deg)`;

  return (
    <div className="widget-pomodoro">
      <div className="ppomo-modes">
        <button
          className={`ppomo-mode${mode === "work" ? " active" : ""}`}
          onClick={() => switchMode("work")}
        >
          집중
        </button>
        <button
          className={`ppomo-mode${mode === "break" ? " active" : ""}`}
          onClick={() => switchMode("break")}
        >
          휴식
        </button>
      </div>

      <div className="ppomo-dial" style={{ background: dial }}>
        <div className="ppomo-face">
          {idle ? (
            <span className="ppomo-edit">
              <input
                className="ppomo-input"
                type="number"
                min={0}
                max={99}
                value={m}
                aria-label="분"
                onChange={(e) => setPart("m", e.target.value)}
              />
              <span className="ppomo-colon">:</span>
              <input
                className="ppomo-input"
                type="number"
                min={0}
                max={59}
                value={s}
                aria-label="초"
                onChange={(e) => setPart("s", e.target.value)}
              />
            </span>
          ) : (
            <span className="ppomo-time">{formatMS(remaining)}</span>
          )}
        </div>
      </div>

      <div className="ppomo-controls">
        <button
          className="ppomo-btn primary"
          onClick={toggle}
          disabled={!running && remaining === 0}
        >
          {running ? "일시정지" : "시작"}
        </button>
        <button className="ppomo-btn" onClick={reset} disabled={idle}>
          리셋
        </button>
      </div>
    </div>
  );
}

export default WidgetPomodoro;
