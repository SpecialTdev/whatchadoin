//! 공통 데이터 모델 및 인터페이스(Trait) 정의.
//!
//! 다른 크레이트가 의존하는 최하위 공유 레이어. 비즈니스 로직은 두지 않는다.

use serde::{Deserialize, Serialize};

/// 리포트 데이터 전송 객체. 구조는 추후 확정 (concept.md 참고).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReportDto {
    // TODO: 칸반/insight 등 리포트 필드 정의
}

/// 업무 이벤트 종류. phase 1은 note/checkin만. phase 2/3에서 App/Web/Comm 추가 예정.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventKind {
    /// workspace note(todo) 변경
    Note,
    /// 체크인 팝업 응답
    Checkin,
    /// 실행 중인 OS 프로세스 변화
    Process,
    /// 포커스된 최상위 윈도우(앱) 변화
    Window,
}

/// 백그라운드 추적이 기록하는 단일 업무 이벤트.
///
/// `collection` 크레이트가 생성·영속하고, UI(right sidebar)가 표출한다.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    /// DB row id (auto-increment)
    pub id: i64,
    /// 발생 시각 (unix epoch milliseconds)
    pub ts: i64,
    pub kind: EventKind,
    /// 사람이 읽는 요약 문구 (예: "할 일 추가 — '리포트 정리'")
    pub text: String,
}

/// 처리 엔진이 외부(app-service)에 노출하는 인터페이스.
///
/// `processing` 크레이트가 구현하고, `app-service`가 호출한다.
pub trait ProcessingApi {
    // TODO: 리포트/QA 데이터 조회 메서드 정의
}
