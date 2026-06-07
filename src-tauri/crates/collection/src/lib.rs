//! 백그라운드 추적 및 데이터 수집 파이프라인.
//!
//! workspace note(todo)의 변경과 체크인 응답을 timestamp 단위의 업무 이벤트로
//! 수집해 SQLite에 영속한다 (concept.md / implement.md 참고).
//!
//! note는 프런트엔드가 소유하므로 `update_note`로 최신 스냅샷을 받아 두고,
//! tauri-main의 15s 타이머가 `poll`을 호출해 직전 스냅샷과 의미 단위로 diff한다.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use core_shared::{Event, EventKind};
use rusqlite::{params, Connection};

mod process;
pub use process::{ProcessEvent, ProcessTracker};

/// 수집 파이프라인 핸들. tauri-main이 생성해 tauri state로 관리한다.
pub struct Collector {
    conn: Connection,
    /// 프런트가 마지막으로 push한 note (가장 최신).
    latest: Option<String>,
    /// 직전 poll 시점의 note 스냅샷 (diff 기준점).
    prev: Option<String>,
}

impl Collector {
    /// SQLite를 열고 events 테이블을 준비한다.
    pub fn open(db_path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(db_path)?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS events (
                id   INTEGER PRIMARY KEY AUTOINCREMENT,
                ts   INTEGER NOT NULL,
                kind TEXT    NOT NULL,
                text TEXT    NOT NULL
            )",
            [],
        )?;
        Ok(Self {
            conn,
            latest: None,
            prev: None,
        })
    }

    /// 프런트엔드가 note를 편집할 때마다 최신 스냅샷을 받아 둔다.
    pub fn update_note(&mut self, note: String) {
        // 최초 note를 기준점(baseline)으로 잡는다. 이렇게 해야 시작 직후(첫 15s 안)의
        // 편집도 다음 poll에서 잡힌다. (baseline을 첫 poll 시점에 잡으면 그 사이 편집이
        // 전부 흡수되어 이벤트가 누락된다.)
        if self.prev.is_none() {
            self.prev = Some(note.clone());
        }
        self.latest = Some(note);
    }

    /// 15s 타이머가 호출. 직전 스냅샷과 최신 note를 diff해 변경을 영속하고
    /// 새로 만든 Event들을 반환한다.
    pub fn poll(&mut self) -> Vec<Event> {
        let cur = match &self.latest {
            Some(n) => n.clone(),
            None => return Vec::new(),
        };
        // 첫 폴링은 기준점만 잡고 이벤트를 만들지 않는다 (초기 콘텐츠로 도배 방지).
        if self.prev.is_none() {
            self.prev = Some(cur);
            return Vec::new();
        }
        let prev = self.prev.take().expect("prev is Some");
        let mut events = Vec::new();
        for (kind, text) in diff(&prev, &cur) {
            if let Ok(ev) = self.insert(kind, &text) {
                events.push(ev);
            }
        }
        self.prev = Some(cur);
        events
    }

    /// 체크인 응답을 즉시 이벤트로 기록한다.
    pub fn record_checkin(&mut self, task: &str) -> Option<Event> {
        let text = format!("체크인 — '{}' 작업 중", task);
        self.insert(EventKind::Checkin, &text).ok()
    }

    /// OS 프로세스 스냅샷/변화를 업무 이벤트로 기록한다.
    pub fn record_process_event(&mut self, event: &ProcessEvent) -> Option<Event> {
        self.insert(EventKind::Process, &event.text()).ok()
    }

    /// 저장된 모든 이벤트를 최신순으로 반환한다 (right sidebar 초기 로드용).
    pub fn all_events(&self) -> Vec<Event> {
        let mut stmt = match self
            .conn
            .prepare("SELECT id, ts, kind, text FROM events ORDER BY ts DESC, id DESC")
        {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = stmt.query_map([], |row| {
            let kind: String = row.get(2)?;
            Ok(Event {
                id: row.get(0)?,
                ts: row.get(1)?,
                kind: kind_from_str(&kind),
                text: row.get(3)?,
            })
        });
        match rows {
            Ok(iter) => iter.filter_map(Result::ok).collect(),
            Err(_) => Vec::new(),
        }
    }

    fn insert(&self, kind: EventKind, text: &str) -> rusqlite::Result<Event> {
        let ts = now_millis();
        self.conn.execute(
            "INSERT INTO events (ts, kind, text) VALUES (?1, ?2, ?3)",
            params![ts, kind_to_str(kind), text],
        )?;
        Ok(Event {
            id: self.conn.last_insert_rowid(),
            ts,
            kind,
            text: text.to_string(),
        })
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn kind_to_str(k: EventKind) -> &'static str {
    match k {
        EventKind::Note => "note",
        EventKind::Checkin => "checkin",
        EventKind::Process => "process",
    }
}

fn kind_from_str(s: &str) -> EventKind {
    match s {
        "checkin" => EventKind::Checkin,
        "process" => EventKind::Process,
        _ => EventKind::Note,
    }
}

// ── 마크다운 todo 파싱 + diff ────────────────────────────────────────────────
// 규칙은 프런트의 lib/kanban.ts를 미러링한다 (작은 규칙이라 중복 허용):
//   "## 제목"        → 컬럼
//   "- [ ] / - [x]"  → 카드 (체크박스 = done)
//   "- 항목"          → 카드 (done=false)
// 한계: 카드 텍스트를 동일성 키로 쓰므로, 텍스트 *편집*은 삭제+추가로 보인다 (phase 1 허용).

struct Parsed {
    /// (텍스트, 완료여부) 문서 순서대로 평탄화한 카드 목록.
    cards: Vec<(String, bool)>,
    /// 컬럼 제목 목록.
    columns: Vec<String>,
}

fn parse(md: &str) -> Parsed {
    let mut cards = Vec::new();
    let mut columns = Vec::new();
    for raw in md.lines() {
        let line = raw.trim_start();
        if let Some(rest) = line.strip_prefix("##") {
            if let Some(stripped) = rest.strip_prefix(' ') {
                columns.push(stripped.trim().to_string());
                continue;
            }
        }
        if let Some((done, text)) = parse_task(line) {
            cards.push((text, done));
            continue;
        }
        if let Some(text) = parse_bullet(line) {
            cards.push((text, false));
        }
    }
    Parsed { cards, columns }
}

/// "- [ ] text" / "- [x] text" / "* [X] text" → (done, text)
fn parse_task(line: &str) -> Option<(bool, String)> {
    let after_bullet = strip_bullet(line)?;
    let rest = after_bullet.strip_prefix('[')?;
    let mark = rest.chars().next()?;
    let after = rest[mark.len_utf8()..].strip_prefix(']')?;
    let done = match mark {
        'x' | 'X' => true,
        ' ' => false,
        _ => return None,
    };
    Some((done, after.trim().to_string()))
}

/// "- 항목" / "* 항목" → text (체크박스 없는 불릿)
fn parse_bullet(line: &str) -> Option<String> {
    Some(strip_bullet(line)?.trim().to_string()).filter(|t| !t.is_empty())
}

/// 선행 "-"/"*" + 공백을 제거한 나머지를 반환.
fn strip_bullet(line: &str) -> Option<&str> {
    let mut chars = line.chars();
    let first = chars.next()?;
    if first != '-' && first != '*' {
        return None;
    }
    let rest = chars.as_str();
    if !rest.starts_with(char::is_whitespace) {
        return None;
    }
    Some(rest.trim_start())
}

/// 직전(prev)과 현재(cur) note를 비교해 의미 단위 변경 목록을 만든다.
fn diff(prev: &str, cur: &str) -> Vec<(EventKind, String)> {
    let p = parse(prev);
    let c = parse(cur);
    let p_cards: HashMap<&str, bool> = p.cards.iter().map(|(t, d)| (t.as_str(), *d)).collect();
    let c_cards: HashMap<&str, bool> = c.cards.iter().map(|(t, d)| (t.as_str(), *d)).collect();

    let mut out = Vec::new();

    // 추가 / 완료 상태 변화 — cur 문서 순서대로.
    for (text, done) in &c.cards {
        match p_cards.get(text.as_str()) {
            None => out.push((EventKind::Note, format!("할 일 추가 — '{}'", text))),
            Some(&was_done) => {
                if !was_done && *done {
                    out.push((EventKind::Note, format!("완료 — '{}'", text)));
                } else if was_done && !*done {
                    out.push((EventKind::Note, format!("완료 취소 — '{}'", text)));
                }
            }
        }
    }

    // 삭제 — prev 문서 순서대로.
    for (text, _) in &p.cards {
        if !c_cards.contains_key(text.as_str()) {
            out.push((EventKind::Note, format!("할 일 삭제 — '{}'", text)));
        }
    }

    // 컬럼 추가.
    let p_cols: HashSet<&str> = p.columns.iter().map(String::as_str).collect();
    for title in &c.columns {
        if !p_cols.contains(title.as_str()) {
            out.push((EventKind::Note, format!("컬럼 추가 — '{}'", title)));
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(changes: Vec<(EventKind, String)>) -> Vec<String> {
        changes.into_iter().map(|(_, t)| t).collect()
    }

    #[test]
    fn detects_added_card() {
        let prev = "## 진행 중\n- [ ] A\n";
        let cur = "## 진행 중\n- [ ] A\n- [ ] B\n";
        assert_eq!(texts(diff(prev, cur)), vec!["할 일 추가 — 'B'"]);
    }

    #[test]
    fn detects_completion() {
        let prev = "## 진행 중\n- [ ] A\n";
        let cur = "## 진행 중\n- [x] A\n";
        assert_eq!(texts(diff(prev, cur)), vec!["완료 — 'A'"]);
    }

    #[test]
    fn detects_deletion() {
        let prev = "## 진행 중\n- [ ] A\n- [ ] B\n";
        let cur = "## 진행 중\n- [ ] A\n";
        assert_eq!(texts(diff(prev, cur)), vec!["할 일 삭제 — 'B'"]);
    }

    #[test]
    fn detects_new_column() {
        let prev = "## 진행 중\n";
        let cur = "## 진행 중\n## 완료\n";
        assert_eq!(texts(diff(prev, cur)), vec!["컬럼 추가 — '완료'"]);
    }

    #[test]
    fn no_change_no_events() {
        let s = "# 오늘\n## 진행 중\n- [ ] A\n- [x] B\n## 메모\n자유 텍스트\n";
        assert!(diff(s, s).is_empty());
    }
}
