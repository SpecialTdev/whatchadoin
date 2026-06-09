import { useEffect, useState } from "react";
import { POSTURE_INTERVAL_OPTIONS_MIN } from "../lib/widgets";
import { notifyAlarm } from "../lib/notify";
import thumbnail from "../assets/posture-check-thumbnail.png";

interface Props {
  /** 저장된 알림 간격(초)으로 초기화. */
  initialIntervalSec: number;
  /** 간격을 바꾸면 호출 — 현재 설정으로 영속. */
  onIntervalChange: (sec: number) => void;
}

const OPTIONS = POSTURE_INTERVAL_OPTIONS_MIN;

// 분 값을 슬라이더 단계 인덱스로 (정확히 없으면 가장 가까운 단계).
function nearestIndex(min: number): number {
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < OPTIONS.length; i++) {
    const d = Math.abs(OPTIONS[i] - min);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

// 척추요정: 설정한 간격마다 자세 교정 알림을 반복하는 위젯.
// 실행 상태는 휘발(컴포넌트 로컬), 간격만 영속한다.
function WidgetPostureCheck({ initialIntervalSec, onIntervalChange }: Props) {
  const [intervalSec, setIntervalSec] = useState(initialIntervalSec);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);

  // 실행 중이면 1초마다 경과 증가.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  // 간격에 도달하면 알림을 띄우고 다음 주기로 반복(설정 시간마다).
  useEffect(() => {
    if (running && elapsed >= intervalSec) {
      notifyAlarm("척추요정", "허리 펴고 스트레칭 할 시간이에요! 🦴");
      setElapsed(0);
    }
  }, [running, elapsed, intervalSec]);

  const index = nearestIndex(Math.round(intervalSec / 60));
  const minutes = OPTIONS[index];

  function applyIndex(i: number) {
    const sec = OPTIONS[i] * 60;
    setIntervalSec(sec);
    // 간격 변경 시 현재 진행시간은 유지하되, 진행 > 새 간격이면 리셋.
    setElapsed((e) => (e > sec ? 0 : e));
    onIntervalChange(sec);
  }

  const progress =
    intervalSec > 0 ? Math.min(100, (elapsed / intervalSec) * 100) : 0;

  return (
    <div className="widget-posture">
      <img className="posture-thumb" src={thumbnail} alt="척추요정" />

      <div className="posture-controls">
        <div className="posture-interval">
          <span className="posture-interval-label">{minutes}분마다 알림</span>
          <input
            className="posture-slider"
            type="range"
            min={0}
            max={OPTIONS.length - 1}
            step={1}
            value={index}
            onChange={(e) => applyIndex(Number(e.target.value))}
          />
        </div>

        <div className="posture-progress">
          <div className="posture-bar" style={{ width: `${progress}%` }} />
        </div>

        <button className="posture-btn" onClick={() => setRunning((r) => !r)}>
          {running ? "일시정지" : "시작"}
        </button>
      </div>
    </div>
  );
}

export default WidgetPostureCheck;
