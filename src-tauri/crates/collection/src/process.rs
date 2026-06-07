use std::collections::{BTreeMap, HashMap};
use std::process::Command;

const SNAPSHOT_GROUP_LIMIT: usize = 16;
const TRACKED_PROCESS_NAMES: &[&str] = &["chrome.exe", "KakaoTalk.exe"];

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
    prev: Option<HashMap<u32, String>>,
}

impl ProcessTracker {
    pub fn poll(&mut self) -> Result<Vec<ProcessEvent>, String> {
        let current = list_processes()?;
        let events = match &self.prev {
            None => initial_snapshot(&current),
            Some(prev) => diff_processes(prev, &current),
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
                    return format!("프로세스 스냅샷 - {}개 실행 중", total);
                }
                format!(
                    "프로세스 스냅샷 - {}개 실행 중: {}",
                    total,
                    format_groups(groups)
                )
            }
            ProcessEvent::Started(group) => format!("프로세스 시작 - {}", format_group(group)),
            ProcessEvent::Stopped(group) => format!("프로세스 종료 - {}", format_group(group)),
        }
    }
}

fn initial_snapshot(processes: &HashMap<u32, String>) -> Vec<ProcessEvent> {
    if processes.is_empty() {
        return Vec::new();
    }
    let mut groups = group_by_name(processes);
    groups.truncate(SNAPSHOT_GROUP_LIMIT);
    vec![ProcessEvent::Snapshot {
        total: processes.len(),
        groups,
    }]
}

fn diff_processes(
    prev: &HashMap<u32, String>,
    current: &HashMap<u32, String>,
) -> Vec<ProcessEvent> {
    let mut started = HashMap::new();
    let mut stopped = HashMap::new();

    for (pid, name) in current {
        if prev.get(pid) != Some(name) {
            started.insert(*pid, name.clone());
        }
    }

    for (pid, name) in prev {
        if current.get(pid) != Some(name) {
            stopped.insert(*pid, name.clone());
        }
    }

    let mut events = Vec::new();
    events.extend(
        group_by_name(&started)
            .into_iter()
            .map(ProcessEvent::Started),
    );
    events.extend(
        group_by_name(&stopped)
            .into_iter()
            .map(ProcessEvent::Stopped),
    );
    events
}

fn group_by_name(processes: &HashMap<u32, String>) -> Vec<ProcessGroup> {
    let mut by_name: BTreeMap<String, Vec<u32>> = BTreeMap::new();
    for (pid, name) in processes {
        by_name.entry(name.clone()).or_default().push(*pid);
    }

    let mut groups: Vec<ProcessGroup> = by_name
        .into_iter()
        .map(|(name, mut pids)| {
            pids.sort_unstable();
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
fn list_processes() -> Result<HashMap<u32, String>, String> {
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
        if name.eq_ignore_ascii_case("tasklist.exe") {
            continue;
        }
        if !is_tracked_process(name) {
            continue;
        }
        if cols
            .get(2)
            .is_some_and(|session| session.eq_ignore_ascii_case("Services"))
        {
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

#[cfg(not(target_os = "windows"))]
fn list_processes() -> Result<HashMap<u32, String>, String> {
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
    let mut processes = HashMap::new();
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
        let name = name_raw.trim();
        if name == "ps" {
            continue;
        }
        if !is_tracked_process(name) {
            continue;
        }
        if pid == 0 || name.is_empty() {
            continue;
        }
        processes.insert(pid, name.to_string());
    }
    Ok(processes)
}

fn is_tracked_process(name: &str) -> bool {
    TRACKED_PROCESS_NAMES
        .iter()
        .any(|tracked| tracked.eq_ignore_ascii_case(name))
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
                name: "chrome.exe".to_string(),
                count: 2,
                pids: vec![10, 11],
            }],
        };

        assert_eq!(event.text(), "프로세스 스냅샷 - 3개 실행 중: chrome.exe x2");
    }

    #[test]
    fn only_tracks_whitelisted_process_names() {
        assert!(is_tracked_process("chrome.exe"));
        assert!(is_tracked_process("KAKAOTALK.EXE"));
        assert!(!is_tracked_process("Code.exe"));
    }

    #[test]
    fn groups_started_processes_by_name() {
        let prev = HashMap::from([(1, "Code.exe".to_string())]);
        let current = HashMap::from([
            (1, "Code.exe".to_string()),
            (2, "chrome.exe".to_string()),
            (3, "chrome.exe".to_string()),
        ]);

        assert_eq!(
            diff_processes(&prev, &current),
            vec![ProcessEvent::Started(ProcessGroup {
                name: "chrome.exe".to_string(),
                count: 2,
                pids: vec![2, 3],
            })]
        );
    }
}
