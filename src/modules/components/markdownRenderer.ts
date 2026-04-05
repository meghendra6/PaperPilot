import katex from "katex";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      output: "mathml",
      throwOnError: false,
      strict: false,
    });
  } catch {
    return escapeHtml(displayMode ? `$$${tex}$$` : `$${tex}$`);
  }
}

function renderInlineMarkdown(value: string) {
  // 1. Extract and render math BEFORE HTML escaping to avoid
  //    encode-then-decode round-trips (defense-in-depth against XSS).
  const mathPlaceholders: string[] = [];
  // Extract \(...\) inline math first
  let withMathExtracted = value.replace(/\\\((.+?)\\\)/g, (_match, tex) => {
    const placeholder = `\x00MATH${mathPlaceholders.length}\x00`;
    mathPlaceholders.push(renderKatex(tex, false));
    return placeholder;
  });
  // Then extract $...$ inline math
  withMathExtracted = withMathExtracted.replace(
    /(?<!\$)\$(?!\$)([^$]+?)\$(?!\$)/g,
    (_match, tex) => {
      const placeholder = `\x00MATH${mathPlaceholders.length}\x00`;
      mathPlaceholders.push(renderKatex(tex, false));
      return placeholder;
    },
  );

  // 2. Escape HTML on the non-math content
  let rendered = escapeHtml(withMathExtracted);

  // 3. Apply markdown formatting
  rendered = rendered.replace(/`([^`]+)`/g, "<code>$1</code>");
  rendered = rendered.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  rendered = rendered.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  rendered = rendered.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1");

  // 4. Restore math placeholders
  for (let i = 0; i < mathPlaceholders.length; i++) {
    rendered = rendered.replace(`\x00MATH${i}\x00`, mathPlaceholders[i]);
  }

  return rendered;
}

function appendHtmlBlock(
  doc: Document,
  fragment: DocumentFragment,
  tagName: string,
  html: string,
) {
  const element = doc.createElement(tagName);
  element.innerHTML = html;
  fragment.appendChild(element);
}

function appendList(
  doc: Document,
  fragment: DocumentFragment,
  items: string[],
  ordered: boolean,
) {
  const list = doc.createElement(ordered ? "ol" : "ul");
  for (const item of items) {
    const li = doc.createElement("li");
    li.innerHTML = renderInlineMarkdown(item);
    list.appendChild(li);
  }
  fragment.appendChild(list);
}

export function renderMarkdownFragment(text: string, doc: Document) {
  const fragment = doc.createDocumentFragment();
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    // Display math block: \[ ... \]
    if (trimmed === "\\[") {
      const mathLines: string[] = [];
      const mathStart = index;
      index += 1;
      while (
        index < lines.length &&
        lines[index].trim() !== "\\]" &&
        index - mathStart < 200
      ) {
        mathLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length && lines[index].trim() === "\\]") {
        index += 1;
        const mathDiv = doc.createElement("div");
        mathDiv.className = "pp-math-block";
        mathDiv.innerHTML = renderKatex(mathLines.join("\n"), true);
        fragment.appendChild(mathDiv);
        continue;
      }
      // Unclosed \[ — rewind and treat as paragraph
      index = mathStart;
    }
    // Single-line display math: \[ content \]
    const bracketMath = trimmed.match(/^\\\[(.+)\\\]$/);
    if (bracketMath) {
      const mathDiv = doc.createElement("div");
      mathDiv.className = "pp-math-block";
      mathDiv.innerHTML = renderKatex(bracketMath[1].trim(), true);
      fragment.appendChild(mathDiv);
      index += 1;
      continue;
    }

    // Display math block: $$ ... $$
    if (trimmed.startsWith("$$")) {
      if (trimmed.endsWith("$$") && trimmed.length > 4) {
        // Single-line display math: $$ content $$
        const tex = trimmed.slice(2, -2).trim();
        const mathDiv = doc.createElement("div");
        mathDiv.className = "pp-math-block";
        mathDiv.innerHTML = renderKatex(tex, true);
        fragment.appendChild(mathDiv);
        index += 1;
        continue;
      }
      // Multi-line display math
      const mathLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("$$")) {
        mathLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      const mathDiv = doc.createElement("div");
      mathDiv.className = "pp-math-block";
      mathDiv.innerHTML = renderKatex(mathLines.join("\n"), true);
      fragment.appendChild(mathDiv);
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      const pre = doc.createElement("pre");
      const code = doc.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.appendChild(code);
      fragment.appendChild(pre);
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      appendHtmlBlock(
        doc,
        fragment,
        `h${heading[1].length}`,
        renderInlineMarkdown(heading[2]),
      );
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      appendHtmlBlock(
        doc,
        fragment,
        "blockquote",
        quoteLines.map(renderInlineMarkdown).join("<br />"),
      );
      continue;
    }

    if (/^([-*_])(?:\s*\1){2,}\s*$/.test(trimmed)) {
      appendHtmlBlock(doc, fragment, "hr", "");
      index += 1;
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.*)$/);
    if (unordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].trim().match(/^[-*+]\s+(.*)$/);
        if (!match) {
          break;
        }
        items.push(match[1]);
        index += 1;
      }
      appendList(doc, fragment, items, false);
      continue;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.*)$/);
    if (ordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].trim().match(/^\d+\.\s+(.*)$/);
        if (!match) {
          break;
        }
        items.push(match[1]);
        index += 1;
      }
      appendList(doc, fragment, items, true);
      continue;
    }

    // Table detection: | col1 | col2 | ...
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableRows: string[] = [];
      while (
        index < lines.length &&
        lines[index].trim().startsWith("|") &&
        lines[index].trim().endsWith("|")
      ) {
        tableRows.push(lines[index].trim());
        index += 1;
      }
      if (tableRows.length >= 2) {
        appendTable(doc, fragment, tableRows);
        continue;
      }
      // Not a valid table, fall through to paragraph
      index -= tableRows.length;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      if (paragraphLines.length > 0) {
        const next = lines[index].trim();
        if (
          next === "\\[" ||
          next.startsWith("$$") ||
          next.startsWith("```") ||
          /^#{1,6}\s/.test(next) ||
          next.startsWith(">") ||
          /^[-*+]\s/.test(next) ||
          /^\d+\.\s/.test(next) ||
          /^([-*_])(?:\s*\1){2,}\s*$/.test(next) ||
          (next.startsWith("|") && next.endsWith("|"))
        ) {
          break;
        }
      }
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    appendHtmlBlock(
      doc,
      fragment,
      "p",
      paragraphLines.map(renderInlineMarkdown).join("<br />"),
    );
  }

  return fragment;
}

function parseTableCells(row: string): string[] {
  return row
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(row: string): boolean {
  return parseTableCells(row).every((cell) => /^[-:]+$/.test(cell));
}

function appendTable(
  doc: Document,
  fragment: DocumentFragment,
  rows: string[],
) {
  const table = doc.createElement("table");
  table.className = "pp-table";

  const headerCells = parseTableCells(rows[0]);
  const hasSeparator = rows.length > 1 && isSeparatorRow(rows[1]);
  const dataStartIndex = hasSeparator ? 2 : 1;

  if (hasSeparator) {
    const thead = doc.createElement("thead");
    const tr = doc.createElement("tr");
    for (const cell of headerCells) {
      const th = doc.createElement("th");
      th.innerHTML = renderInlineMarkdown(cell);
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);
  }

  const tbody = doc.createElement("tbody");
  const startCells = hasSeparator ? [] : [headerCells];
  const allDataRows = [
    ...startCells,
    ...rows.slice(dataStartIndex).map(parseTableCells),
  ];

  for (const cells of allDataRows) {
    if (isSeparatorRow(rows[startCells.length ? 0 : dataStartIndex])) {
      continue;
    }
    const tr = doc.createElement("tr");
    for (const cell of cells) {
      const td = doc.createElement("td");
      td.innerHTML = renderInlineMarkdown(cell);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  fragment.appendChild(table);
}
