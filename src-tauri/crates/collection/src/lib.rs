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

mod window;
pub use window::{FocusEvent, WindowTracker};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum ExportPrivacyLevel {
    RawData,
    WindowNamesRedacted,
    TaskNamesObfuscated,
}

impl ExportPrivacyLevel {
    pub fn from_step(step: u8) -> Option<Self> {
        match step {
            1 => Some(Self::RawData),
            2 => Some(Self::WindowNamesRedacted),
            3 => Some(Self::TaskNamesObfuscated),
            _ => None,
        }
    }

    pub fn file_suffix(self) -> &'static str {
        match self {
            Self::RawData => "raw",
            Self::WindowNamesRedacted => "window-redacted",
            Self::TaskNamesObfuscated => "task-obfuscated",
        }
    }
}

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

    /// 포커스된 최상위 윈도우(앱) 변화를 업무 이벤트로 기록한다.
    pub fn record_focus_event(&mut self, event: &FocusEvent) -> Option<Event> {
        self.insert(EventKind::Window, &event.text()).ok()
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

    /// 열린 DB에서 일관된 SQLite 스냅샷 파일을 만든 뒤, 요청 단계에 따라
    /// 내보낸 파일에만 비식별화를 적용한다.
    pub fn export_to(&self, dest: &Path, privacy_level: ExportPrivacyLevel) -> rusqlite::Result<()> {
        let sql = format!("VACUUM INTO {}", sql_string_literal(&dest.to_string_lossy()));
        self.conn.execute_batch(&sql)?;

        if privacy_level > ExportPrivacyLevel::RawData {
            let mut exported = Connection::open(dest)?;
            apply_export_privacy(&mut exported, privacy_level)?;
        }
        Ok(())
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
        EventKind::Window => "window",
    }
}

fn kind_from_str(s: &str) -> EventKind {
    match s {
        "checkin" => EventKind::Checkin,
        "process" => EventKind::Process,
        "window" => EventKind::Window,
        _ => EventKind::Note,
    }
}

fn sql_string_literal(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

fn sql_identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

#[derive(Debug)]
struct DbColumn {
    name: String,
    data_type: String,
}

fn apply_export_privacy(
    conn: &mut Connection,
    privacy_level: ExportPrivacyLevel,
) -> rusqlite::Result<()> {
    let tables = user_table_names(conn)?;
    if privacy_level >= ExportPrivacyLevel::WindowNamesRedacted {
        let mut window_aliases = HashMap::new();
        redact_named_columns(
            conn,
            &tables,
            is_window_name_column,
            "window",
            &mut window_aliases,
        )?;
        redact_window_references_in_event_texts(conn, &tables, &mut window_aliases)?;
    }

    if privacy_level >= ExportPrivacyLevel::TaskNamesObfuscated {
        let mut task_aliases = HashMap::new();
        redact_named_columns(conn, &tables, is_task_name_column, "task", &mut task_aliases)?;
        obfuscate_task_references_in_event_texts(conn, &tables, &mut task_aliases)?;
    }
    Ok(())
}

fn user_table_names(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name",
    )?;
    let rows = stmt.query_map([], |row| row.get(0))?;
    rows.collect()
}

fn table_columns(conn: &Connection, table: &str) -> rusqlite::Result<Vec<DbColumn>> {
    let sql = format!("PRAGMA table_info({})", sql_identifier(table));
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(DbColumn {
            name: row.get(1)?,
            data_type: row.get(2)?,
        })
    })?;
    rows.collect()
}

fn redact_named_columns(
    conn: &mut Connection,
    tables: &[String],
    is_target: fn(&str) -> bool,
    alias_prefix: &str,
    aliases: &mut HashMap<String, String>,
) -> rusqlite::Result<()> {
    for table in tables {
        for col in table_columns(conn, table)? {
            if !is_text_column(&col.data_type) || !is_target(&col.name) {
                continue;
            }
            redact_column_values(conn, table, &col.name, alias_prefix, aliases)?;
        }
    }
    Ok(())
}

fn redact_column_values(
    conn: &mut Connection,
    table: &str,
    column: &str,
    alias_prefix: &str,
    aliases: &mut HashMap<String, String>,
) -> rusqlite::Result<()> {
    let table_id = sql_identifier(table);
    let col_id = sql_identifier(column);
    let select = format!(
        "SELECT DISTINCT {col_id} FROM {table_id}
         WHERE {col_id} IS NOT NULL AND TRIM(CAST({col_id} AS TEXT)) <> ''
         ORDER BY CAST({col_id} AS TEXT)"
    );
    let values: Vec<String> = {
        let mut stmt = conn.prepare(&select)?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        rows.collect::<Result<_, _>>()?
    };

    let update = format!("UPDATE {table_id} SET {col_id} = ?1 WHERE {col_id} = ?2");
    for value in values {
        let alias = alias_for(aliases, &value, alias_prefix);
        conn.execute(&update, params![alias, value])?;
    }
    Ok(())
}

fn redact_window_references_in_event_texts(
    conn: &mut Connection,
    tables: &[String],
    window_aliases: &mut HashMap<String, String>,
) -> rusqlite::Result<()> {
    for table in tables {
        if !normalized_identifier(table).contains("event") {
            continue;
        }
        let columns = table_columns(conn, table)?;
        let has_kind = columns.iter().any(|col| normalized_identifier(&col.name) == "kind");
        let text_col = columns.iter().find(|col| {
            is_text_column(&col.data_type) && normalized_identifier(&col.name) == "text"
        });
        let Some(text_col) = text_col else {
            continue;
        };
        if !has_kind {
            continue;
        }

        let table_id = sql_identifier(table);
        let text_id = sql_identifier(&text_col.name);
        let select = format!(
            "SELECT rowid, kind, {text_id} FROM {table_id}
             WHERE kind IN ('window', 'process') AND {text_id} IS NOT NULL
             ORDER BY rowid"
        );
        let rows: Vec<(i64, String, String)> = {
            let mut stmt = conn.prepare(&select)?;
            let mapped = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
            mapped.collect::<Result<_, _>>()?
        };

        let update = format!("UPDATE {table_id} SET {text_id} = ?1 WHERE rowid = ?2");
        for (rowid, kind, text) in rows {
            let redacted = redact_window_event_text(&kind, &text, window_aliases);
            if redacted != text {
                conn.execute(&update, params![redacted, rowid])?;
            }
        }
    }
    Ok(())
}

fn obfuscate_task_references_in_event_texts(
    conn: &mut Connection,
    tables: &[String],
    task_aliases: &mut HashMap<String, String>,
) -> rusqlite::Result<()> {
    for table in tables {
        for col in table_columns(conn, table)? {
            if !is_text_column(&col.data_type) || !is_event_text_column(table, &col.name) {
                continue;
            }
            let table_id = sql_identifier(table);
            let col_id = sql_identifier(&col.name);
            let select = format!(
                "SELECT rowid, {col_id} FROM {table_id}
                 WHERE {col_id} IS NOT NULL
                 ORDER BY rowid"
            );
            let rows: Vec<(i64, String)> = {
                let mut stmt = conn.prepare(&select)?;
                let mapped = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
                mapped.collect::<Result<_, _>>()?
            };

            let update = format!("UPDATE {table_id} SET {col_id} = ?1 WHERE rowid = ?2");
            for (rowid, text) in rows {
                let redacted = obfuscate_task_event_text(&text, task_aliases);
                if redacted != text {
                    conn.execute(&update, params![redacted, rowid])?;
                }
            }
        }
    }
    Ok(())
}

fn redact_window_event_text(
    kind: &str,
    text: &str,
    window_aliases: &mut HashMap<String, String>,
) -> String {
    match kind {
        "window" => redact_focus_window_text(text, window_aliases),
        "process" => redact_process_window_text(text, window_aliases),
        _ => text.to_string(),
    }
}

fn redact_focus_window_text(text: &str, window_aliases: &mut HashMap<String, String>) -> String {
    const PREFIX: &str = "포커스 전환 - ";
    let Some(window) = text.strip_prefix(PREFIX) else {
        return text.to_string();
    };
    let alias = alias_for(window_aliases, window, "window");
    format!("{PREFIX}{alias}")
}

fn redact_process_window_text(text: &str, window_aliases: &mut HashMap<String, String>) -> String {
    const STARTED_PREFIX: &str = "화면에 표시 - ";
    const STOPPED_PREFIX: &str = "화면에서 사라짐 - ";
    const SNAPSHOT_PREFIX: &str = "화면 프로세스 스냅샷 - ";

    if let Some(group) = text.strip_prefix(STARTED_PREFIX) {
        return format!(
            "{STARTED_PREFIX}{}",
            redact_process_group_text(group, window_aliases)
        );
    }
    if let Some(group) = text.strip_prefix(STOPPED_PREFIX) {
        return format!(
            "{STOPPED_PREFIX}{}",
            redact_process_group_text(group, window_aliases)
        );
    }
    if text.starts_with(SNAPSHOT_PREFIX) {
        if let Some((summary, groups)) = text.split_once(": ") {
            let redacted = groups
                .split(", ")
                .map(|group| redact_process_group_text(group, window_aliases))
                .collect::<Vec<_>>()
                .join(", ");
            return format!("{summary}: {redacted}");
        }
    }
    text.to_string()
}

fn redact_process_group_text(
    group: &str,
    window_aliases: &mut HashMap<String, String>,
) -> String {
    let (name, suffix) = split_process_group_suffix(group);
    if name.trim().is_empty() {
        return group.to_string();
    }
    format!("{}{}", alias_for(window_aliases, name.trim(), "window"), suffix)
}

fn split_process_group_suffix(group: &str) -> (&str, &str) {
    if let Some(start) = group.rfind(" (PID ") {
        if group.ends_with(')') {
            return (&group[..start], &group[start..]);
        }
    }
    if let Some(start) = group.rfind(" x") {
        if group[start + 2..].chars().all(|c| c.is_ascii_digit()) {
            return (&group[..start], &group[start..]);
        }
    }
    (group, "")
}

fn is_text_column(data_type: &str) -> bool {
    let t = data_type.trim().to_ascii_uppercase();
    t.is_empty() || t.contains("CHAR") || t.contains("CLOB") || t.contains("TEXT")
}

fn is_window_name_column(name: &str) -> bool {
    let n = normalized_identifier(name);
    n.contains("window") && (n.contains("name") || n.contains("title"))
}

fn is_task_name_column(name: &str) -> bool {
    let n = normalized_identifier(name);
    n == "task" || (n.contains("task") && (n.contains("name") || n.contains("title")))
}

fn is_event_text_column(table: &str, column: &str) -> bool {
    let table = normalized_identifier(table);
    let column = normalized_identifier(column);
    table.contains("event") && (column == "text" || column == "eventtext")
}

fn normalized_identifier(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

fn obfuscate_task_event_text(text: &str, task_aliases: &mut HashMap<String, String>) -> String {
    const TASK_EVENT_PREFIXES: [&str; 5] = [
        "체크인",
        "할 일 추가",
        "할 일 삭제",
        "완료 취소",
        "완료",
    ];

    if !TASK_EVENT_PREFIXES.iter().any(|prefix| text.starts_with(prefix)) {
        return text.to_string();
    }

    let Some(start) = text.find('\'') else {
        return text.to_string();
    };
    let Some(end) = text.rfind('\'') else {
        return text.to_string();
    };
    if start >= end {
        return text.to_string();
    }

    let task = &text[start + 1..end];
    let alias = alias_for(task_aliases, task, "task");
    format!("{}{}{}", &text[..start + 1], alias, &text[end..])
}

fn alias_for(aliases: &mut HashMap<String, String>, value: &str, prefix: &str) -> String {
    if let Some(alias) = aliases.get(value) {
        return alias.clone();
    }
    let alias = format!("{}-{:03}", prefix, aliases.len() + 1);
    aliases.insert(value.to_string(), alias.clone());
    alias
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

    #[test]
    fn export_to_writes_sqlite_snapshot() {
        let (db_path, export_path) = temp_db_paths("raw");
        let _ = std::fs::remove_file(&db_path);
        let _ = std::fs::remove_file(&export_path);

        let mut collector = Collector::open(&db_path).unwrap();
        collector.record_checkin("DB export");
        collector
            .export_to(&export_path, ExportPrivacyLevel::RawData)
            .unwrap();

        let exported = Collector::open(&export_path).unwrap();
        let events = exported.all_events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].text, "체크인 — 'DB export' 작업 중");

        drop(exported);
        drop(collector);
        let _ = std::fs::remove_file(db_path);
        let _ = std::fs::remove_file(export_path);
    }

    #[test]
    fn export_redacts_window_name_columns() {
        let (db_path, export_path) = temp_db_paths("window");
        let _ = std::fs::remove_file(&db_path);
        let _ = std::fs::remove_file(&export_path);

        let collector = Collector::open(&db_path).unwrap();
        collector
            .conn
            .execute(
                "CREATE TABLE foreground_events (
                    id INTEGER PRIMARY KEY,
                    window_name TEXT NOT NULL,
                    window_title TEXT NOT NULL,
                    task_name TEXT NOT NULL
                )",
                [],
            )
            .unwrap();
        collector
            .conn
            .execute(
                "INSERT INTO foreground_events (window_name, window_title, task_name)
                 VALUES ('Browser', 'Pull Request', 'Review DB export')",
                [],
            )
            .unwrap();
        collector
            .insert(
                EventKind::Window,
                "포커스 전환 - Google Chrome — \"GitHub\"",
            )
            .unwrap();
        collector
            .insert(
                EventKind::Process,
                "화면에 표시 - Google Chrome - OpenAI (PID 123)",
            )
            .unwrap();

        collector
            .export_to(&export_path, ExportPrivacyLevel::WindowNamesRedacted)
            .unwrap();

        let conn = Connection::open(&export_path).unwrap();
        let row: (String, String, String) = conn
            .query_row(
                "SELECT window_name, window_title, task_name FROM foreground_events",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let event_texts: Vec<String> = {
            let mut stmt = conn.prepare("SELECT text FROM events ORDER BY id").unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert_eq!(
            row,
            (
                "window-001".into(),
                "window-002".into(),
                "Review DB export".into()
            )
        );
        assert_eq!(
            event_texts,
            vec![
                "포커스 전환 - window-003",
                "화면에 표시 - window-004 (PID 123)"
            ]
        );

        drop(conn);
        drop(collector);
        let _ = std::fs::remove_file(db_path);
        let _ = std::fs::remove_file(export_path);
    }

    #[test]
    fn export_obfuscates_task_names_cumulatively() {
        let (db_path, export_path) = temp_db_paths("task");
        let _ = std::fs::remove_file(&db_path);
        let _ = std::fs::remove_file(&export_path);

        let mut collector = Collector::open(&db_path).unwrap();
        collector.record_checkin("Review DB export");
        collector
            .insert(EventKind::Note, "할 일 추가 — 'Review DB export'")
            .unwrap();
        collector
            .conn
            .execute(
                "CREATE TABLE foreground_events (
                    id INTEGER PRIMARY KEY,
                    window_name TEXT NOT NULL,
                    task_name TEXT NOT NULL
                )",
                [],
            )
            .unwrap();
        collector
            .conn
            .execute(
                "INSERT INTO foreground_events (window_name, task_name)
                 VALUES ('Browser', 'Review DB export')",
                [],
            )
            .unwrap();

        collector
            .export_to(&export_path, ExportPrivacyLevel::TaskNamesObfuscated)
            .unwrap();

        let conn = Connection::open(&export_path).unwrap();
        let window_name: String = conn
            .query_row("SELECT window_name FROM foreground_events", [], |row| row.get(0))
            .unwrap();
        let task_name: String = conn
            .query_row("SELECT task_name FROM foreground_events", [], |row| row.get(0))
            .unwrap();
        let event_texts: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT text FROM events ORDER BY id")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };

        assert_eq!(window_name, "window-001");
        assert_eq!(task_name, "task-001");
        assert_eq!(
            event_texts,
            vec![
                "체크인 — 'task-001' 작업 중",
                "할 일 추가 — 'task-001'"
            ]
        );

        drop(conn);
        drop(collector);
        let _ = std::fs::remove_file(db_path);
        let _ = std::fs::remove_file(export_path);
    }

    fn temp_db_paths(label: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let stamp = now_millis();
        (
            std::env::temp_dir().join(format!(
                "whatchadoin-test-{}-{}-{label}.db",
                std::process::id(),
                stamp
            )),
            std::env::temp_dir().join(format!(
                "whatchadoin-export-{}-{}-{label}-'copy'.db",
                std::process::id(),
                stamp
            )),
        )
    }
}
