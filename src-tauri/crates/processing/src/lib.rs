//! 비즈니스 로직 핵심.
//!
//! - [`ai`]: AI API Call 로직
//! - [`session`]: 세션 Segmentation 알고리즘
//! - [`api`]: app-service가 호출할 외부 노출 API (Trait 구현부)

pub mod ai;
pub mod api;
pub mod session;

/// 처리 엔진. tauri-main이 생성하여 app-service에 주입한다.
#[derive(Debug, Default)]
pub struct ProcessingEngine;
