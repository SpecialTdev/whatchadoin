export interface KanbanSubitem {
  id: string;
  text: string;
  done: boolean;
  children: KanbanSubitem[];
}

export interface KanbanCard {
  id: string;
  text: string;
  done: boolean;
  children: KanbanSubitem[];
}

export interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
  /** 체크리스트가 아닌 자유 텍스트 라인 (round-trip 보존용) */
  note: string;
}

export interface KanbanRow {
  id: string;
  title: string;
  columns: KanbanColumn[];
  /** 첫 컬럼(## ) 이전의 원본 텍스트 */
  preface: string;
}

export interface KanbanBoard {
  /** 첫 row(# ) 이전의 원본 텍스트 */
  preamble: string;
  rows: KanbanRow[];
}

export interface CardDropTarget {
  rowId: string;
  colId: string;
  beforeCardId: string | null;
}

export interface ColumnDropTarget {
  rowId: string;
  beforeColId: string | null;
}

export type FocusRequest =
  | { kind: "card"; id: string }
  | { kind: "subitem"; id: string }
  | null;

export type DragSource =
  | { kind: "card"; cardId: string; fromRowId: string; fromColId: string }
  | { kind: "column"; colId: string; fromRowId: string }
  | { kind: "subitem"; subitemId: string };

export type DropTarget =
  | ({ kind: "card" } & CardDropTarget)
  | ({ kind: "column" } & ColumnDropTarget)
  | {
      kind: "subitem";
      rowId: string;
      colId: string;
      cardId: string;
      parentSubitemId: string | null;
      beforeSubitemId: string | null;
    };

export interface SubitemLocation {
  rowId: string;
  colId: string;
  cardId: string;
  parentSubitemId: string | null;
  index: number;
  depth: number;
  item: KanbanSubitem;
}
