import { useEffect, useRef, useState } from "react";
import {
  type FocusRequest,
  type KanbanBoard,
  parseMarkdown,
  serializeBoard,
} from "../../lib/kanban";

export function useKanbanBoardState(
  markdown: string,
  onChange: (markdown: string) => void,
) {
  const [board, setBoard] = useState<KanbanBoard>(() => parseMarkdown(markdown));
  const [focusRequest, setFocusRequest] = useState<FocusRequest>(null);

  // 우리가 직접 직렬화해 내보낸 마크다운인지 추적해, 외부(note) 편집만 re-parse.
  const lastSerialized = useRef<string>(markdown);

  useEffect(() => {
    if (markdown !== lastSerialized.current) {
      setBoard(parseMarkdown(markdown));
      lastSerialized.current = markdown;
    }
  }, [markdown]);

  function commit(next: KanbanBoard, focus: FocusRequest = null) {
    setBoard(next);
    if (focus) setFocusRequest(focus);
    const md = serializeBoard(next);
    lastSerialized.current = md;
    onChange(md);
  }

  return {
    board,
    commit,
    focusRequest,
    setFocusRequest,
  };
}
