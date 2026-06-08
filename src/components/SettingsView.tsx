import { useState } from "react";

interface Props {
  intervalSec: number;
  minSec: number;
  maxSec: number;
  onIntervalChange: (sec: number) => void;
  boundaryHour: number;
  minBoundary: number;
  maxBoundary: number;
  onBoundaryChange: (hour: number) => void;
}

const STEP_SEC = 10;

interface ExportedDb {
  path: string;
}

// 초 → "N분 M초" (M=0이면 "N분")
function fmtInterval(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
}

// 시(0~23) → "자정 (0시)" / "오전 N시" / "정오 (12시)" / "오후 N시"
function fmtBoundary(h: number): string {
  if (h === 0) return "자정 (0시)";
  if (h < 12) return `오전 ${h}시`;
  if (h === 12) return "정오 (12시)";
  return `오후 ${h - 12}시`;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function SettingsView({
  intervalSec,
  minSec,
  maxSec,
  onIntervalChange,
  boundaryHour,
  minBoundary,
  maxBoundary,
  onBoundaryChange,
}: Props) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  async function exportDb() {
    setIsExporting(true);
    setExportError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const exported = await invoke<ExportedDb>("export_events_db");
      setExportPath(exported.path);
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setIsExporting(false);
    }
  }

  async function revealExportedDb() {
    if (!exportPath) return;
    setExportError(null);
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(exportPath);
    } catch (e) {
      setExportError(`파일은 생성됐지만 폴더를 열지 못했습니다: ${errorMessage(e)}`);
    }
  }

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

      <section className="settings-section">
        <h2>하루 경계 시각</h2>
        <p className="hint">
          리포트에서 하루를 가르는 기준 시각입니다. 이 시각 전의 작업은 전날로
          묶입니다 (자정 넘긴 작업 대응).
        </p>

        <div className="settings-control">
          <div className="settings-value">{fmtBoundary(boundaryHour)}</div>
          <input
            className="settings-range"
            type="range"
            min={minBoundary}
            max={maxBoundary}
            step={1}
            value={boundaryHour}
            onChange={(e) => onBoundaryChange(Number(e.target.value))}
          />
          <div className="settings-range-labels">
            <span>{fmtBoundary(minBoundary)}</span>
            <span>{fmtBoundary(maxBoundary)}</span>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>DB 내보내기</h2>
        <p className="hint">저장된 이벤트 DB를 Downloads 폴더에 SQLite 파일로 복사합니다.</p>

        <div className="settings-action-row">
          <button
            className="settings-action-btn"
            type="button"
            onClick={exportDb}
            disabled={isExporting}
          >
            {isExporting ? "내보내는 중..." : "DB 내보내기"}
          </button>
          {exportPath && (
            <button
              className="settings-secondary-btn"
              type="button"
              onClick={revealExportedDb}
            >
              폴더에서 보기
            </button>
          )}
        </div>

        {exportPath && <p className="settings-export-path">{exportPath}</p>}
        {exportError && <p className="settings-error">{exportError}</p>}
      </section>
    </div>
  );
}

export default SettingsView;
