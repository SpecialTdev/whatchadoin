import type { ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={`${match.index}-code`}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(<strong key={`${match.index}-bold`}>{token.slice(2, -2)}</strong>);
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function inline(text: string) {
  return <>{renderInline(text)}</>;
}

function renderHeading(level: number, text: string, key: number) {
  if (level === 1) return <h1 key={key}>{inline(text)}</h1>;
  if (level === 2) return <h2 key={key}>{inline(text)}</h2>;
  return <h3 key={key}>{inline(text)}</h3>;
}

export function renderMarkdown(markdown: string, emptyText = "메모가 없습니다."): ReactNode {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return <p className="markdown-empty">{emptyText}</p>;
  }

  const nodes: ReactNode[] = [];
  const listItems: ReactNode[] = [];
  const codeLines: string[] = [];
  let inCode = false;

  function flushList(key: number) {
    if (listItems.length === 0) return;
    nodes.push(<ul key={`ul-${key}`}>{listItems.splice(0)}</ul>);
  }

  markdown.split("\n").forEach((line, index) => {
    const fence = line.trim().startsWith("```");
    if (fence) {
      if (inCode) {
        nodes.push(
          <pre key={`pre-${index}`}>
            <code>{codeLines.splice(0).join("\n")}</code>
          </pre>,
        );
        inCode = false;
      } else {
        flushList(index);
        inCode = true;
      }
      return;
    }

    if (inCode) {
      codeLines.push(line);
      return;
    }

    if (!line.trim()) {
      flushList(index);
      return;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushList(index);
      nodes.push(renderHeading(heading[1].length, heading[2], index));
      return;
    }

    const checked = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/);
    if (checked) {
      listItems.push(
        <li key={`li-${index}`} className="markdown-check-item">
          <input type="checkbox" checked={checked[1].toLowerCase() === "x"} readOnly />
          <span>{inline(checked[2])}</span>
        </li>,
      );
      return;
    }

    const item = line.match(/^\s*[-*]\s+(.+)$/);
    if (item) {
      listItems.push(<li key={`li-${index}`}>{inline(item[1])}</li>);
      return;
    }

    const quote = line.match(/^>\s?(.+)$/);
    if (quote) {
      flushList(index);
      nodes.push(<blockquote key={`quote-${index}`}>{inline(quote[1])}</blockquote>);
      return;
    }

    flushList(index);
    nodes.push(<p key={`p-${index}`}>{inline(line.trim())}</p>);
  });

  flushList(markdown.length);
  if (inCode) {
    nodes.push(
      <pre key="pre-tail">
        <code>{codeLines.join("\n")}</code>
      </pre>,
    );
  }

  return nodes;
}
