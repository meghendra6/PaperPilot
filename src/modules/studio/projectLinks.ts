import { relativeAssetPath } from "./draftAssets";

export const LINK_DOCUMENT = /\.(md|markdown|myst|tex|typ)$/i;
interface Link {
  from: number;
  to: number;
  path: string;
  suffix: string;
  syntax: "markdown" | "tex" | "typst";
}

function markdownMask(text: string) {
  let fence: { char: string; length: number } | undefined;
  return text
    .split(/(?<=\n)/)
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence) {
        if (
          marker?.[0] === fence.char &&
          marker.length >= fence.length &&
          /^ {0,3}(?:`+|~+)\s*$/.test(line)
        )
          fence = undefined;
        return " ".repeat(line.length);
      }
      if (marker) {
        fence = { char: marker[0], length: marker.length };
        return " ".repeat(line.length);
      }
      if (/^(?: {4}|\t)/.test(line)) return " ".repeat(line.length);
      return line.replace(/(`+)[^\n]*?\1/g, (value) =>
        " ".repeat(value.length),
      );
    })
    .join("");
}

function resolvePath(document: string, path: string) {
  if (!path || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(path)) return undefined;
  const parts = document.split("/").slice(0, -1);
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

/** Literal local links only; never rewrite arbitrary prose or executable code. */
function links(name: string, text: string): Link[] {
  const result: Link[] = [];
  const add = (from: number, raw: string, syntax: Link["syntax"]) => {
    let path = raw;
    let suffix = "";
    try {
      if (syntax === "markdown") {
        const split = raw.search(/[?#]/);
        if (split >= 0) {
          path = raw.slice(0, split);
          suffix = raw.slice(split);
        }
        path = decodeURIComponent(path);
      } else if (syntax === "typst") path = JSON.parse(`"${raw}"`);
    } catch {
      return;
    }
    const resolved = resolvePath(name, path);
    if (resolved)
      result.push({
        from,
        to: from + raw.length,
        path: resolved,
        suffix,
        syntax,
      });
  };
  if (/\.(md|markdown|myst)$/i.test(name)) {
    // Mask fenced/inline code while preserving offsets into the original text.
    const mask = markdownMask(text);
    for (const match of mask.matchAll(
      /\]\(\s*(?:<([^>\n]+)>|([^\s()]+))(?:\s+"[^"\n]*")?\s*\)/g,
    )) {
      const raw = match[1] ?? match[2];
      add(match.index! + match[0].indexOf(raw), raw, "markdown");
    }
    for (const match of mask.matchAll(
      /^\s*\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|([^\s]+))/gm,
    )) {
      const raw = match[1] ?? match[2];
      add(match.index! + match[0].lastIndexOf(raw), raw, "markdown");
    }
  } else if (/\.tex$/i.test(name)) {
    const mask = text.replace(/(?<!\\)%[^\n]*/g, (value) =>
      " ".repeat(value.length),
    );
    for (const match of mask.matchAll(
      /\\(?:includegraphics|input|include|addbibresource)(?:\[[^\]\n]*\])?\{(?:\\detokenize\{([^{}\n]+)\}|([^{}\\\n]+))\}/g,
    )) {
      const raw = match[1] ?? match[2];
      add(match.index! + match[0].indexOf(raw), raw, "tex");
    }
  } else if (/\.typ$/i.test(name)) {
    const mask = text.replace(/\/\*[\s\S]*?\*\//g, (value) =>
      " ".repeat(value.length),
    );
    for (const match of mask.matchAll(
      /\b(?:image|read|csv|json|bibliography)\s*\(\s*"((?:[^"\\]|\\.)*)"/g,
    ))
      add(match.index! + match[0].indexOf('"') + 1, match[1], "typst");
  }
  return result;
}

export function projectLinkTargets(name: string, text: string) {
  return [...new Set(links(name, text).map((link) => link.path))];
}

export function rewriteProjectLinks(
  text: string,
  oldName: string,
  newName: string,
  oldTarget: string,
  newTarget: string,
) {
  let output = text;
  for (const link of links(oldName, text).reverse()) {
    const target = link.path === oldTarget ? newTarget : link.path;
    if (target === link.path && oldName === newName) continue;
    const relative = relativeAssetPath(newName, target);
    let replacement: string;
    if (link.syntax === "markdown")
      replacement =
        relative
          .split("/")
          .map((part) =>
            encodeURIComponent(part).replace(
              /[!'()*]/g,
              (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
            ),
          )
          .join("/") + link.suffix;
    else if (link.syntax === "typst")
      replacement = JSON.stringify(relative).slice(1, -1);
    else {
      if (/[{}\\%\r\n]/.test(relative))
        throw new Error(
          "This rename would break a literal TeX reference. Choose a name without TeX special characters.",
        );
      replacement = relative;
    }
    output = output.slice(0, link.from) + replacement + output.slice(link.to);
  }
  return output;
}

export function decodeProjectText(base64: string) {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)),
  );
}
