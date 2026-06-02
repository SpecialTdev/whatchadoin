//! UI 요청 처리 레이어.
//!
//! `ProcessingApi`(처리 엔진)를 주입받아 리포트/QA 데이터를 획득해 UI에 전달한다.
//! 구체 처리 크레이트가 아닌 `core-shared`의 Trait에만 의존해 결합을 낮춘다.

use core_shared::ProcessingApi;

/// UI 요청을 처리하는 서비스. tauri-main이 처리 엔진을 주입해 생성한다.
pub struct AppService<P: ProcessingApi> {
    _engine: P,
}

impl<P: ProcessingApi> AppService<P> {
    /// 처리 엔진을 주입받아 서비스를 생성한다.
    pub fn new(engine: P) -> Self {
        Self { _engine: engine }
    }
}
