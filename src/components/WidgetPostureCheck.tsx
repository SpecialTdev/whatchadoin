import { useEffect, useState } from "react";
import { POSTURE_INTERVAL_OPTIONS_MIN } from "../lib/widgets";
import { notifyAlarm } from "../lib/notify";
import { useCountdown } from "../lib/useCountdown";
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
  const { remaining, running, toggle, reset } = useCountdown(initialIntervalSec);
  const elapsed = intervalSec - remaining;

  useEffect(() => {
    if (running && remaining === 0) {
      notifyAlarm("척추요정", "허리 펴고 스트레칭 할 시간이에요! 🦴");
      reset(intervalSec, true);
    }
  }, [running, remaining, intervalSec, reset]);

  const index = nearestIndex(Math.round(intervalSec / 60));
  const minutes = OPTIONS[index];

  function applyIndex(i: number) {
    const sec = OPTIONS[i] * 60;
    setIntervalSec(sec);
    // 간격 변경 시 현재 진행시간은 유지하되, 진행 > 새 간격이면 리셋.
    reset(elapsed >= sec ? sec : sec - elapsed, running);
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

        <button className="posture-btn" onClick={toggle}>
          {running ? "일시정지" : "시작"}
        </button>
      </div>
    </div>
  );
}

export default WidgetPostureCheck;
