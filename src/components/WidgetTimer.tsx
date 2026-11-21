import { useEffect, useState } from "react";
import { useCountdown } from "../lib/useCountdown";
import { notifyAlarm } from "../lib/notify";

interface Props {
  /** 저장된 마지막 사용 길이(초)로 초기화. */
  initialDurationSec: number;
  /** 사용자가 시간을 바꾸면 호출 — 최근 사용 시간으로 영속. */
  onDurationChange: (sec: number) => void;
}

const MAX_SEC = 99 * 3600 + 59 * 60 + 59;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatHMS(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

// 단순 카운트다운 타이머. 실행 상태는 휘발(컴포넌트 로컬), 길이만 영속한다.
function WidgetTimer({ initialDurationSec, onDurationChange }: Props) {
  const [durationSec, setDurationSec] = useState(initialDurationSec);
  const { remaining, running, toggle, reset: resetCountdown } = useCountdown(initialDurationSec);

  // 0에 도달하면 정지하고 완료 알람을 띄운다 (카운트다운 종료 시 1회).
  useEffect(() => {
    if (running && remaining === 0) {
      resetCountdown(0);
      notifyAlarm("타이머 완료", "설정한 시간이 끝났어요.");
    }
  }, [running, remaining, resetCountdown]);

  // idle = 정지 + 처음 상태(남은 시간 = 설정 길이). 이때만 시간 입력을 노출.
  const idle = !running && remaining === durationSec;

  const h = Math.floor(durationSec / 3600);
  const m = Math.floor((durationSec % 3600) / 60);
  const s = durationSec % 60;

  function applyDuration(next: number) {
    const sec = clampInt(next, 0, MAX_SEC);
    setDurationSec(sec);
    resetCountdown(sec);
    onDurationChange(sec); // 최근 사용 시간으로 영속
  }

  function setPart(part: "h" | "m" | "s", raw: string) {
    const v = clampInt(Number(raw), 0, part === "h" ? 99 : 59);
    const next =
      part === "h"
        ? v * 3600 + m * 60 + s
        : part === "m"
          ? h * 3600 + v * 60 + s
          : h * 3600 + m * 60 + v;
    applyDuration(next);
  }


  const progress = durationSec > 0 ? (remaining / durationSec) * 100 : 0;

  return (
    <div className="widget-timer">
      {idle ? (
        <div className="widget-timer-edit">
          <input
            className="widget-timer-input"
            type="number"
            min={0}
            max={99}
            value={h}
            aria-label="시"
            onChange={(e) => setPart("h", e.target.value)}
          />
          <span className="widget-timer-colon">:</span>
          <input
            className="widget-timer-input"
            type="number"
            min={0}
            max={59}
            value={m}
            aria-label="분"
            onChange={(e) => setPart("m", e.target.value)}
          />
          <span className="widget-timer-colon">:</span>
          <input
            className="widget-timer-input"
            type="number"
            min={0}
            max={59}
            value={s}
            aria-label="초"
            onChange={(e) => setPart("s", e.target.value)}
          />
        </div>
      ) : (
        <div className={`widget-timer-time${remaining === 0 ? " done" : ""}`}>
          {formatHMS(remaining)}
        </div>
      )}

      <div className="widget-timer-progress">
        <div className="widget-timer-bar" style={{ width: `${progress}%` }} />
      </div>

      <div className="widget-timer-controls">
        <button
          className="widget-timer-btn primary"
          onClick={toggle}
          disabled={!running && remaining === 0}
        >
          {running ? "일시정지" : "시작"}
        </button>
        <button className="widget-timer-btn" onClick={() => resetCountdown(durationSec)} disabled={idle}>
          리셋
        </button>
      </div>
    </div>
  );
}

export default WidgetTimer;
