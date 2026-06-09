import { useEffect, useState } from "react";

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

// 인앱 가청 알람. OS 알림이 막혀 있어도 확실히 소리로 알린다. (Start 클릭으로 오디오가
// 이미 활성화돼 있어 타이머 콜백에서도 재생 가능.)
function beep() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    if (ctx.state === "suspended") ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = 880;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    osc.start(t);
    osc.stop(t + 0.7);
    osc.onended = () => ctx.close();
  } catch (e) {
    console.error("[timer] beep failed:", e);
  }
}

// 타이머 완료 알람: 인앱 소리 + (권한 있으면) OS 시스템 알림.
async function notifyTimerDone() {
  beep();
  try {
    const { isPermissionGranted, requestPermission } = await import(
      "@tauri-apps/plugin-notification"
    );
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return;

    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("notify", {
      title: "타이머 완료",
      body: "설정한 시간이 끝났어요.",
    });
  } catch (e) {
    console.error("[timer] notify failed:", e);
  }
}

// 단순 카운트다운 타이머. 실행 상태는 휘발(컴포넌트 로컬), 길이만 영속한다.
function WidgetTimer({ initialDurationSec, onDurationChange }: Props) {
  const [durationSec, setDurationSec] = useState(initialDurationSec);
  const [remaining, setRemaining] = useState(initialDurationSec);
  const [running, setRunning] = useState(false);

  // 실행 중이면 1초마다 카운트다운.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  // 0에 도달하면 정지하고 완료 알람을 띄운다 (카운트다운 종료 시 1회).
  useEffect(() => {
    if (running && remaining === 0) {
      setRunning(false);
      notifyTimerDone();
    }
  }, [running, remaining]);

  // idle = 정지 + 처음 상태(남은 시간 = 설정 길이). 이때만 시간 입력을 노출.
  const idle = !running && remaining === durationSec;

  const h = Math.floor(durationSec / 3600);
  const m = Math.floor((durationSec % 3600) / 60);
  const s = durationSec % 60;

  function applyDuration(next: number) {
    const sec = clampInt(next, 0, MAX_SEC);
    setDurationSec(sec);
    setRemaining(sec);
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

  function toggle() {
    if (running) setRunning(false);
    else if (remaining > 0) setRunning(true);
  }

  function reset() {
    setRunning(false);
    setRemaining(durationSec);
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
        <button className="widget-timer-btn" onClick={reset} disabled={idle}>
          리셋
        </button>
      </div>
    </div>
  );
}

export default WidgetTimer;
