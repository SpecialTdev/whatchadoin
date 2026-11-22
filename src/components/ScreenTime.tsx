import type { useScreenTime } from "../lib/screenTime";

function formatUsage(ms: number) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}분` : `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

export default function ScreenTime({ usage }: { usage: ReturnType<typeof useScreenTime> }) {
  const total = usage.apps.reduce((sum, app) => sum + app.ms, 0);
  const message = {
    loading: "불러오는 중…",
    error: "스크린타임을 불러오지 못했습니다.",
    unsupported: "이 플랫폼에서는 활성 사용 시간을 수집하지 않습니다.",
    ready: "기록 없음",
  }[usage.status];

  return (
    <section className="report-section screen-time">
      <h2>스크린타임</h2>
      {total === 0 ? <p className="hint">{message}</p> : (
        <>
          <p className="screen-time-total">{formatUsage(total)}</p>
          <ul className="screen-time-apps">
            {usage.apps.map(({ app, ms }) => (
              <li key={app}>
                <span>{app}</span>
                <span>{formatUsage(ms)}</span>
                <div className="screen-time-track" aria-hidden="true">
                  <div style={{ width: `${ms / total * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
