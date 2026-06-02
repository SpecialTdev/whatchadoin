//! 백그라운드 추적 및 데이터 수집 파이프라인 (stub).
//!
//! note 변경 등 업무 이벤트를 timestamp 단위로 수집한다 (implement.md 참고).

/// 수집 파이프라인 핸들.
#[derive(Debug, Default)]
pub struct Collector;

impl Collector {
    /// 백그라운드 추적을 시작한다.
    pub fn start(&self) {
        // TODO: 주기적 note 변경 추적(기본 15s) 및 이벤트 기록 구현
    }
}
