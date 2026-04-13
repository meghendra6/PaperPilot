const DEFAULT_SESSION_TITLE_MAX_LENGTH = 80;

function normalizeQuestionTitle(question: string) {
  return question
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[\s"'`“”‘’(\[]+/, "")
    .replace(/[\s"'`“”‘’)\].,!?;:]+$/, "");
}

function formatUtcTimestamp(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `Session ${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

function trimSessionTitle(title: string) {
  if (title.length <= DEFAULT_SESSION_TITLE_MAX_LENGTH) {
    return title;
  }

  return `${title.slice(0, DEFAULT_SESSION_TITLE_MAX_LENGTH - 3)}...`;
}

export function buildSessionTitle(firstUserQuestion: string, now = new Date()) {
  const normalizedQuestion = normalizeQuestionTitle(firstUserQuestion || "");
  if (normalizedQuestion) {
    return trimSessionTitle(normalizedQuestion);
  }

  return formatUtcTimestamp(now);
}
