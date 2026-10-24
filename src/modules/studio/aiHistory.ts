import { node } from "./dom";

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt?: string;
  turns: number;
}

function formatDay(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function turnCount(turns: number) {
  return turns === 1 ? "1 question" : `${turns} questions`;
}

/**
 * The conversation list: the open conversation first, then archives by last
 * activity. Choosing an archive resumes it and archives the open one.
 */
export function renderHistory(
  host: HTMLElement,
  current: { title: string; turns: number; updatedAt: string },
  archives: ConversationSummary[],
  resume: (id: string) => void,
  back: () => void,
) {
  host.replaceChildren();
  const list = node("ul", undefined, "history-list");
  list.setAttribute("aria-label", "Conversations");
  const openItem = node("li");
  const open = node("button", undefined, "history-item is-current");
  open.type = "button";
  open.setAttribute("aria-current", "true");
  open.title = "Back to the open conversation";
  open.addEventListener("click", back);
  openItem.append(open);
  open.append(
    node("span", current.title, "history-title"),
    node(
      "span",
      ["Open now", turnCount(current.turns), formatDay(current.updatedAt)]
        .filter(Boolean)
        .join(" · "),
      "history-meta",
    ),
  );
  list.append(openItem);
  for (const archive of archives) {
    const item = node("li");
    const choose = node("button", undefined, "history-item");
    choose.type = "button";
    choose.append(
      node("span", archive.title, "history-title"),
      node(
        "span",
        [
          turnCount(archive.turns),
          formatDay(archive.updatedAt || archive.createdAt),
        ]
          .filter(Boolean)
          .join(" · "),
        "history-meta",
      ),
    );
    choose.title = `Resume “${archive.title}”`;
    choose.addEventListener("click", () => resume(archive.id));
    item.append(choose);
    list.append(item);
  }
  host.append(
    node("h3", "Conversations", "history-heading"),
    node(
      "p",
      archives.length
        ? "Resuming a conversation archives the open one. Nothing is deleted, and document revisions still guard every proposal."
        : "Earlier conversations appear here after you start a new one.",
      "history-hint",
    ),
    list,
  );
  (list.querySelectorAll("button")[1] ?? open).focus();
}
