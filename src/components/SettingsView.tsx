import { useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";

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

type ExportPrivacyLevel = 1 | 2 | 3;

interface ExportedDb {
  path: string;
}

// 자동 설치가 막힐 때(서명 등) 직접 받으러 갈 릴리즈 페이지.
const RELEASES_URL = "https://github.com/SpecialTdev/whatchadoin/releases";

const EXPORT_LEVELS: Array<{
  value: ExportPrivacyLevel;
  title: string;
  detail: string;
}> = [
  { value: 1, title: "1단계", detail: "Raw data" },
  { value: 2, title: "2단계", detail: "Window name 비식별화" },
  { value: 3, title: "3단계", detail: "Task 이름 난독화" },
];

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
  const [exportLevel, setExportLevel] = useState<ExportPrivacyLevel>(1);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [isChecking, setIsChecking] = useState(false);
  const [update, setUpdate] = useState<Update | null>(null);
  const [checkedNoUpdate, setCheckedNoUpdate] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  function selectExportLevel(level: ExportPrivacyLevel) {
    setExportLevel(level);
    setExportPath(null);
    setExportError(null);
  }

  async function exportDb() {
    setIsExporting(true);
    setExportError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const exported = await invoke<ExportedDb>("export_events_db", {
        privacyLevel: exportLevel,
      });
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

  // updater 플러그인이 latest.json을 받아 현재 버전과 비교한다. 새 버전이 있으면
  // 설치에 쓸 Update 핸들을, 없으면 null을 돌려준다 (확인·비교를 모두 위임).
  async function checkForUpdate() {
    setIsChecking(true);
    setUpdateError(null);
    setUpdate(null);
    setCheckedNoUpdate(false);
    setUpdateStatus(null);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const found = await check();
      if (found) {
        setUpdate(found);
      } else {
        setCheckedNoUpdate(true);
      }
    } catch (e) {
      setUpdateError(errorMessage(e));
    } finally {
      setIsChecking(false);
    }
  }

  // 확인 단계에서 받은 Update 핸들로 다운로드·설치 후 앱을 재시작한다.
  async function runUpdate() {
    if (!update) return;
    setIsInstalling(true);
    setUpdateError(null);
    setUpdateStatus("다운로드 중...");
    try {
      await update.downloadAndInstall();
      setUpdateStatus("설치 완료. 앱을 재시작합니다...");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setUpdateError(errorMessage(e));
      setUpdateStatus(null);
    } finally {
      setIsInstalling(false);
    }
  }

  // 자동 설치가 막힐 때(서명 등)를 위한 대안: 릴리즈 페이지를 브라우저로 연다.
  async function openReleases() {
    setUpdateError(null);
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(RELEASES_URL);
    } catch (e) {
      setUpdateError(errorMessage(e));
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

        <div className="settings-export-levels" role="radiogroup" aria-label="DB 내보내기 단계">
          {EXPORT_LEVELS.map((level) => (
            <button
              key={level.value}
              className={`settings-level-btn${exportLevel === level.value ? " active" : ""}`}
              type="button"
              aria-pressed={exportLevel === level.value}
              onClick={() => selectExportLevel(level.value)}
              disabled={isExporting}
            >
              <span className="settings-level-title">{level.title}</span>
              <span className="settings-level-detail">{level.detail}</span>
            </button>
          ))}
        </div>

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

      <section className="settings-section">
        <h2>앱 업데이트</h2>
        <p className="hint">
          최신 릴리즈가 있는지 GitHub에서 확인하고, 새 버전이 있으면 앱에서 바로
          내려받아 설치합니다.
        </p>

        <div className="settings-action-row">
          <button
            className="settings-action-btn"
            type="button"
            onClick={checkForUpdate}
            disabled={isChecking || isInstalling}
          >
            {isChecking ? "확인 중..." : "업데이트 확인"}
          </button>
        </div>

        {checkedNoUpdate && (
          <p className="settings-export-path">최신 버전입니다.</p>
        )}

        {update && (
          <div>
            <p className="settings-export-path">
              현재 v{update.currentVersion} → 최신 v{update.version}
            </p>
            {update.body && (
              <pre className="settings-update-notes">{update.body}</pre>
            )}
            <div className="settings-action-row">
              <button
                className="settings-action-btn"
                type="button"
                onClick={runUpdate}
                disabled={isInstalling}
              >
                {isInstalling ? "업데이트 중..." : "지금 업데이트"}
              </button>
              <button
                className="settings-secondary-btn"
                type="button"
                onClick={openReleases}
                disabled={isInstalling}
              >
                릴리즈 페이지 열기
              </button>
            </div>
          </div>
        )}

        {updateStatus && <p className="settings-export-path">{updateStatus}</p>}
        {updateError && <p className="settings-error">{updateError}</p>}
      </section>
    </div>
  );
}

export default SettingsView;
