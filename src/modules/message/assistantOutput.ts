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

export function sanitizeAssistantText(text: string) {
  let sanitized = stripSourceLinks(text);

  for (const [pattern, replacement] of WORKSPACE_FILE_LABELS) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  return sanitized
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/^(?:sources?|source links?|references?)\s*:\s*$/i.test(line.trim()),
    )
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
