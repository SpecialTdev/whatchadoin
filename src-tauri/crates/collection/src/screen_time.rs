use std::collections::BTreeMap;

use super::{now_millis, Collector};
use rusqlite::params;
use serde_json::{json, Value};

const MAX_SAMPLE_GAP_MS: i64 = 5_000;
const MAX_LEGACY_GAP_MS: i64 = 300_000;
const CHECKPOINT_MS: i64 = 30_000;

pub(super) struct ActiveUsage {
    app: String,
    start: i64,
    observed: i64,
    checkpoint: i64,
}

pub(super) const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS screen_usage (
        start_ms INTEGER PRIMARY KEY,
        end_ms INTEGER NOT NULL,
        app_name TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS screen_time_window_events ON events(ts, id) WHERE kind = 'window';";

impl Collector {
    pub fn observe_screen_time(&mut self, app: Option<&str>) -> rusqlite::Result<Value> {
        self.observe_usage(app, now_millis())
    }

    fn observe_usage(&mut self, app: Option<&str>, now: i64) -> rusqlite::Result<Value> {
        let mut changed = false;
        if let Some(active) = self.active_usage.as_mut() {
            let gap = now - active.observed;
            if gap > 0 && gap <= MAX_SAMPLE_GAP_MS && app.is_some() {
                active.observed = now;
            }
            let continues =
                (0..=MAX_SAMPLE_GAP_MS).contains(&gap) && app == Some(active.app.as_str());
            if !continues || now - active.checkpoint >= CHECKPOINT_MS {
                if active.observed > active.start {
                    self.conn.execute(
                        "INSERT INTO screen_usage VALUES (?1, ?2, ?3)
                         ON CONFLICT(start_ms) DO UPDATE SET end_ms = excluded.end_ms",
                        params![active.start, active.observed, active.app],
                    )?;
                }
                active.checkpoint = now;
            }
            if !continues {
                self.active_usage = None;
                changed = true;
            }
        }
        if let Some(app) = app.filter(|_| self.active_usage.is_none()) {
            self.active_usage = Some(ActiveUsage {
                app: app.into(),
                start: now,
                observed: now,
                checkpoint: now,
            });
            changed = true;
        }
        Ok(json!({ "changed": changed, "active": self.active_payload() }))
    }

    fn active_payload(&self) -> Option<Value> {
        self.active_usage.as_ref().map(
            |usage| json!({ "app": usage.app, "start": usage.start, "observed": usage.observed }),
        )
    }

    pub fn screen_time(&self, start: i64, end: i64) -> rusqlite::Result<Value> {
        let active_start = self.active_usage.as_ref().map(|usage| usage.start);
        // Intervals do not overlap. At most one starts before the requested day.
        let mut query = self.conn.prepare(
            "SELECT app_name, SUM(MIN(end_ms, ?2) - MAX(start_ms, ?1))
             FROM screen_usage
             WHERE end_ms > ?1 AND start_ms < ?2
               AND start_ms >= COALESCE(
                   (SELECT MAX(start_ms) FROM screen_usage WHERE start_ms < ?1), ?1)
               AND (?3 IS NULL OR start_ms != ?3)
             GROUP BY app_name",
        )?;
        let apps = query
            .query_map(params![start, end, active_start], |row| {
                Ok(json!({ "app": row.get::<_, String>(0)?, "ms": row.get::<_, i64>(1)? }))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let active_overlaps = self
            .active_usage
            .as_ref()
            .is_some_and(|usage| usage.start < end && usage.observed.saturating_add(2_000) > start);
        let estimated = apps.is_empty() && !active_overlaps;
        let apps = if estimated {
            self.estimate_screen_time(start, end)?
        } else {
            apps
        };
        Ok(json!({
            "estimated": estimated && !apps.is_empty(),
            "apps": apps,
            "active": self.active_payload(),
            "supported": screen_time_supported()
        }))
    }

    fn estimate_screen_time(&self, start: i64, end: i64) -> rusqlite::Result<Vec<Value>> {
        let mut query = self.conn.prepare(
            "SELECT ts, text FROM events
             WHERE kind = 'window' AND ts BETWEEN ?1 AND ?2
             ORDER BY ts, id",
        )?;
        let mut rows = query.query(params![
            start.saturating_sub(MAX_LEGACY_GAP_MS),
            end.saturating_add(MAX_LEGACY_GAP_MS),
        ])?;
        let mut previous: Option<(i64, String)> = None;
        let mut totals = BTreeMap::<String, i64>::new();
        while let Some(row) = rows.next()? {
            let ts: i64 = row.get(0)?;
            let text: String = row.get(1)?;
            let Some(app) = legacy_app(&text) else {
                previous = None;
                continue;
            };
            if let Some((prior_ts, prior_app)) = previous.replace((ts, app.to_owned())) {
                let gap = ts - prior_ts;
                let overlap = ts.min(end) - prior_ts.max(start);
                if (1..=MAX_LEGACY_GAP_MS).contains(&gap) && overlap > 0 {
                    *totals.entry(prior_app).or_default() += overlap;
                }
            }
        }
        Ok(totals
            .into_iter()
            .map(|(app, ms)| json!({ "app": app, "ms": ms }))
            .collect())
    }

    pub fn screen_time_dates(&self) -> rusqlite::Result<Vec<(i64, i64)>> {
        let mut query = self.conn.prepare(
            "SELECT MIN(start_ms), MAX(end_ms) FROM screen_usage GROUP BY start_ms / 86400000
             UNION ALL
             SELECT MIN(ts), MAX(ts) + 1 FROM events
             WHERE kind = 'window' AND text LIKE '포커스 전환 - %'
             GROUP BY ts / 86400000",
        )?;
        let mut ranges = query
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if let Some(usage) = self.active_usage.as_ref() {
            ranges.push((usage.start, usage.observed.max(usage.start + 1)));
        }
        Ok(ranges)
    }
}

fn legacy_app(text: &str) -> Option<&str> {
    let event = text.strip_prefix("포커스 전환 - ")?;
    let app = if let Some((app, _)) = event.split_once(" — \"") {
        app
    } else if let Some((app, pid)) = event.rsplit_once(" (PID ") {
        pid.strip_suffix(')')?.parse::<u64>().ok()?;
        app
    } else {
        return None;
    };
    let app = app.trim();
    (!app.is_empty()).then_some(app)
}

pub fn screen_time_supported() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows"))
}

#[cfg(target_os = "macos")]
pub fn screen_is_active() -> bool {
    use std::ffi::{c_char, c_void};
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: u32, event: u32) -> f64;
        fn CGMainDisplayID() -> u32;
        fn CGDisplayIsAsleep(display: u32) -> u32;
        fn CGSessionCopyCurrentDictionary() -> *const c_void;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFStringCreateWithCString(
            allocator: *const c_void,
            s: *const c_char,
            encoding: u32,
        ) -> *const c_void;
        fn CFDictionaryGetValue(dict: *const c_void, key: *const c_void) -> *const c_void;
        fn CFBooleanGetValue(value: *const c_void) -> bool;
        fn CFRelease(value: *const c_void);
    }
    unsafe {
        if CGDisplayIsAsleep(CGMainDisplayID()) != 0
            || CGEventSourceSecondsSinceLastEventType(1, u32::MAX) >= 300.0
        {
            return false;
        }
        let session = CGSessionCopyCurrentDictionary();
        if session.is_null() {
            return false;
        }
        let flag = |name: &std::ffi::CStr| {
            let key = CFStringCreateWithCString(std::ptr::null(), name.as_ptr(), 0x0800_0100);
            if key.is_null() {
                return false;
            }
            let value = CFDictionaryGetValue(session, key);
            CFRelease(key);
            !value.is_null() && CFBooleanGetValue(value)
        };
        let active = flag(c"kCGSSessionOnConsoleKey") && !flag(c"CGSSessionScreenIsLocked");
        CFRelease(session);
        active
    }
}

#[cfg(target_os = "windows")]
pub fn screen_is_active() -> bool {
    use std::ffi::c_void;
    #[repr(C)]
    struct LastInputInfo {
        size: u32,
        tick: u32,
    }
    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetLastInputInfo(info: *mut LastInputInfo) -> i32;
        fn OpenInputDesktop(flags: u32, inherit: i32, access: u32) -> *mut c_void;
        fn CloseDesktop(desktop: *mut c_void) -> i32;
        fn GetUserObjectInformationW(
            handle: *mut c_void,
            index: i32,
            info: *mut c_void,
            length: u32,
            needed: *mut u32,
        ) -> i32;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetTickCount() -> u32;
    }
    unsafe {
        let mut input = LastInputInfo { size: 8, tick: 0 };
        if GetLastInputInfo(&mut input) == 0 || GetTickCount().wrapping_sub(input.tick) >= 300_000 {
            return false;
        }
        let desktop = OpenInputDesktop(0, 0, 1);
        if desktop.is_null() {
            return false;
        }
        let mut name = [0u16; 64];
        let mut needed = 0;
        let ok = GetUserObjectInformationW(desktop, 2, name.as_mut_ptr().cast(), 128, &mut needed);
        CloseDesktop(desktop);
        ok != 0
            && String::from_utf16_lossy(
                &name[..name.iter().position(|&c| c == 0).unwrap_or(name.len())],
            )
            .eq_ignore_ascii_case("Default")
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn screen_is_active() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimates_only_bounded_legacy_intervals_when_measured_usage_is_absent() {
        let mut collector = Collector::open(std::path::Path::new(":memory:")).unwrap();
        for (ts, text) in [
            (1_000, "포커스 전환 - Editor (PID 7)"),
            (5_000, "포커스 전환 - Browser — \"Tab\""),
            (1_000_000, "포커스 전환 - Terminal (PID 8)"),
        ] {
            collector
                .conn
                .execute(
                    "INSERT INTO events (ts, kind, text) VALUES (?1, 'window', ?2)",
                    params![ts, text],
                )
                .unwrap();
        }

        let estimate = collector.screen_time(2_000, 2_000_000).unwrap();
        assert_eq!(estimate["estimated"], true);
        assert_eq!(estimate["apps"], json!([{ "app": "Editor", "ms": 3000 }]));
        assert_eq!(
            collector.screen_time_dates().unwrap(),
            vec![(1000, 1_000_001)]
        );
        assert_eq!(
            collector.screen_time(1_000_000, 2_000_000).unwrap()["estimated"],
            false
        );

        collector.observe_usage(Some("Measured"), 10_000).unwrap();
        assert_eq!(
            collector.screen_time(2_000, 2_000_000).unwrap()["estimated"],
            false
        );
        collector.observe_usage(Some("Measured"), 12_000).unwrap();
        collector.observe_usage(None, 14_000).unwrap();
        let measured = collector.screen_time(2_000, 2_000_000).unwrap();
        assert_eq!(measured["estimated"], false);
        assert_eq!(measured["apps"], json!([{ "app": "Measured", "ms": 2000 }]));
    }

    #[test]
    fn clips_days_and_excludes_unobserved_gaps_without_double_counting_checkpoints() {
        let mut collector = Collector::open(std::path::Path::new(":memory:")).unwrap();
        for tick in 0..=16 {
            collector
                .observe_usage(Some("Editor"), 1_000 + tick * 2_000)
                .unwrap();
        }
        assert_eq!(
            collector.screen_time(30_000, 40_000).unwrap()["apps"],
            json!([])
        );
        collector.observe_usage(Some("Browser"), 35_000).unwrap();
        collector.observe_usage(Some("Browser"), 3_600_000).unwrap();
        collector.observe_usage(None, 3_602_000).unwrap();
        assert_eq!(
            collector.screen_time(30_000, 4_000_000).unwrap()["apps"],
            json!([{ "app": "Editor", "ms": 5000 }])
        );
        assert_eq!(
            collector.screen_time(30_000, 32_000).unwrap()["apps"],
            json!([{ "app": "Editor", "ms": 2000 }])
        );
    }
}
