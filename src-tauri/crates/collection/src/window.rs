//! 포커스된(현재 사용자가 선택 중인) 최상위 윈도우 추적.
//!
//! `active-win-pos-rs`로 OS별 차이를 흡수한다. macOS에서 앱 이름은 권한 없이
//! 얻지만, 윈도우 제목(`title`)은 화면 기록(Screen Recording) 권한이 있어야 채워진다
//! (권한이 없으면 빈 문자열로 우아하게 격하된다).

use active_win_pos_rs::get_active_window;

/// 포커스된 최상위 윈도우의 변화를 직전 스냅샷과 비교해 추적한다.
#[derive(Default)]
pub struct WindowTracker {
    prev: Option<String>,
}

/// 포커스가 바뀐 최상위 윈도우 정보.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusEvent {
    /// 앱(윈도우 소유자) 이름. 예: "Google Chrome".
    pub app: String,
    /// 윈도우 제목. 권한이 없거나 제목이 없으면 빈 문자열.
    pub title: String,
    /// 앱 프로세스 PID.
    pub pid: u64,
}

impl WindowTracker {
    /// 현재 포커스 윈도우를 조회해, 직전과 달라졌을 때만 이벤트를 돌려준다.
    /// 조회 실패(포커스 가능한 윈도우 없음 등)는 "변화 없음"으로 간주한다.
    pub fn poll(&mut self) -> Option<FocusEvent> {
        // macOS: NSWorkspace가 돌려주는 autorelease 객체가 장수 스레드에서 새지
        // 않도록 매 폴링을 autorelease 풀로 감싼다.
        #[cfg(target_os = "macos")]
        let window = objc::rc::autoreleasepool(get_active_window);
        #[cfg(not(target_os = "macos"))]
        let window = get_active_window();

        let window = window.ok()?;
        let app = window.app_name.trim().to_string();
        if app.is_empty() {
            return None;
        }
        let title = window.title.trim().to_string();

        let key = focus_key(&app, &title);
        if self.prev.as_deref() == Some(key.as_str()) {
            return None;
        }
        self.prev = Some(key);
        Some(FocusEvent {
            app,
            title,
            pid: window.process_id,
        })
    }
}

impl FocusEvent {
    /// 사람이 읽는 요약 문구. 제목이 있으면 함께, 없으면 PID를 붙인다.
    pub fn text(&self) -> String {
        if self.title.is_empty() {
            format!("포커스 전환 - {} (PID {})", self.app, self.pid)
        } else {
            format!("포커스 전환 - {} — \"{}\"", self.app, self.title)
        }
    }
}

/// 앱+제목을 합친 dedup 키. 제목이 없으면 사실상 앱 전환에서만 변화로 본다.
fn focus_key(app: &str, title: &str) -> String {
    format!("{app}\u{1f}{title}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_focus_with_title() {
        let ev = FocusEvent {
            app: "Google Chrome".to_string(),
            title: "GitHub".to_string(),
            pid: 795,
        };
        assert_eq!(ev.text(), "포커스 전환 - Google Chrome — \"GitHub\"");
    }

    #[test]
    fn formats_focus_without_title() {
        let ev = FocusEvent {
            app: "KakaoTalk".to_string(),
            title: String::new(),
            pid: 632,
        };
        assert_eq!(ev.text(), "포커스 전환 - KakaoTalk (PID 632)");
    }

    #[test]
    fn focus_key_combines_app_and_title() {
        assert_ne!(focus_key("Chrome", "A"), focus_key("Chrome", "B"));
        assert_eq!(focus_key("Chrome", "A"), focus_key("Chrome", "A"));
    }

    #[test]
    fn poll_does_not_panic() {
        // 실제 OS 조회를 (테스트 하니스의 비-메인 스레드에서) 호출해
        // 패닉 없이 Some/None 중 하나를 돌려주는지 확인한다.
        let mut tracker = WindowTracker::default();
        let _ = tracker.poll();
    }
}
