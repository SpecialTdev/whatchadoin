// Workspace 노트(마크다운)의 로드 유틸. 이 노트는 Note 패널과 Kanban 보드의
// 단일 소스이며, Rust(app_data_dir/workspace-note.md)에 저장한다.
// 저장은 키 입력 경로가 아니라 Rust가 15s poll 주기·종료 시점에 수행한다.
// 프런트(App)는 시작 시 invoke로 한 번 읽기만 한다.

// 저장된 노트가 없는 최초 실행에서 보여줄 기본 노트.
export const DEFAULT_NOTE = `# 해야 하는 것

## workspace 사용하기
- [ ] Note에서 이 문장을 내 작업 이름으로 바꿔보기
- [ ] Kanban으로 전환해서 카드를 다른 컬럼으로 옮겨보기
- [ ] 카드 아래에 하위 작업을 추가해보기

## checkin popup 사용하기
- [ ] 출근을 눌러 체크인을 시작하기
- [ ] 체크인 팝업에서 지금 하는 작업을 선택하기
- [ ] 하위 작업이 있는 카드를 눌러 subtask를 선택해보기
- [ ] 메모에 오늘 작업 맥락을 짧게 남기기

## setting 확인하기
- [ ] 체크인 주기를 내 리듬에 맞게 조정하기
- [ ] 사이드바와 위젯 배치를 둘러보기

## report 확인하기
- [ ] 체크인을 몇 번 남긴 뒤 Report에서 흐름 확인하기
- [ ] 작업별 시간과 메모가 어떻게 쌓이는지 살펴보기

# 신경쓰이는 것

## 유용한 기능
- [ ] Work 상단의 task chip으로 바로 체크인하기
- [ ] Pomodoro, Timer, Posture Check 위젯 구경하기
- [ ] Report에서 하루 작업 흐름과 집중 구간 확인하기
- [ ] Note와 Kanban이 같은 마크다운을 공유하는지 확인하기

## 나중에 정리할 것
- [ ] 자주 반복되는 작업을 카드로 남겨두기
- [ ] 완료한 작업은 완료 컬럼으로 옮기기
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
