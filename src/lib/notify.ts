// 위젯 공통 알람 유틸 (타이머/척추요정 등).
// 인앱 비프 + (권한 있으면) 시스템 알림으로 알린다.

// 인앱 가청 알람. OS 알림이 막혀 있어도 확실히 소리로 알린다. (사용자가 위젯과
// 상호작용(Start 등)한 뒤라 오디오가 활성화돼 콜백에서도 재생 가능.)
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
    console.error("[notify] beep failed:", e);
  }
}

// 알람을 띄운다: 인앱 소리 + (권한 있으면) OS 시스템 알림.
export async function notifyAlarm(title: string, body: string) {
  beep();
  try {
    const { isPermissionGranted, requestPermission } = await import(
      "@tauri-apps/plugin-notification"
    );
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return;

    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("notify", { title, body });
  } catch (e) {
    console.error("[notify] failed:", e);
  }
}
