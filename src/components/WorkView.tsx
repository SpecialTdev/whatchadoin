import { useState } from "react";
import KanbanBoard from "./KanbanBoard";

const SAMPLE_NOTE = `# 오늘의 작업

## 진행 중
- [ ] 칸반 리포트 레이아웃 구현
- [ ] tracking 이벤트 스키마 정의

## 완료
- [x] Tauri 개발 환경 셋업
- [x] mockup 브랜치 생성

## 메모
화면만 띄워두지 말고 실제로 밀도있게...
`;

type Mode = "note" | "kanban";

interface Props {
  tasks: string[];
  activeTask: string | null;
}

function WorkView({ tasks, activeTask }: Props) {
  // note(markdown) = single source of truth. kanban은 이를 파싱/직렬화해 편집한다.
  const [note, setNote] = useState(SAMPLE_NOTE);
  const [mode, setMode] = useState<Mode>("note");

  return (
    <div className="work-view">
      <div className="editor-toolbar">
        <div className="editor-toolbar-left">
          <span className="editor-title">Workspace</span>
          <nav className="ws-mode-switch" aria-label="편집 모드">
            <button
              className={mode === "note" ? "active" : ""}
              onClick={() => setMode("note")}
            >
              Note
            </button>
            <button
              className={mode === "kanban" ? "active" : ""}
              onClick={() => setMode("kanban")}
            >
              Kanban
            </button>
          </nav>
        </div>
        <span className="tracking-status">
          <span className="tracking-dot" />
          15s마다 변경 추적 중
        </span>
      </div>

      {tasks.length > 0 && (
        <div className="task-bar">
          {tasks.map((task) => (
            <span
              key={task}
              className={`task-chip${task === activeTask ? " active" : ""}`}
            >
              {task}
            </span>
          ))}
        </div>
      )}

      {mode === "note" ? (
        <textarea
          className="markdown-editor"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <KanbanBoard markdown={note} onChange={setNote} />
      )}

      <div className="editor-footer">
        <span className="hint">
          {mode === "note"
            ? "WYSIWYG markdown editor — ## 제목은 컬럼, - [ ] 항목은 카드가 됩니다."
            : "카드를 드래그해 컬럼 간 이동 · 변경사항은 Note와 자동 동기화됩니다."}
        </span>
      </div>
    </div>
  );
}

export default WorkView;
