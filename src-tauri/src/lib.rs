use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
#[cfg(desktop)]
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri::{
    AppHandle, Emitter, EventTarget, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;

const MIN_CHECKIN_INTERVAL_SEC: u64 = 60;
const MAX_CHECKIN_INTERVAL_SEC: u64 = 1800;
const DEFAULT_CHECKIN_INTERVAL_SEC: u64 = 60;
#[cfg(desktop)]
const TRAY_SHOW_ID: &str = "show-main";
#[cfg(desktop)]
const TRAY_QUIT_ID: &str = "quit";

#[derive(serde::Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum CheckInMode {
    Off,
    Working,
    Break,
}

struct CheckInState {
    tasks: Vec<String>,
    task_options: Vec<CheckInTaskOption>,
    active_task: Option<String>,
    interval_sec: u64,
    next_checkin_at: Instant,
    mode: CheckInMode,
}

impl Default for CheckInState {
    fn default() -> Self {
        Self {
            tasks: Vec::new(),
            task_options: Vec::new(),
            active_task: None,
            interval_sec: DEFAULT_CHECKIN_INTERVAL_SEC,
            next_checkin_at: Instant::now() + Duration::from_secs(DEFAULT_CHECKIN_INTERVAL_SEC),
            mode: CheckInMode::Off,
        }
    }
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "snake_case")]
enum CheckInTaskKind {
    Parent,
    Subitem,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct CheckInTaskOption {
    kind: CheckInTaskKind,
    label: String,
    value: String,
    #[serde(default, rename = "parentValue")]
    parent_value: Option<String>,
}

impl<'de> serde::Deserialize<'de> for CheckInTaskKind {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = <String as serde::Deserialize>::deserialize(deserializer)?;
        match value.as_str() {
            "parent" => Ok(Self::Parent),
            "subitem" => Ok(Self::Subitem),
            other => Err(serde::de::Error::unknown_variant(other, &["parent", "subitem"])),
        }
    }
}

fn parent_task_options(tasks: &[String]) -> Vec<CheckInTaskOption> {
    tasks
        .iter()
        .map(|task| CheckInTaskOption {
            kind: CheckInTaskKind::Parent,
            label: task.clone(),
            value: task.clone(),
            parent_value: None,
        })
        .collect()
}

#[derive(serde::Serialize, Clone)]
struct CheckInData {
    tasks: Vec<String>,
    task_options: Vec<CheckInTaskOption>,
    active_task: Option<String>,
    mode: CheckInMode,
}

#[derive(serde::Serialize, Clone)]
struct CheckInStatus {
    active_task: Option<String>,
    mode: CheckInMode,
}

#[derive(serde::Serialize, Clone)]
struct CheckInSubmitEvent {
    task: String,
    memo: String,
}

#[derive(serde::Serialize)]
struct ExportedDb {
    path: String,
}

#[derive(serde::Serialize)]
struct PlatformInfo {
    os: &'static str,
}

#[tauri::command]
fn get_platform_info() -> PlatformInfo {
    PlatformInfo {
        os: std::env::consts::OS,
    }
}

// 좌측 사이드바 위젯 한 개. app_data_dir/widgets.json에 JSON으로 영속한다.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct WidgetData {
    id: String,
    #[serde(rename = "type")]
    kind: String, // `type`은 Rust 예약어라 직렬화 이름만 "type"로.
    title: String,
    // 위젯별 설정은 종류마다 달라 불투명 JSON으로 그대로 보존한다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    config: Option<serde_json::Value>,
}

// widgets.json 경로. app data dir이 없으면 생성한다.
fn widgets_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok();
    Some(dir.join("widgets.json"))
}

// workspace 노트(마크다운) 경로. app data dir이 없으면 생성한다.
fn note_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok();
    Some(dir.join("workspace-note.md"))
}

// collector가 들고 있는 최신 note 스냅샷을 workspace-note.md에 저장한다.
// 키 입력 경로가 아니라 15s poll 주기와 종료 시점에서만 호출해 렉을 피한다.
fn persist_note(app: &AppHandle) {
    let note = {
        let state = app.state::<Mutex<collection::Collector>>();
        let note = state.lock().unwrap().latest_note();
        note
    };
    if let (Some(note), Some(path)) = (note, note_path(app)) {
        if let Err(e) = std::fs::write(&path, note) {
            println!("[Rust] note 저장 실패: {}", e);
        }
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

#[cfg(desktop)]
fn setup_main_window_close_handler(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let main_for_close = main.clone();
        main.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = main_for_close.hide();
            }
        });
    } else {
        println!("[Rust] main window missing, close-to-tray handler skipped");
    }
}

#[cfg(desktop)]
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text(TRAY_SHOW_ID, "열기")
        .separator()
        .text(TRAY_QUIT_ID, "종료")
        .build()?;

    let mut tray = TrayIconBuilder::with_id("whatchadoin-tray")
        .tooltip("Whatchadoin")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW_ID => show_main_window(app),
            TRAY_QUIT_ID => {
                persist_note(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => show_main_window(tray.app_handle()),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

// 체크인 창을 숨긴 채로 미리 생성한다. 닫기(X)를 눌러도 destroy되지 않고 hide만 하도록
// CloseRequested 이벤트를 가로채 둔다 — 이후 open_checkin이 이 창을 재사용해 show만 한다.
fn build_checkin_window(app: &AppHandle) -> tauri::Result<()> {
    let win = WebviewWindowBuilder::new(app, "checkin", WebviewUrl::App(Default::default()))
        .title("지금 뭐 하고 있어?")
        .inner_size(760.0, 560.0)
        .min_inner_size(520.0, 320.0)
        .center()
        .always_on_top(true)
        .resizable(true)
        .visible(false)
        .build()?;

    let win_for_close = win.clone();
    win.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = win_for_close.hide();
        }
    });
    Ok(())
}

fn send_checkin_notification(app: &AppHandle) {
    let result = app
        .notification()
        .builder()
        .title("지금 뭐 하고 있어?")
        .body("체크인 시간이 됐어요. 열린 체크인 창에서 현재 작업을 확인해 주세요.")
        .sound("Ping")
        .show();

    if let Err(e) = result {
        println!("[Rust] checkin notification failed: {}", e);
    }
}

fn show_checkin(app: &AppHandle) {
    let app = app.clone();
    if let Err(e) = app.clone().run_on_main_thread(move || {
        // 미리 만들어 둔 창이 없을 경우의 안전장치
        if app.get_webview_window("checkin").is_none() {
            println!("[Rust] checkin window missing, building on demand");
            if let Err(e) = build_checkin_window(&app) {
                println!("[Rust] failed to build checkin window: {}", e);
            }
        }

        if let Some(win) = app.get_webview_window("checkin") {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
        }
        send_checkin_notification(&app);

        // 이미 로드된 웹뷰가 최신 데이터를 다시 가져오게 한다 (stale 방지)
        let _ = app.emit_to(
            EventTarget::WebviewWindow {
                label: "checkin".to_string(),
            },
            "checkin://refresh",
            (),
        );
    }) {
        println!("[Rust] failed to schedule checkin window show: {}", e);
    }
}

fn clamp_checkin_interval(interval_sec: u64) -> u64 {
    interval_sec.clamp(MIN_CHECKIN_INTERVAL_SEC, MAX_CHECKIN_INTERVAL_SEC)
}

fn checkin_status(s: &CheckInState) -> CheckInStatus {
    CheckInStatus {
        active_task: s.active_task.clone(),
        mode: s.mode,
    }
}

fn emit_checkin_status(app: &AppHandle, status: CheckInStatus) {
    for label in ["main", "checkin"] {
        let _ = app.emit_to(
            EventTarget::WebviewWindow {
                label: label.to_string(),
            },
            "checkin://status",
            status.clone(),
        );
    }
}

#[tauri::command]
fn update_checkin_context(
    state: tauri::State<'_, Mutex<CheckInState>>,
    tasks: Vec<String>,
    task_options: Option<Vec<CheckInTaskOption>>,
    active_task: Option<String>,
    interval_sec: u64,
) {
    let interval_sec = clamp_checkin_interval(interval_sec);
    let mut s = state.lock().unwrap();
    let interval_changed = s.interval_sec != interval_sec;

    s.task_options = task_options.unwrap_or_else(|| parent_task_options(&tasks));
    s.tasks = tasks;
    s.active_task = active_task;
    s.interval_sec = interval_sec;

    if interval_changed && s.mode == CheckInMode::Working {
        s.next_checkin_at = Instant::now() + Duration::from_secs(interval_sec);
    }
}

#[tauri::command]
fn open_checkin(
    app: AppHandle,
    state: tauri::State<'_, Mutex<CheckInState>>,
    tasks: Vec<String>,
    task_options: Option<Vec<CheckInTaskOption>>,
    active_task: Option<String>,
) {
    println!(
        "[Rust] open_checkin called, tasks: {:?}, active_task: {:?}",
        tasks, active_task
    );
    {
        let mut s = state.lock().unwrap();
        s.task_options = task_options.unwrap_or_else(|| parent_task_options(&tasks));
        s.tasks = tasks;
        s.active_task = active_task;
    }

    show_checkin(&app);
}

#[tauri::command]
fn get_checkin_data(state: tauri::State<'_, Mutex<CheckInState>>) -> CheckInData {
    let s = state.lock().unwrap();
    println!(
        "[Rust] get_checkin_data called, tasks: {:?}, active_task: {:?}",
        s.tasks, s.active_task
    );
    CheckInData {
        tasks: s.tasks.clone(),
        task_options: s.task_options.clone(),
        active_task: s.active_task.clone(),
        mode: s.mode,
    }
}

#[tauri::command]
fn get_checkin_status(state: tauri::State<'_, Mutex<CheckInState>>) -> CheckInStatus {
    let s = state.lock().unwrap();
    checkin_status(&s)
}

#[tauri::command]
fn clock_in(app: AppHandle, state: tauri::State<'_, Mutex<CheckInState>>) -> CheckInStatus {
    let status = {
        let mut s = state.lock().unwrap();
        s.mode = CheckInMode::Working;
        s.next_checkin_at = Instant::now() + Duration::from_secs(s.interval_sec);
        checkin_status(&s)
    };
    emit_checkin_status(&app, status.clone());
    status
}

#[tauri::command]
fn clock_out(app: AppHandle, state: tauri::State<'_, Mutex<CheckInState>>) -> CheckInStatus {
    let status = {
        let mut s = state.lock().unwrap();
        s.mode = CheckInMode::Off;
        s.active_task = None;
        checkin_status(&s)
    };
    emit_checkin_status(&app, status.clone());
    if let Some(checkin) = app.get_webview_window("checkin") {
        let _ = checkin.hide();
    }
    status
}

#[tauri::command]
fn start_break(app: AppHandle, state: tauri::State<'_, Mutex<CheckInState>>) -> CheckInStatus {
    let status = {
        let mut s = state.lock().unwrap();
        s.mode = CheckInMode::Break;
        s.active_task = None;
        checkin_status(&s)
    };
    emit_checkin_status(&app, status.clone());
    if let Some(checkin) = app.get_webview_window("checkin") {
        let _ = checkin.hide();
    }
    status
}

#[tauri::command]
fn end_break(app: AppHandle, state: tauri::State<'_, Mutex<CheckInState>>) -> CheckInStatus {
    let status = {
        let mut s = state.lock().unwrap();
        s.mode = CheckInMode::Working;
        s.next_checkin_at = Instant::now() + Duration::from_secs(s.interval_sec);
        checkin_status(&s)
    };
    emit_checkin_status(&app, status.clone());
    status
}

#[tauri::command]
fn submit_checkin(
    app: AppHandle,
    state: tauri::State<'_, Mutex<CheckInState>>,
    collector: tauri::State<'_, Mutex<collection::Collector>>,
    task: String,
    memo: Option<String>,
) {
    let memo = memo.unwrap_or_default();
    println!("[Rust] submit_checkin called, task: {}", task);
    let status = {
        let mut s = state.lock().unwrap();
        s.active_task = Some(task.clone());
        if !s.tasks.iter().any(|t| t == &task) {
            s.tasks.push(task.clone());
        }
        if !s.task_options.iter().any(|option| option.value == task) {
            s.task_options.push(CheckInTaskOption {
                kind: CheckInTaskKind::Parent,
                label: task.clone(),
                value: task.clone(),
                parent_value: None,
            });
        }
        if s.mode == CheckInMode::Working {
            s.next_checkin_at = Instant::now() + Duration::from_secs(s.interval_sec);
        }
        checkin_status(&s)
    };

    let result = app.emit_to(
        EventTarget::WebviewWindow {
            label: "main".to_string(),
        },
        "checkin://submit",
        CheckInSubmitEvent {
            task: task.clone(),
            memo: memo.clone(),
        },
    );
    println!("[Rust] emit_to result: {:?}", result);
    emit_checkin_status(&app, status);

    // 체크인 응답을 이벤트로 기록하고 right sidebar에 즉시 반영한다.
    let event = collector.lock().unwrap().record_checkin(&task, Some(&memo));
    if let Some(ev) = event {
        let _ = app.emit_to(
            EventTarget::WebviewWindow {
                label: "main".to_string(),
            },
            "events://new",
            ev,
        );
    }
}

/// 프런트엔드가 note를 편집할 때마다 최신 스냅샷을 Collector에 push한다.
/// 실제 추적(15s diff)은 백그라운드 타이머가 수행한다.
#[tauri::command]
fn update_note(collector: tauri::State<'_, Mutex<collection::Collector>>, note: String) {
    collector.lock().unwrap().update_note(note);
}

/// 저장된 이벤트를 최신순으로 반환한다. limit이 있으면 페이지 단위로 반환한다.
#[tauri::command]
fn get_events(
    collector: tauri::State<'_, Mutex<collection::Collector>>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Vec<core_shared::Event> {
    let collector = collector.lock().unwrap();
    match limit {
        Some(limit) => {
            let limit = limit.clamp(1, 200);
            let offset = offset.unwrap_or(0).max(0);
            collector.events_page(limit, offset)
        }
        None => collector.all_events(),
    }
}

#[tauri::command]
fn export_events_db(
    app: AppHandle,
    collector: tauri::State<'_, Mutex<collection::Collector>>,
    privacy_level: Option<u8>,
) -> Result<ExportedDb, String> {
    let privacy_level = collection::ExportPrivacyLevel::from_step(privacy_level.unwrap_or(1))
        .ok_or_else(|| "지원하지 않는 DB 내보내기 단계입니다.".to_string())?;
    let downloads = app
        .path()
        .download_dir()
        .map_err(|e| format!("다운로드 폴더를 찾지 못했습니다: {e}"))?;
    std::fs::create_dir_all(&downloads)
        .map_err(|e| format!("다운로드 폴더를 만들지 못했습니다: {e}"))?;

    let dest = unique_export_path(&downloads, privacy_level);
    collector
        .lock()
        .unwrap()
        .export_to(&dest, privacy_level)
        .map_err(|e| format!("DB 내보내기에 실패했습니다: {e}"))?;

    Ok(ExportedDb {
        path: dest.display().to_string(),
    })
}

// 저장된 위젯 목록을 읽어 반환한다 (좌측 사이드바 초기 로드). 파일이 없거나
// 파싱 실패면 빈 목록.
#[tauri::command]
fn get_widgets(app: AppHandle) -> Vec<WidgetData> {
    widgets_path(&app)
        .and_then(|p| std::fs::read(&p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

// 위젯 목록을 widgets.json에 pretty JSON으로 저장한다.
#[tauri::command]
fn save_widgets(app: AppHandle, widgets: Vec<WidgetData>) -> Result<(), String> {
    let path = widgets_path(&app).ok_or("app data dir 확보 실패")?;
    let json = serde_json::to_string_pretty(&widgets).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

// 저장된 workspace 노트를 읽어 반환한다 (Work view 초기 로드). 파일이 없으면
// None → 프런트가 기본 노트를 사용한다. (빈 파일은 사용자가 비운 상태로 보존)
// 저장은 프런트가 아니라 Rust가 15s poll 주기·종료 시점에 수행한다(persist_note).
#[tauri::command]
fn get_note(app: AppHandle) -> Option<String> {
    note_path(&app).and_then(|p| std::fs::read_to_string(&p).ok())
}

// 프런트(위젯 등)가 요청하는 시스템 알림을 띄운다 (타이머 완료 알람 등).
#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) {
    let result = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .sound("Ping")
        .show();
    if let Err(e) = result {
        println!("[Rust] notify failed: {}", e);
    }
}

// 체크인 대신 메인 창에서 직접 입력: 메인 창을 띄워 포커스하고, Work view를
// 활성화하라는 이벤트를 보낸 뒤 체크인 창을 숨긴다.
#[tauri::command]
fn direct_input(app: AppHandle) {
    println!("[Rust] direct_input called");
    show_main_window(&app);
    let _ = app.emit_to(
        EventTarget::WebviewWindow {
            label: "main".to_string(),
        },
        "checkin://direct",
        (),
    );
    if let Some(checkin) = app.get_webview_window("checkin") {
        let _ = checkin.hide();
    }
}

fn unique_export_path(dir: &Path, privacy_level: collection::ExportPrivacyLevel) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let base = format!("whatchadoin-events-{}-{stamp}", privacy_level.file_suffix());
    let mut dest = dir.join(format!("{base}.db"));
    let mut n = 1;
    while dest.exists() {
        dest = dir.join(format!("{base}-{n}.db"));
        n += 1;
    }
    dest
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 조립기(tauri-main): 처리 엔진을 생성해 app-service에 주입한다.
    let engine = processing::ProcessingEngine::default();
    let _app_service = app_service::AppService::new(engine);
    // TODO: _app_service를 tauri state로 등록.
    //   core-shared의 ReportDto는 향후 tauri command 반환 타입으로 사용.

    let builder = tauri::Builder::default()
        .manage(Mutex::new(CheckInState::default()))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init());

    // updater/process는 desktop 전용 플러그인이다.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .setup(|app| {
            // 이벤트 수집기: app data dir의 SQLite에 영속한다.
            let dir = app.path().app_data_dir().expect("app data dir 확보 실패");
            std::fs::create_dir_all(&dir).ok();
            let db_path = dir.join("events.db");
            let collector = collection::Collector::open(&db_path).expect("events DB 열기 실패");
            app.manage(Mutex::new(collector));

            #[cfg(desktop)]
            {
                setup_main_window_close_handler(app.handle());
                if let Err(e) = build_tray(app.handle()) {
                    println!("[Rust] failed to build tray icon: {}", e);
                }
            }

            // 15s마다 note 변경을 diff해 이벤트로 기록하고 main 창에 push한다.
            // 같은 주기에 최신 note 스냅샷도 디스크에 영속한다(키 입력 경로와 분리해 렉 방지).
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut last_written: Option<String> = None;
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(15));
                    let (new_events, note) = {
                        let state = handle.state::<Mutex<collection::Collector>>();
                        let mut c = state.lock().unwrap();
                        (c.poll(), c.latest_note())
                    };

                    // 노트 영속: 직전 저장과 달라졌을 때만 쓴다(15s당 최대 1회).
                    if let Some(n) = note {
                        if last_written.as_deref() != Some(n.as_str()) {
                            if let Some(path) = note_path(&handle) {
                                match std::fs::write(&path, &n) {
                                    Ok(()) => last_written = Some(n),
                                    Err(e) => println!("[Rust] note 저장 실패: {}", e),
                                }
                            }
                        }
                    }

                    println!(
                        "[Rust] events poll tick → {} new event(s)",
                        new_events.len()
                    );
                    for ev in new_events {
                        let _ = handle.emit_to(
                            EventTarget::WebviewWindow {
                                label: "main".to_string(),
                            },
                            "events://new",
                            ev,
                        );
                    }
                }
            });

            // 포커스된 최상위 윈도우(앱·제목) 변화를 수집해 main 창 Events에 push한다.
            let focus_handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut tracker = collection::WindowTracker::default();
                loop {
                    if let Some(focus_event) = tracker.poll() {
                        println!("[Rust] focus changed → {}", focus_event.text());
                        let event = {
                            let state = focus_handle.state::<Mutex<collection::Collector>>();
                            let mut c = state.lock().unwrap();
                            c.record_focus_event(&focus_event)
                        };
                        if let Some(ev) = event {
                            let _ = focus_handle.emit_to(
                                EventTarget::WebviewWindow {
                                    label: "main".to_string(),
                                },
                                "events://new",
                                ev,
                            );
                        }
                    }

                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
            });

            // 체크인 창을 시작 시 숨긴 채로 미리 만들어 둔다 (open 시 즉시 show만 하도록).
            if let Err(e) = build_checkin_window(app.handle()) {
                println!("[Rust] failed to pre-build checkin window: {}", e);
            }

            // 체크인 주기는 Rust에서 관리한다. 메인 웹뷰가 닫혀도 앱 프로세스가
            // 살아있는 동안 checkin 창과 알림을 계속 띄울 수 있게 한다.
            let checkin_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(1));

                let should_open = {
                    let state = checkin_handle.state::<Mutex<CheckInState>>();
                    let mut s = state.lock().unwrap();
                    let now = Instant::now();
                    if s.mode != CheckInMode::Working || now < s.next_checkin_at {
                        false
                    } else {
                        s.next_checkin_at = now + Duration::from_secs(s.interval_sec);
                        true
                    }
                };

                if should_open {
                    println!("[Rust] checkin timer tick");
                    show_checkin(&checkin_handle);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_platform_info,
            open_checkin,
            update_checkin_context,
            get_checkin_data,
            get_checkin_status,
            clock_in,
            clock_out,
            start_break,
            end_break,
            submit_checkin,
            direct_input,
            update_note,
            get_events,
            export_events_db,
            get_widgets,
            save_widgets,
            get_note,
            notify
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 종료 직전(트레이 '종료', Cmd+Q, dock 종료 등 모든 경로) 최신 노트를 저장한다.
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                persist_note(app_handle);
            }
        });
}
