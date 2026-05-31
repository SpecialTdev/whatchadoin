use std::sync::Mutex;
use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
struct CheckInState {
    tasks: Vec<String>,
    active_task: Option<String>,
}

#[derive(serde::Serialize, Clone)]
struct CheckInData {
    tasks: Vec<String>,
    active_task: Option<String>,
}

#[tauri::command]
fn open_checkin(
    app: AppHandle,
    state: tauri::State<'_, Mutex<CheckInState>>,
    tasks: Vec<String>,
    active_task: Option<String>,
) {
    println!("[Rust] open_checkin called, tasks: {:?}, active_task: {:?}", tasks, active_task);
    {
        let mut s = state.lock().unwrap();
        s.tasks = tasks;
        s.active_task = active_task;
    }

    if let Some(win) = app.get_webview_window("checkin") {
        println!("[Rust] checkin window exists, showing");
        let _ = win.show();
        let _ = win.set_focus();
    } else {
        println!("[Rust] creating new checkin window");
        match WebviewWindowBuilder::new(&app, "checkin", WebviewUrl::App(Default::default()))
            .title("지금 뭐 하고 있어?")
            .inner_size(360.0, 400.0)
            .center()
            .always_on_top(true)
            .resizable(false)
            .build()
        {
            Ok(_) => {
                println!("[Rust] checkin window created");
            }
            Err(e) => println!("[Rust] failed to create checkin window: {}", e),
        }
    }
}

#[tauri::command]
fn get_checkin_data(state: tauri::State<'_, Mutex<CheckInState>>) -> CheckInData {
    let s = state.lock().unwrap();
    println!("[Rust] get_checkin_data called, tasks: {:?}, active_task: {:?}", s.tasks, s.active_task);
    CheckInData {
        tasks: s.tasks.clone(),
        active_task: s.active_task.clone(),
    }
}

#[tauri::command]
fn submit_checkin(app: AppHandle, task: String) {
    println!("[Rust] submit_checkin called, task: {}", task);
    let result = app.emit_to(
        EventTarget::WebviewWindow {
            label: "main".to_string(),
        },
        "checkin://submit",
        task,
    );
    println!("[Rust] emit_to result: {:?}", result);
}

// 체크인 대신 메인 창에서 직접 입력: 메인 창을 띄워 포커스하고, Work view를
// 활성화하라는 이벤트를 보낸 뒤 체크인 창을 숨긴다.
#[tauri::command]
fn direct_input(app: AppHandle) {
    println!("[Rust] direct_input called");
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 조립기(tauri-main): 처리 엔진을 생성해 app-service에 주입한다.
    let engine = processing::ProcessingEngine::default();
    let _app_service = app_service::AppService::new(engine);
    let _collector = collection::Collector::default();
    // TODO: _app_service를 tauri state로 등록, _collector.start()로 추적 시작.
    //   core-shared의 ReportDto는 향후 tauri command 반환 타입으로 사용.

    tauri::Builder::default()
        .manage(Mutex::new(CheckInState::default()))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_checkin,
            get_checkin_data,
            submit_checkin,
            direct_input
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
