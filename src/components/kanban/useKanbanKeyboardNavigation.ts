import type { KeyboardEvent as ReactKeyboardEvent } from "react";

type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

function isArrowKey(key: string): key is ArrowKey {
  return (
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "ArrowLeft" ||
    key === "ArrowRight"
  );
}

export function resolveVerticalTargetIndex(
  currentIndex: number,
  key: "ArrowUp" | "ArrowDown",
  itemCount: number,
): number | null {
  const next = currentIndex + (key === "ArrowUp" ? -1 : 1);
  return next >= 0 && next < itemCount ? next : null;
}

export function resolveHorizontalTargetIndex(
  currentIndex: number,
  targetItemCount: number,
): number | null {
  if (targetItemCount <= 0) return null;
  return Math.min(currentIndex, targetItemCount - 1);
}

export function resolveCrossRowVerticalTargetIndex(
  key: "ArrowUp" | "ArrowDown",
  targetItemCount: number,
): number | null {
  if (targetItemCount <= 0) return null;
  return key === "ArrowUp" ? targetItemCount - 1 : 0;
}

function focusInput(input: HTMLInputElement | null | undefined): boolean {
  if (!input) return false;
  input.focus();
  const end = input.value.length;
  input.setSelectionRange(end, end);
  return true;
}

function itemInputsIn(column: Element): HTMLInputElement[] {
  return Array.from(
    column.querySelectorAll<HTMLInputElement>('input[data-kanban-focus="item"]'),
  );
}

function canLeaveTextInput(input: HTMLInputElement, key: ArrowKey): boolean {
  if (key !== "ArrowLeft" && key !== "ArrowRight") return true;
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? start;
  if (start !== end) return false;
  return key === "ArrowLeft" ? start === 0 : end === input.value.length;
}

export function useKanbanKeyboardNavigation() {
  function handleArrowNavigation(event: ReactKeyboardEvent<HTMLInputElement>): boolean {
    if (!isArrowKey(event.key)) return false;

    const input = event.currentTarget;
    if (!canLeaveTextInput(input, event.key)) return false;

    const rowEl = input.closest("[data-row-id]");
    const colEl = input.closest("[data-col-id]");
    if (!rowEl || !colEl) return false;

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const items = itemInputsIn(colEl);
      const currentIndex = items.indexOf(input);
      if (currentIndex < 0) return false;
      const targetIndex = resolveVerticalTargetIndex(
        currentIndex,
        event.key,
        items.length,
      );
      if (targetIndex !== null) {
        event.preventDefault();
        return focusInput(items[targetIndex]);
      }

      const rows = Array.from(
        document.querySelectorAll<HTMLElement>("[data-row-id]"),
      );
      const currentRowIndex = rows.indexOf(rowEl as HTMLElement);
      if (currentRowIndex < 0) return false;

      const columns = Array.from(
        rowEl.querySelectorAll<HTMLElement>("[data-col-id]"),
      );
      const currentColIndex = columns.indexOf(colEl as HTMLElement);
      if (currentColIndex < 0) return false;

      const targetRowIndex =
        currentRowIndex + (event.key === "ArrowUp" ? -1 : 1);
      const targetRow = rows[targetRowIndex];
      const targetCol =
        targetRow?.querySelectorAll<HTMLElement>("[data-col-id]")[
          currentColIndex
        ];
      if (!targetCol) return false;

      const targetItems = itemInputsIn(targetCol);
      const crossRowTargetIndex = resolveCrossRowVerticalTargetIndex(
        event.key,
        targetItems.length,
      );

      event.preventDefault();
      if (crossRowTargetIndex !== null) {
        return focusInput(targetItems[crossRowTargetIndex]);
      }

      return focusInput(
        targetCol.querySelector<HTMLInputElement>(
          'input[data-kanban-focus="column-title"]',
        ),
      );
    }

    const columns = Array.from(rowEl.querySelectorAll<HTMLElement>("[data-col-id]"));
    const currentColIndex = columns.indexOf(colEl as HTMLElement);
    if (currentColIndex < 0) return false;

    const targetColIndex =
      currentColIndex + (event.key === "ArrowLeft" ? -1 : 1);
    const targetCol = columns[targetColIndex];
    if (!targetCol) return false;

    const currentItems = itemInputsIn(colEl);
    const currentItemIndex = Math.max(0, currentItems.indexOf(input));
    const targetItems = itemInputsIn(targetCol);
    const targetItemIndex = resolveHorizontalTargetIndex(
      currentItemIndex,
      targetItems.length,
    );

    event.preventDefault();
    if (targetItemIndex !== null) return focusInput(targetItems[targetItemIndex]);

    return focusInput(
      targetCol.querySelector<HTMLInputElement>(
        'input[data-kanban-focus="column-title"]',
      ),
    );
  }

  return { handleArrowNavigation };
}
