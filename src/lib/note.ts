// Workspace 노트(마크다운)의 로드 유틸. 이 노트는 Note 패널과 Kanban 보드의
// 단일 소스이며, Rust(app_data_dir/workspace-note.md)에 저장한다.
// 저장은 키 입력 경로가 아니라 Rust가 15s poll 주기·종료 시점에 수행한다.
// 프런트(App)는 시작 시 invoke로 한 번 읽기만 한다.

// 저장된 노트가 없는 최초 실행에서 보여줄 기본 노트.
export const DEFAULT_NOTE = `# 오늘의 작업

## 진행 중
- [ ] 칸반 리포트 레이아웃 구현
- [ ] tracking 이벤트 스키마 정의

## 완료
- [x] Tauri 개발 환경 셋업
- [x] mockup 브랜치 생성

## 메모
화면만 띄워두지 말고 실제로 밀도있게...
`;

// 저장된 노트를 불러온다. 파일이 없으면 null(최초 실행 → 기본 노트 사용),
// 웹/개발 환경 등 invoke 실패 시에도 null.
export async function loadNote(): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string | null>("get_note");
  } catch {
    return null;
  }
}
