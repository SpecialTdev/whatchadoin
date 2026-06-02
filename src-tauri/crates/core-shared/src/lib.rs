//! 공통 데이터 모델 및 인터페이스(Trait) 정의.
//!
//! 다른 크레이트가 의존하는 최하위 공유 레이어. 비즈니스 로직은 두지 않는다.

use serde::{Deserialize, Serialize};

/// 리포트 데이터 전송 객체. 구조는 추후 확정 (concept.md 참고).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReportDto {
    // TODO: 칸반/insight 등 리포트 필드 정의
}

/// 처리 엔진이 외부(app-service)에 노출하는 인터페이스.
///
/// `processing` 크레이트가 구현하고, `app-service`가 호출한다.
pub trait ProcessingApi {
    // TODO: 리포트/QA 데이터 조회 메서드 정의
}
