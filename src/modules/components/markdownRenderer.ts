import * as katex from "katex";
import { openPublicURL, safePublicURL } from "../message/publicLinks";

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

// RFC 3986 characters only: CJK or Hangul text written right after a URL,
// quotes, and markup must not join the link target.
const BARE_URL_PATTERN = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;

function countOf(text: string, character: string) {
  return text.split(character).length - 1;
}

/** Drops trailing punctuation and unbalanced closing brackets. */
function trimBareURL(url: string) {
  let end = url.length;
  while (end > 0) {
    const character = url[end - 1];
    const head = url.slice(0, end);
    const unbalanced =
      (character === ")" && countOf(head, ")") > countOf(head, "(")) ||
      (character === "]" && countOf(head, "]") > countOf(head, "["));
    if (!unbalanced && !/[.,;:!?*_'"]/.test(character)) break;
    end -= 1;
  }
  return url.slice(0, end);
}

export function renderInlineMarkdown(value: string) {
  const safeValue = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint === 9 ||
        codePoint === 10 ||
        codePoint === 13 ||
        codePoint > 31
      );
    })
    .filter((character) => character.codePointAt(0) !== 127)
    .join("");
  // 1. Extract and render math BEFORE HTML escaping to avoid
  //    encode-then-decode round-trips (defense-in-depth against XSS).
  const mathPlaceholders: string[] = [];
  let placeholderPrefix = "PP_MATH_PLACEHOLDER_";
  while (safeValue.includes(placeholderPrefix)) placeholderPrefix += "_";
  const linkPlaceholders: string[] = [];
  const codePlaceholders: string[] = [];
  const linkPrefix = `${placeholderPrefix}LINK_`;
  const codePrefix = `${placeholderPrefix}CODE_`;
  // Code spans come first so math syntax inside backticks stays literal.
  let withMathExtracted = safeValue.replace(/`([^`]+)`/g, (_match, code) => {
    const token = `${codePrefix}${codePlaceholders.length}__`;
    codePlaceholders.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });
  // Extract \(...\) inline math first
  withMathExtracted = withMathExtracted.replace(
    /\\\((.+?)\\\)/g,
    (_match, tex) => {
      const placeholder = `${placeholderPrefix}${mathPlaceholders.length}__`;
      mathPlaceholders.push(renderKatex(tex, false));
      return placeholder;
    },
  );
  // Then extract $...$ inline math
  withMathExtracted = withMathExtracted.replace(
    /(?<!\$)\$(?![\s$])([^$\n]*?\S)\$(?![$\d])/g,
    (_match, tex) => {
      const placeholder = `${placeholderPrefix}${mathPlaceholders.length}__`;
      mathPlaceholders.push(renderKatex(tex, false));
      return placeholder;
    },
  );

  const link = (label: string, value: string) => {
    const url = safePublicURL(value);
    if (!url) return label;
    const token = `${linkPrefix}${linkPlaceholders.length}__`;
    linkPlaceholders.push(
      `<a href="${escapeHtml(url)}" class="pp-public-source" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
    );
    return token;
  };
  // A math or code placeholder restored inside href would put markup into
  // an attribute, which the XHTML pane's parser rejects.
  withMathExtracted = withMathExtracted
    .replace(
      /\[([^\]]+)\]\(((?:[^\s()]|\([^\s()]*\))+)\)/g,
      (match, label, url) =>
        url.includes(placeholderPrefix) ? match : link(label, url),
    )
    .replace(/<(https?:\/\/[^<>\s]+)>/g, (match, url) =>
      url.includes(placeholderPrefix) ? match : link(url, url),
    )
    .replace(BARE_URL_PATTERN, (match) => {
      const cut = match.indexOf(placeholderPrefix);
      const candidate = cut >= 0 ? match.slice(0, cut) : match;
      const trimmed = trimBareURL(candidate);
      return link(trimmed, trimmed) + match.slice(trimmed.length);
    });
  // 2. Escape HTML on the non-math content
  let rendered = escapeHtml(withMathExtracted);

  // 3. Apply markdown formatting
  rendered = rendered.replace(/`([^`]+)`/g, "<code>$1</code>");
  rendered = rendered.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  rendered = rendered.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  rendered = rendered.replace(
    new RegExp(`${linkPrefix}(\\d+)__`, "g"),
    (_match, index) => linkPlaceholders[Number(index)] ?? "",
  );
  rendered = rendered.replace(
    new RegExp(`${codePrefix}(\\d+)__`, "g"),
    (_match, index) => codePlaceholders[Number(index)] ?? "",
  );

  // 4. Restore math placeholders
  rendered = rendered.replace(
    new RegExp(`${placeholderPrefix}(\\d+)__`, "g"),
    (_match, index) => mathPlaceholders[Number(index)] ?? "",
  );

  return rendered;
}

/**
 * The pane is an XHTML document, where innerHTML throws on markup that is not
 * well-formed XML. Model output must never throw out of the renderer, so a
 * failure falls back to the source text.
 */
function setRenderedHTML(element: Element, html: string, sourceText: string) {
  try {
    element.innerHTML = html;
  } catch {
    element.textContent = sourceText;
  }
}

function appendHtmlBlock(
  doc: Document,
  fragment: DocumentFragment,
  tagName: string,
  html: string,
  sourceText = "",
) {
  const element = doc.createElement(tagName);
  setRenderedHTML(element, html, sourceText);
  fragment.appendChild(element);
}

interface ListItem {
  text: string;
  children: string[];
}

function appendList(
  doc: Document,
  fragment: DocumentFragment,
  items: ListItem[],
  ordered: boolean,
  start = 1,
) {
  const list = doc.createElement(ordered ? "ol" : "ul");
  if (ordered && start !== 1) list.setAttribute("start", String(start));
  for (const item of items) {
    const li = doc.createElement("li");
    setRenderedHTML(li, renderInlineMarkdown(item.text), item.text);
    if (item.children.length) {
      const nested = doc.createElement("ul");
      for (const child of item.children) {
        const childItem = doc.createElement("li");
        setRenderedHTML(childItem, renderInlineMarkdown(child), child);
        nested.appendChild(childItem);
      }
      li.appendChild(nested);
    }
    list.appendChild(li);
  }
  fragment.appendChild(list);
}

function parseFenceOpener(line: string) {
  const match = line.trim().match(/^(`{3,}|~{3,})(?:[A-Za-z0-9_+.-]+)?\s*$/);
  return match ? { marker: match[1][0], length: match[1].length } : undefined;
}

function isFenceCloser(
  line: string,
  opener: { marker: string; length: number },
) {
  const match = line.trim().match(/^(`{3,}|~{3,})\s*$/);
  return Boolean(
    match && match[1][0] === opener.marker && match[1].length >= opener.length,
  );
}

/**
 * Every rendered public link opens externally on an explicit click. The pane
 * is a privileged document, so Gecko's default link activation must never run,
 * whichever view shows the Markdown.
 */
function guardPublicLinks(fragment: DocumentFragment, doc: Document) {
  for (const node of Array.from(
    fragment.querySelectorAll?.("a.pp-public-source") ?? [],
  )) {
    const anchor = node as HTMLAnchorElement;
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      const url = anchor.getAttribute("href");
      if (url) openPublicURL(url, doc);
    });
  }
}

export function renderMarkdownFragment(text: string, doc: Document) {
  const fragment = buildMarkdownFragment(text, doc);
  guardPublicLinks(fragment, doc);
  return fragment;
}

function buildMarkdownFragment(text: string, doc: Document) {
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
        setRenderedHTML(
          mathDiv,
          renderKatex(mathLines.join("\n"), true),
          mathLines.join("\n"),
        );
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
      setRenderedHTML(
        mathDiv,
        renderKatex(bracketMath[1].trim(), true),
        trimmed,
      );
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
        setRenderedHTML(mathDiv, renderKatex(tex, true), trimmed);
        fragment.appendChild(mathDiv);
        index += 1;
        continue;
      }
    }

    if (trimmed === "$$") {
      // Multi-line display math
      const mathLines: string[] = [];
      const mathStart = index;
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("$$")) {
        mathLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        // Text after the closing $$ stays visible as the next block.
        const rest = lines[index].trim().slice(2).trim();
        if (rest) lines[index] = rest;
        else index += 1;
        const mathDiv = doc.createElement("div");
        mathDiv.className = "pp-math-block";
        setRenderedHTML(
          mathDiv,
          renderKatex(mathLines.join("\n"), true),
          mathLines.join("\n"),
        );
        fragment.appendChild(mathDiv);
        continue;
      }
      // Unclosed $$ (for example a cut-off answer): show it as text.
      index = mathStart;
    }

    const fence = parseFenceOpener(trimmed);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !isFenceCloser(lines[index], fence)) {
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
        heading[2],
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
        quoteLines.join("\n"),
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
      const items: ListItem[] = [];
      while (index < lines.length) {
        const match = lines[index].trim().match(/^[-*+]\s+(.*)$/);
        if (!match) {
          break;
        }
        items.push({ text: match[1], children: [] });
        index += 1;
      }
      appendList(doc, fragment, items, false);
      continue;
    }

    const ordered = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (ordered) {
      const items: ListItem[] = [];
      while (index < lines.length) {
        const current = lines[index];
        const match = current.trim().match(/^\d+\.\s+(.*)$/);
        const last = items.at(-1);
        if (match) {
          items.push({ text: match[1], children: [] });
        } else if (last && /^\s{2,}[-*+]\s+/.test(current)) {
          // An indented bullet belongs to the numbered item above it.
          last.children.push(current.trim().replace(/^[-*+]\s+/, ""));
        } else if (last && /^\s{2,}\S/.test(current)) {
          last.text = `${last.text} ${current.trim()}`;
        } else if (!current.trim()) {
          // A blank line ends the list unless another item or an indented
          // continuation follows it.
          let next = index + 1;
          while (next < lines.length && !lines[next].trim()) next += 1;
          if (
            next >= lines.length ||
            !(
              /^\d+\.\s+/.test(lines[next].trim()) ||
              /^\s{2,}\S/.test(lines[next])
            )
          )
            break;
        } else {
          break;
        }
        index += 1;
      }
      appendList(doc, fragment, items, true, Number(ordered[1]));
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
          next === "$$" ||
          Boolean(parseFenceOpener(next)) ||
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
      paragraphLines.join("\n"),
    );
  }

  return fragment;
}

function parseTableCells(row: string): string[] {
  const body = row.slice(1, -1);
  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  let inMath = false;
  for (let index = 0; index < body.length; index++) {
    const character = body[index];
    if (character === "\\" && body[index + 1] === "|") {
      // An escaped pipe is a literal; math keeps it for KaTeX (a norm).
      cell += inMath ? "\\|" : "|";
      index += 1;
      continue;
    }
    if (character === "`" && !inMath) inCode = !inCode;
    else if (
      character === "$" &&
      !inCode &&
      (inMath ||
        (/\S/.test(body[index + 1] ?? "") &&
          body.indexOf("$", index + 1) > index))
    )
      inMath = !inMath;
    if (character === "|" && !inCode && !inMath) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
  }
  cells.push(cell.trim());
  return cells;
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
      setRenderedHTML(th, renderInlineMarkdown(cell), cell);
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);
  }

  const tbody = doc.createElement("tbody");
  const dataRows = hasSeparator ? rows.slice(dataStartIndex) : rows;
  for (const row of dataRows) {
    if (isSeparatorRow(row)) continue;
    const cells = parseTableCells(row);
    const tr = doc.createElement("tr");
    for (const cell of cells) {
      const td = doc.createElement("td");
      setRenderedHTML(td, renderInlineMarkdown(cell), cell);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  fragment.appendChild(table);
}
