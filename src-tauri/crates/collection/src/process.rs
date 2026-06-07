use std::collections::{BTreeMap, HashMap};
use std::process::Command;

const SNAPSHOT_GROUP_LIMIT: usize = 16;

// 추적 대상은 OS마다 이름이 다르다 (Windows는 .exe, macOS는 앱 실행 파일명).
// 앱을 추가할 때는 해당 OS의 이름을 여기에 더한다.
#[cfg(target_os = "windows")]
const TRACKED_PROCESS_NAMES: &[&str] = &[
    "chrome.exe",
    "msedge.exe",
    "whale.exe",
    "firefox.exe",
    "KakaoTalk.exe",
];

#[cfg(target_os = "macos")]
const TRACKED_PROCESS_NAMES: &[&str] = &[
    "Google Chrome",
    "Safari",
    "Microsoft Edge",
    "Whale",
    "Dia",
    "Arc",
    "Firefox",
    "KakaoTalk",
];

#[cfg(all(unix, not(target_os = "macos")))]
const TRACKED_PROCESS_NAMES: &[&str] = &["chrome", "chromium", "firefox", "msedge"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessGroup {
    pub name: String,
    pub count: usize,
    pub pids: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessEvent {
    Snapshot {
        total: usize,
        groups: Vec<ProcessGroup>,
    },
    Started(ProcessGroup),
    Stopped(ProcessGroup),
}

#[derive(Default)]
pub struct ProcessTracker {
    prev: Option<HashMap<String, VisibleWindow>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct VisibleWindow {
    pid: u32,
    label: String,
}

impl ProcessTracker {
    pub fn poll(&mut self) -> Result<Vec<ProcessEvent>, String> {
        let current = list_visible_windows()?;
        let events = match &self.prev {
            None => initial_snapshot(&current),
            Some(prev) => diff_windows(prev, &current),
        };
        self.prev = Some(current);
        Ok(events)
    }
}

impl ProcessEvent {
    pub fn text(&self) -> String {
        match self {
            ProcessEvent::Snapshot { total, groups } => {
                if groups.is_empty() {
                    return format!("화면 프로세스 스냅샷 - {}개 표시 중", total);
                }
                format!(
                    "화면 프로세스 스냅샷 - {}개 표시 중: {}",
                    total,
                    format_groups(groups)
                )
            }
            ProcessEvent::Started(group) => format!("화면에 표시 - {}", format_group(group)),
            ProcessEvent::Stopped(group) => format!("화면에서 사라짐 - {}", format_group(group)),
        }
    }
}

fn initial_snapshot(windows: &HashMap<String, VisibleWindow>) -> Vec<ProcessEvent> {
    if windows.is_empty() {
        return Vec::new();
    }
    let mut groups = group_by_label(windows.values());
    groups.truncate(SNAPSHOT_GROUP_LIMIT);
    vec![ProcessEvent::Snapshot {
        total: windows.len(),
        groups,
    }]
}

fn diff_windows(
    prev: &HashMap<String, VisibleWindow>,
    current: &HashMap<String, VisibleWindow>,
) -> Vec<ProcessEvent> {
    let started = current
        .iter()
        .filter(|(key, window)| prev.get(*key) != Some(*window))
        .map(|(_, window)| window.clone())
        .collect::<Vec<_>>();
    let stopped = prev
        .iter()
        .filter(|(key, window)| current.get(*key) != Some(*window))
        .map(|(_, window)| window.clone())
        .collect::<Vec<_>>();

    let mut events = Vec::new();
    events.extend(
        group_by_label(started.iter())
            .into_iter()
            .map(ProcessEvent::Started),
    );
    events.extend(
        group_by_label(stopped.iter())
            .into_iter()
            .map(ProcessEvent::Stopped),
    );
    events
}

fn group_by_label<'a>(windows: impl Iterator<Item = &'a VisibleWindow>) -> Vec<ProcessGroup> {
    let mut by_label: BTreeMap<String, Vec<u32>> = BTreeMap::new();
    for window in windows {
        by_label
            .entry(window.label.clone())
            .or_default()
            .push(window.pid);
    }

    let mut groups: Vec<ProcessGroup> = by_label
        .into_iter()
        .map(|(name, mut pids)| {
            pids.sort_unstable();
            pids.dedup();
            ProcessGroup {
                count: pids.len(),
                name,
                pids,
            }
        })
        .collect();

    groups.sort_by(|a, b| {
        b.count.cmp(&a.count).then_with(|| {
            a.name
                .to_ascii_lowercase()
                .cmp(&b.name.to_ascii_lowercase())
        })
    });
    groups
}

fn format_groups(groups: &[ProcessGroup]) -> String {
    groups
        .iter()
        .map(format_group)
        .collect::<Vec<_>>()
        .join(", ")
}

fn format_group(group: &ProcessGroup) -> String {
    if group.count == 1 {
        match group.pids.first() {
            Some(pid) => format!("{} (PID {})", group.name, pid),
            None => group.name.clone(),
        }
    } else {
        format!("{} x{}", group.name, group.count)
    }
}

#[cfg(target_os = "windows")]
fn list_visible_windows() -> Result<HashMap<String, VisibleWindow>, String> {
    let process_names = list_tasklist_processes()?;
    let raw_windows = enum_visible_windows();
    let mut windows = HashMap::new();

    for raw in raw_windows {
        let Some(process_name) = process_names.get(&raw.pid) else {
            continue;
        };
        if !is_tracked_process(process_name) {
            continue;
        }
        let Some(label) = window_label(process_name, &raw.title) else {
            continue;
        };
        let key = format!("{}:{}", raw.pid, label.to_ascii_lowercase());
        windows.insert(
            key,
            VisibleWindow {
                pid: raw.pid,
                label,
            },
        );
    }

    Ok(windows)
}

#[cfg(target_os = "windows")]
fn list_tasklist_processes() -> Result<HashMap<u32, String>, String> {
    let output = Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output()
        .map_err(|e| format!("tasklist 실행 실패: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("tasklist 종료 코드: {:?}", output.status.code())
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut processes = HashMap::new();
    for line in stdout.lines() {
        let cols = parse_csv_line(line);
        if cols.len() < 2 {
            continue;
        }
        let name = cols[0].trim();
        if !is_tracked_process(name) {
            continue;
        }
        let Ok(pid) = cols[1].trim().parse::<u32>() else {
            continue;
        };
        if pid == 0 || name.is_empty() {
            continue;
        }
        processes.insert(pid, name.to_string());
    }
    Ok(processes)
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
struct RawWindow {
    pid: u32,
    title: String,
}

#[cfg(target_os = "windows")]
fn enum_visible_windows() -> Vec<RawWindow> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsIconic,
        IsWindowVisible,
    };

    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let windows = &mut *(lparam.0 as *mut Vec<RawWindow>);

        if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
            return true.into();
        }

        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return true.into();
        }

        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return true.into();
        }

        let mut buf = vec![0u16; len as usize + 1];
        let read = GetWindowTextW(hwnd, &mut buf);
        if read <= 0 {
            return true.into();
        }

        let title = String::from_utf16_lossy(&buf[..read as usize])
            .trim()
            .to_string();
        if !title.is_empty() {
            windows.push(RawWindow { pid, title });
        }

        true.into()
    }

    let mut windows = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(callback), LPARAM(&mut windows as *mut _ as isize));
    }
    windows
}

#[cfg(not(target_os = "windows"))]
fn list_visible_windows() -> Result<HashMap<String, VisibleWindow>, String> {
    let output = Command::new("ps")
        .args(["-eo", "pid=,comm="])
        .output()
        .map_err(|e| format!("ps 실행 실패: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("ps 종료 코드: {:?}", output.status.code())
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut windows = HashMap::new();
    for line in stdout.lines() {
        let mut parts = line.trim().splitn(2, char::is_whitespace);
        let Some(pid_raw) = parts.next() else {
            continue;
        };
        let Some(name_raw) = parts.next() else {
            continue;
        };
        let Ok(pid) = pid_raw.parse::<u32>() else {
            continue;
        };
        // macOS의 `comm`은 전체 실행 파일 경로를 주므로 파일명만 추출한다
        // (Linux의 짧은 이름은 슬래시가 없어 그대로 통과한다).
        let name = basename(name_raw);
        if pid == 0 || name.is_empty() || !is_tracked_process(name) {
            continue;
        }
        let label = name.to_string();
        windows.insert(label.to_ascii_lowercase(), VisibleWindow { pid, label });
    }
    Ok(windows)
}

fn window_label(process_name: &str, title: &str) -> Option<String> {
    let title = title.trim();
    if title.is_empty() {
        return None;
    }

    if process_name.eq_ignore_ascii_case("chrome.exe") {
        let tab = title
            .strip_suffix(" - Google Chrome")
            .or_else(|| title.strip_suffix(" - Chrome"))
            .unwrap_or(title)
            .trim();
        if tab.is_empty() {
            return None;
        }
        return Some(format!("Chrome - {}", tab));
    }

    if process_name.eq_ignore_ascii_case("KakaoTalk.exe") {
        return Some(if title.eq_ignore_ascii_case("KakaoTalk") {
            "KakaoTalk".to_string()
        } else {
            format!("KakaoTalk - {}", title)
        });
    }

    Some(format!("{} - {}", process_name, title))
}

fn is_tracked_process(name: &str) -> bool {
    TRACKED_PROCESS_NAMES
        .iter()
        .any(|tracked| tracked.eq_ignore_ascii_case(name))
}

/// 경로에서 파일명만 추출한다. 슬래시가 없으면 입력을 그대로 돌려준다.
#[cfg(not(target_os = "windows"))]
fn basename(raw: &str) -> &str {
    let raw = raw.trim();
    std::path::Path::new(raw)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(raw)
}

fn parse_csv_line(line: &str) -> Vec<String> {
    let mut cols = Vec::new();
    let mut cur = String::new();
    let mut chars = line.chars().peekable();
    let mut in_quotes = false;

    while let Some(ch) = chars.next() {
        match ch {
            '"' if in_quotes && chars.peek() == Some(&'"') => {
                cur.push('"');
                chars.next();
            }
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                cols.push(cur.trim().to_string());
                cur.clear();
            }
            _ => cur.push(ch),
        }
    }

    cols.push(cur.trim().to_string());
    cols
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tasklist_csv_line() {
        let cols = parse_csv_line("\"chrome.exe\",\"1234\",\"Console\",\"1\",\"120,000 K\"");
        assert_eq!(cols[0], "chrome.exe");
        assert_eq!(cols[1], "1234");
        assert_eq!(cols[4], "120,000 K");
    }

    #[test]
    fn formats_snapshot_summary() {
        let event = ProcessEvent::Snapshot {
            total: 3,
            groups: vec![ProcessGroup {
                name: "Chrome - OpenAI".to_string(),
                count: 2,
                pids: vec![10, 11],
            }],
        };

        assert_eq!(
            event.text(),
            "화면 프로세스 스냅샷 - 3개 표시 중: Chrome - OpenAI x2"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn only_tracks_whitelisted_process_names() {
        assert!(is_tracked_process("chrome.exe"));
        assert!(is_tracked_process("KAKAOTALK.EXE"));
        assert!(!is_tracked_process("Code.exe"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn only_tracks_whitelisted_process_names() {
        assert!(is_tracked_process("Google Chrome"));
        assert!(is_tracked_process("kakaotalk"));
        assert!(is_tracked_process("Dia"));
        assert!(!is_tracked_process("chrome.exe"));
        assert!(!is_tracked_process("Code"));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn extracts_basename_from_path() {
        assert_eq!(
            basename("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            "Google Chrome"
        );
        assert_eq!(basename("chrome"), "chrome");
        assert_eq!(basename("  /usr/bin/ps  "), "ps");
    }

    #[test]
    fn extracts_chrome_tab_title() {
        assert_eq!(
            window_label("chrome.exe", "OpenAI - Google Chrome"),
            Some("Chrome - OpenAI".to_string())
        );
    }

    #[test]
    fn labels_kakaotalk_windows() {
        assert_eq!(
            window_label("KakaoTalk.exe", "KakaoTalk"),
            Some("KakaoTalk".to_string())
        );
        assert_eq!(
            window_label("KakaoTalk.exe", "친구"),
            Some("KakaoTalk - 친구".to_string())
        );
    }

    #[test]
    fn diffs_visible_window_changes() {
        let prev = HashMap::from([(
            "1:chrome - openai".to_string(),
            VisibleWindow {
                pid: 1,
                label: "Chrome - OpenAI".to_string(),
            },
        )]);
        let current = HashMap::from([(
            "2:kakaotalk".to_string(),
            VisibleWindow {
                pid: 2,
                label: "KakaoTalk".to_string(),
            },
        )]);

        assert_eq!(
            diff_windows(&prev, &current),
            vec![
                ProcessEvent::Started(ProcessGroup {
                    name: "KakaoTalk".to_string(),
                    count: 1,
                    pids: vec![2],
                }),
                ProcessEvent::Stopped(ProcessGroup {
                    name: "Chrome - OpenAI".to_string(),
                    count: 1,
                    pids: vec![1],
                }),
            ]
        );
    }
}
