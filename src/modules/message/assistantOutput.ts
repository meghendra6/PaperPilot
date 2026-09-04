const WORKSPACE_FILE_LABELS: Array<[RegExp, string]> = [
  [/\bpaper\.md\b/gi, "the paper"],
  [/\bpaper\.json\b/gi, "the paper structure"],
  [/\bpaper\.txt\b/gi, "the paper"],
  [/\bCONTEXT_INDEX\.md\b/gi, "the workspace context"],
  [/\bselection\.json\b/gi, "the current selection"],
  [/\brecent-turns\.json\b/gi, "our earlier chat context"],
  [/\bannotations\.json\b/gi, "the annotations"],
  [/\bmetadata\.json\b/gi, "the paper metadata"],
  [/\bprompt\.txt\b/gi, "the prompt"],
  [/\bgemini-prompt\.txt\b/gi, "the prompt"],
];

function stripSourceLinks(text: string) {
  return text
    .replace(/\[([^\]]+)\]\(((?:https?|file):\/\/[^\s)]+)\)/gi, "$1")
    .replace(/<(?:https?|file):\/\/[^>]+>/gi, "")
    .replace(/(?:https?|file):\/\/\S+/gi, "");
}

function sanitizeProseLine(line: string) {
  const inlineCode: string[] = [];
  const protectedLine = line.replace(/(`+)(.+?)\1/g, (code) => {
    const token = `@@PAPERPILOT_INLINE_CODE_${inlineCode.length}@@`;
    inlineCode.push(code);
    return token;
  });
  let sanitized = stripSourceLinks(protectedLine);
  for (const [pattern, replacement] of WORKSPACE_FILE_LABELS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized.replace(
    /@@PAPERPILOT_INLINE_CODE_(\d+)@@/g,
    (_match, index: string) => inlineCode[Number(index)] ?? "",
  );
}

export function sanitizeAssistantText(text: string) {
  let fence: { marker: string; length: number } | undefined;
  return text
    .split(/\r?\n/)
    .map((line) => {
      const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        if (
          fenceMatch &&
          fenceMatch[1][0] === fence.marker &&
          fenceMatch[1].length >= fence.length
        ) {
          fence = undefined;
        }
        return line;
      }
      if (fenceMatch) {
        fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
        return line;
      }
      if (
        /^(?:sources?|source links?|references?)\s*:\s*$/i.test(line.trim())
      ) {
        return undefined;
      }
      return sanitizeProseLine(line);
    })
    .filter((line): line is string => line !== undefined)
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
