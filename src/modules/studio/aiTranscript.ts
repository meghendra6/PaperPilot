import { node } from "./dom";
import { renderMarkdown } from "./sourceEditor";
import {
  providerLabel,
  type StudioChange,
  type StudioConversation,
  type StudioTurn,
} from "./aiContracts";
import type { StudioDocument } from "./contracts";

const CHANGE_KINDS: Record<StudioChange["kind"], string> = {
  replace: "Edit",
  append: "Append",
  draft: "Paper draft",
  create: "New file",
  rename: "Rename",
  archive: "Archive",
};
const DECISIONS: Record<StudioChange["decision"], string> = {
  pending: "Needs review",
  applied: "Applied",
  rejected: "Rejected",
};
const TURN_STATES: Partial<Record<StudioTurn["status"], string>> = {
  running: "Running",
  failed: "Failed",
  canceled: "Stopped",
};
/** Questions longer than this start collapsed, such as draft requests. */
const LONG_QUESTION = 600;

export interface TranscriptActions {
  documents(): StudioDocument[];
  decide(
    change: StudioChange,
    action: "apply" | "reject",
    editedAfter?: string,
  ): void;
}

export function formatTime(value: string, withDate = true) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    ...(withDate ? { month: "short", day: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** One line per captured file, marked when the file changed since. */
function contextState(
  captured: StudioTurn["context"],
  documents: StudioDocument[],
) {
  return captured.map((doc) => {
    const current = documents.find((entry) => entry.id === doc.id);
    const state = !current
      ? "unavailable now"
      : current.archived
        ? "archived now"
        : current.revision !== doc.revision
          ? `now v${current.revision}`
          : "";
    return { name: doc.name, revision: doc.revision, state };
  });
}

function questionBlock(question: string) {
  const bubble = node("div", undefined, "ai-message from-user");
  const text = node("p", question, "ai-question");
  bubble.append(text);
  if (question.length > LONG_QUESTION) {
    text.classList.add("is-clamped");
    const toggle = node("button", "Show full request", "link-button");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => {
      const open = text.classList.toggle("is-clamped") === false;
      toggle.textContent = open ? "Show less" : "Show full request";
      toggle.setAttribute("aria-expanded", String(open));
    });
    bubble.append(toggle);
  }
  return bubble;
}

function changeCard(
  change: StudioChange,
  turn: StudioTurn,
  actions: TranscriptActions,
) {
  const card = node("details", undefined, "ai-change");
  card.dataset.decision = change.decision;
  card.dataset.changeId = change.id;
  card.open = change.decision === "pending";
  const summary = node("summary");
  const target =
    change.name ||
    turn.context.find((doc) => doc.id === change.documentID)?.name ||
    "document";
  summary.append(
    node("span", CHANGE_KINDS[change.kind] ?? change.kind, "change-kind"),
    node("span", target, "change-target"),
    node("span", DECISIONS[change.decision], "change-decision"),
  );
  card.append(summary);
  if (change.reason) card.append(node("p", change.reason, "change-reason"));
  if (change.before) {
    card.append(
      node("span", "Current text", "diff-label"),
      node("pre", change.before, "diff-before"),
    );
  }
  if (change.kind === "draft")
    card.append(
      node(
        "p",
        "Appends a paper draft with document heading styles. Existing content is preserved. Verify evidence and references before submission.",
        "change-note",
      ),
    );
  const editable =
    change.decision === "pending" &&
    ["replace", "append", "draft", "create"].includes(change.kind);
  let revised: HTMLTextAreaElement | undefined;
  if (editable) {
    revised = node("textarea", undefined, "diff-after");
    revised.setAttribute("aria-label", "Reviewed replacement text");
    revised.value = change.after;
    revised.maxLength = 1_000_000;
    revised.rows = Math.min(12, Math.max(3, change.after.split("\n").length));
    card.append(
      node(
        "span",
        change.kind === "draft"
          ? "Proposed draft · editable. Use # title, ## section, ### subsection and plain paragraphs."
          : "Proposed text · edit before applying",
        "diff-label",
      ),
      revised,
    );
  } else if (change.after)
    card.append(
      node("span", "Proposed text", "diff-label"),
      node("pre", change.after, "diff-after"),
    );
  if (change.proposedAfter !== undefined) {
    const original = node("details", undefined, "change-original");
    original.append(
      node("summary", "Original AI wording"),
      node("pre", change.proposedAfter),
    );
    card.append(original);
  }
  if (change.decision === "pending") {
    const buttons = node("div", undefined, "change-actions");
    const reject = node("button", "Reject");
    reject.type = "button";
    reject.addEventListener("click", () => actions.decide(change, "reject"));
    const apply = node("button", "Apply change", "primary");
    apply.type = "button";
    apply.addEventListener("click", () =>
      actions.decide(change, "apply", editable ? revised?.value : undefined),
    );
    buttons.append(reject, apply);
    card.append(buttons);
  }
  return card;
}

/**
 * Renders a conversation. The returned function refreshes the captured
 * context lines after documents change, without rebuilding review fields.
 */
export function renderTranscript(
  host: HTMLElement,
  conversation: StudioConversation,
  actions: TranscriptActions,
) {
  host.replaceChildren();
  const contextLines: Array<{
    element: HTMLElement;
    captured: StudioTurn["context"];
  }> = [];
  if (!conversation.turns.length) {
    const empty = node("div", undefined, "assistant-empty");
    empty.append(
      node("strong", "Ask about this project"),
      node(
        "p",
        "Questions use the context files you choose below. Requested edits arrive as proposals. You review each one before it changes a file.",
      ),
    );
    host.append(empty);
  }
  for (const turn of conversation.turns) {
    const article = node("article", undefined, "ai-turn");
    article.dataset.status = turn.status;
    article.append(questionBlock(turn.question));
    const answer = node("div", undefined, "ai-message from-assistant");
    const meta = node("div", undefined, "ai-meta");
    meta.append(
      node("span", providerLabel(turn.provider), "ai-provider"),
      node("span", turn.model),
      node("time", formatTime(turn.createdAt)),
    );
    const state = TURN_STATES[turn.status];
    if (state) meta.append(node("span", state, "ai-state"));
    answer.append(meta);
    if (turn.context.length) {
      const element = node("ul", undefined, "ai-context-used");
      element.setAttribute("aria-label", "Context files");
      contextLines.push({ element, captured: turn.context });
      answer.append(element);
    }
    if (turn.reply) {
      const reply = node("div", undefined, "ai-reply");
      renderMarkdown(reply, turn.reply);
      answer.append(reply);
    }
    if (turn.error) answer.append(node("p", turn.error, "ai-error"));
    for (const change of turn.changes)
      answer.append(changeCard(change, turn, actions));
    article.append(answer);
    host.append(article);
  }
  const refresh = () => {
    const documents = actions.documents();
    for (const { element, captured } of contextLines)
      element.replaceChildren(
        ...contextState(captured, documents).map((doc) => {
          const item = node("li", `${doc.name} · v${doc.revision}`);
          if (doc.state) {
            item.append(node("em", ` · ${doc.state}`));
            item.classList.add("is-stale");
          }
          return item;
        }),
      );
  };
  refresh();
  host.scrollTop = host.scrollHeight;
  return refresh;
}

/** A placeholder turn shown while the provider runs. */
export function pendingTurn(question: string, engine: string) {
  const article = node("article", undefined, "ai-turn is-pending");
  const answer = node("div", undefined, "ai-message from-assistant");
  const meta = node("div", undefined, "ai-meta");
  const elapsed = node("span", "0:00", "ai-elapsed");
  meta.append(node("span", engine, "ai-provider"), elapsed);
  const working = node("p", undefined, "ai-working");
  working.append(
    node("span", undefined, "ai-dots"),
    node("span", "Reading the context files and preparing a reply…"),
  );
  answer.append(meta, working);
  article.append(questionBlock(question), answer);
  const started = Date.now();
  const timer = setInterval(() => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    elapsed.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }, 1000);
  return { element: article, stop: () => clearInterval(timer) };
}
