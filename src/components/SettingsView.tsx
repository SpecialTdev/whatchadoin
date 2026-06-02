interface Props {
  intervalSec: number;
  minSec: number;
  maxSec: number;
  onIntervalChange: (sec: number) => void;
}

const STEP_SEC = 10;

// 초 → "N분 M초" (M=0이면 "N분")
function fmtInterval(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
}

function SettingsView({ intervalSec, minSec, maxSec, onIntervalChange }: Props) {
  return (
    <div className="settings-view">
      <header className="settings-header">
        <h1>Settings</h1>
      </header>

      <section className="settings-section">
        <h2>체크인 팝업 주기</h2>
        <p className="hint">팝업이 얼마나 자주 떠서 작업을 물어볼지 정합니다.</p>

        <div className="settings-control">
          <div className="settings-value">{fmtInterval(intervalSec)}</div>
          <input
            className="settings-range"
            type="range"
            min={minSec}
            max={maxSec}
            step={STEP_SEC}
            value={intervalSec}
            onChange={(e) => onIntervalChange(Number(e.target.value))}
          />
          <div className="settings-range-labels">
            <span>{fmtInterval(minSec)}</span>
            <span>{fmtInterval(maxSec)}</span>
          </div>
        </div>
      </section>
    </div>
  );
}

export default SettingsView;
