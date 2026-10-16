// @vitest-environment jsdom
import { act, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractOpenTaskOptions, extractOpenTasks } from "../lib/kanban";
import WorkView from "./WorkView";

const NOTE = `# Tasks

## Progress
- [ ] Alpha
  - [ ] Child
    - [ ] Nested
- [ ] Beta
`;

let container: HTMLDivElement;
let root: Root;

function Harness() {
  const [note, setNote] = useState(NOTE);
  const [focusSignal, setFocusSignal] = useState(0);
  return (
    <>
      <WorkView
        note={note}
        onNoteChange={setNote}
        tasks={extractOpenTasks(note)}
        taskOptions={extractOpenTaskOptions(note)}
        activeTask={null}
        focusSignal={focusSignal}
      />
      <output>{note}</output>
      <button onClick={() => setFocusSignal((value) => value + 1)}>Direct input</button>
      <button onClick={() => setNote(NOTE.replace("Alpha", "External task"))}>
        Replace note
      </button>
    </>
  );
}

function inputText(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  caret = value.length,
) {
  const prototype = input instanceof HTMLInputElement
    ? HTMLInputElement.prototype
    : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonNamed(name: string) {
  return Array.from(container.querySelectorAll("button"))
    .find((button) => button.textContent?.trim() === name)!;
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Kanban editing in WorkView", () => {
  it("opens Kanban by default and focuses Note for direct input", async () => {
    expect(container.querySelector(".kanban-wrap")).not.toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
    expect(buttonNamed("Kanban").className).toBe("active");
    await act(async () => buttonNamed("Direct input").click());
    expect(document.activeElement).toBe(container.querySelector("textarea"));
    container.querySelector("textarea")!.blur();
    await act(async () => buttonNamed("Direct input").click());
    expect(document.activeElement).toBe(container.querySelector("textarea"));
  });
  it.each([
    ".kanban-card-text",
    ".kanban-subitem-text",
    ".kanban-subitems.nested .kanban-subitem-text",
    ".kanban-row-title",
    ".kanban-col-title",
  ])("preserves the input, focus and caret during rapid edits to %s", async (selector) => {
    const input = container.querySelector<HTMLInputElement>(selector)!;
    input.focus();
    // Commit input events before the passive draft-sync updates settle, as can
    // happen during rapid typing. Awaiting act after each key hides this race.
    await act(async () => {
      for (const value of ["Edited", "Edited ", "Edited text", "EdXXited text"]) {
        flushSync(() => inputText(input, value, 4));
        expect(container.querySelector(selector)).toBe(input);
        expect(document.activeElement).toBe(input);
        expect(input.value).toBe(value);
        expect(input.selectionStart).toBe(4);
      }
    });
    expect(container.querySelector(selector)).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("EdXXited text");
    expect(input.selectionStart).toBe(4);
    expect(input.selectionEnd).toBe(4);
    expect(container.querySelector("output")!.textContent).toContain("EdXXited text");
  });

  it("flushes pending Note edits when switching to Kanban and back", async () => {
    await act(async () => buttonNamed("Note").click());
    const textarea = container.querySelector("textarea")!;
    const editedNote = NOTE.replace("Alpha", "Edited in Note");
    await act(async () => {
      flushSync(() => inputText(textarea, editedNote));
      flushSync(() => buttonNamed("Kanban").click());
    });
    expect(container.querySelector<HTMLInputElement>(".kanban-card-text")!.value)
      .toBe("Edited in Note");
    expect(container.querySelector("output")!.textContent).toBe(editedNote);

    const input = container.querySelector<HTMLInputElement>(".kanban-card-text")!;
    await act(async () => {
      flushSync(() => inputText(input, "Edited in Kanban"));
      flushSync(() => buttonNamed("Note").click());
    });
    expect(container.querySelector("textarea")!.value).toContain("Edited in Kanban");
  });

  it("still applies external Note changes to the board", async () => {
    await act(async () => buttonNamed("Replace note").click());
    expect(container.querySelector<HTMLInputElement>(".kanban-card-text")!.value)
      .toBe("External task");
  });
});
