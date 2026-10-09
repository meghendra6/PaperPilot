import { sanitizeAssistantText } from "../message/assistantOutput";
import {
  notifyChatTranscriptAppend,
  prepareChatTranscriptAppend,
  isChatFollowingLatest,
  notifyChatTranscriptUpdate,
} from "../ui/chatTranscriptWindow";
import { renderMarkdownFragment } from "./markdownRenderer";
import type { MessageRecord } from "../message/types";
import type { ChatCitation } from "../message/chatTypes";
import { chatCitationLabel, openChatCitation } from "../message/chatCitations";
import { openPublicURL } from "../message/publicLinks";
import { redactAbsolutePaths } from "../workspace/redaction";

const messageFooters = new WeakMap<HTMLElement, HTMLElement>();
const messageCopyText = new WeakMap<HTMLElement, string>();
const messageRecords = new WeakMap<HTMLElement, MessageRecord>();
const messageMenus = new WeakMap<HTMLElement, HTMLElement>();
const messageActions = new WeakMap<HTMLElement, ChatMessageActions>();
const citationNotices = new WeakMap<HTMLElement, HTMLElement>();

export interface ChatMessageActions {
  onEdit?: (message: MessageRecord) => unknown | Promise<unknown>;
  onFork?: (message: MessageRecord) => unknown | Promise<unknown>;
  onSaveNote?: (message: MessageRecord) => unknown | Promise<unknown>;
  onSendToProject?: (message: MessageRecord) => unknown | Promise<unknown>;
  onPin?: (message: MessageRecord) => unknown | Promise<unknown>;
  onCitation?: (
    citation: ChatCitation,
    message: MessageRecord,
  ) => unknown | Promise<unknown>;
}

export interface ChatMessageOptions {
  message?: MessageRecord;
  actions?: ChatMessageActions;
  onCitation?: ChatMessageActions["onCitation"];
  sourceCheck?: Promise<void>;
}

function resolveDocument(node: { ownerDocument?: Document | null }): Document {
  const doc = node.ownerDocument || globalThis.document;
  if (!doc) {
    throw new Error("No document is available to render chat messages.");
  }
  return doc;
}

interface ClipboardHelperComponents {
  classes: Record<
    string,
    {
      getService(interfaceType: unknown): {
        copyString(text: string): void;
      };
    }
  >;
  interfaces: {
    nsIClipboardHelper: unknown;
  };
}

function resolveClipboardComponents(doc: Document) {
  const ownerComponents = (
    doc.defaultView as
      | (Window & { Components?: ClipboardHelperComponents })
      | null
  )?.Components;
  return (
    ownerComponents ||
    (
      globalThis as typeof globalThis & {
        Components?: ClipboardHelperComponents;
      }
    ).Components
  );
}

export async function copyTextToClipboard(text: string, doc: Document) {
  const components = resolveClipboardComponents(doc);
  const clipboardFactory =
    components?.classes["@mozilla.org/widget/clipboardhelper;1"];
  if (clipboardFactory && components?.interfaces.nsIClipboardHelper) {
    clipboardFactory
      .getService(components.interfaces.nsIClipboardHelper)
      .copyString(text);
    return;
  }

  const clipboard = (doc.defaultView?.navigator || globalThis.navigator)
    ?.clipboard;
  if (clipboard?.writeText) {
    await clipboard.writeText(text);
    return;
  }

  const mount = doc.body || doc.documentElement;
  if (!mount) throw new Error("Clipboard access is unavailable.");
  const ta = doc.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  mount.appendChild(ta);
  let copied = false;
  try {
    ta.select();
    copied = doc.execCommand("copy");
  } finally {
    ta.remove();
  }
  if (!copied) throw new Error("Clipboard copy was rejected.");
}

export interface CitationChipState {
  /** The passage cannot be opened. The chip stays focusable and explains. */
  unavailable: boolean;
  /** Accessible name. */
  label: string;
  /** Tooltip text, which is also the accessible description. */
  description: string;
}

const UNAVAILABLE_CITATION_REASONS: Record<
  Exclude<ChatCitation["status"], "verified">,
  string
> = {
  unverified:
    "The quote was not matched in the current PDF, so it cannot be opened.",
  "not-found":
    "The quote was not matched in the current PDF, so it cannot be opened.",
  stale: "The PDF changed after this answer, so the passage cannot be opened.",
  "source-unavailable":
    "The PDF could not be read, so the passage cannot be opened.",
};

export function describeCitationChip(
  id: string,
  citation: ChatCitation | undefined,
  options: { checking?: boolean; failure?: string } = {},
): CitationChipState {
  if (options.checking)
    return {
      unavailable: true,
      label: `Citation ${id}: Checking source`,
      description: "Checking the original PDF source…",
    };
  if (!citation)
    return {
      unavailable: true,
      label: `Citation ${id}: Location unverified`,
      description:
        "Location unverified: no source passage was recorded, so it cannot be opened.",
    };
  const quote = citation.quote ? ` Quote: ${citation.quote}` : "";
  if (options.failure)
    return {
      unavailable: true,
      label: `Citation ${id}: Location unverified`,
      description: `Location unverified: ${options.failure}${quote}`,
    };
  const status = chatCitationLabel(citation);
  if (citation.status === "verified")
    return {
      unavailable: false,
      label: `Citation ${id}: Open the matched PDF passage`,
      description: `${status}: ${citation.quote}`,
    };
  return {
    unavailable: true,
    label: `Citation ${id}: ${status}`,
    description: `${status}: ${UNAVAILABLE_CITATION_REASONS[citation.status]}${quote}`,
  };
}

function applyCitationChipState(button: HTMLElement, state: CitationChipState) {
  button.classList.toggle("pp-citation--unavailable", state.unavailable);
  if (state.unavailable) button.setAttribute("aria-disabled", "true");
  else button.removeAttribute("aria-disabled");
  button.title = state.description;
  button.setAttribute("aria-label", state.label);
}

/**
 * Inline citation chip. The `[id]` text never changes mid-sentence. An
 * unavailable chip keeps keyboard focus and explains instead of opening.
 */
export function createCitationChip(params: {
  doc: Document;
  id: string;
  citation?: ChatCitation;
  open(citation: ChatCitation): unknown;
  explain(text: string): void;
}): HTMLButtonElement {
  const button = params.doc.createElement("button");
  button.type = "button";
  button.className = "pp-btn pp-citation";
  button.setAttribute("data-pp-citation-id", params.id);
  button.textContent = `[${params.id}]`;
  applyCitationChipState(
    button,
    describeCitationChip(params.id, params.citation),
  );
  button.addEventListener("click", async () => {
    const citation = params.citation;
    if (!citation || button.getAttribute("aria-disabled") === "true") {
      params.explain(button.title);
      return;
    }
    try {
      await params.open(citation);
    } catch (error) {
      const failure = redactAbsolutePaths(
        error instanceof Error
          ? error.message
          : "The PDF source could not be opened.",
      );
      applyCitationChipState(
        button,
        describeCitationChip(params.id, citation, { failure }),
      );
      params.explain(button.title);
    }
  });
  return button;
}

/** Shows why a citation cannot open in a status line below the answer. */
function showCitationNotice(messageDiv: HTMLElement, text: string) {
  let notice = citationNotices.get(messageDiv);
  if (!notice) {
    notice = messageDiv.ownerDocument.createElement("div");
    notice.className = "pp-citation-notice";
    notice.setAttribute("role", "status");
    citationNotices.set(messageDiv, notice);
  }
  const footer = messageFooters.get(messageDiv);
  if (footer && notice.parentElement !== footer) footer.prepend(notice);
  else if (!footer && notice.parentElement !== messageDiv)
    messageDiv.appendChild(notice);
  notice.textContent = text;
}

function decorateCitations(messageDiv: HTMLElement) {
  const message = messageRecords.get(messageDiv);
  const doc = messageDiv.ownerDocument;
  if (!message || !doc.createTreeWalker) return;
  const citations = new Map(
    (message.citations ?? []).map((citation) => [citation.id, citation]),
  );
  const walker = doc.createTreeWalker(messageDiv, 4);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (
      !node.nodeValue?.includes("[[cite:") ||
      node.parentElement?.closest("pre,code,math,a,.pp-message-footer")
    )
      continue;
    const parts = node.nodeValue.split(/(\[\[cite:[A-Za-z0-9_-]{1,64}\]\])/g);
    const fragment = doc.createDocumentFragment();
    for (const part of parts) {
      const id = part.match(/^\[\[cite:([A-Za-z0-9_-]{1,64})\]\]$/)?.[1];
      if (!id) {
        fragment.appendChild(doc.createTextNode(part));
        continue;
      }
      fragment.appendChild(
        createCitationChip({
          doc,
          id,
          citation: citations.get(id),
          open: async (citation) => {
            const action = messageActions.get(messageDiv)?.onCitation;
            if (action) await action(citation, message);
            else if (message.requestContext)
              await openChatCitation(citation, message.requestContext);
          },
          explain: (text) => showCitationNotice(messageDiv, text),
        }),
      );
    }
    node.replaceWith(fragment);
  }
}

export function bindMessageActions(
  messageDiv: HTMLElement,
  message: MessageRecord,
  actions: ChatMessageActions = {},
) {
  messageRecords.set(messageDiv, message);
  messageActions.set(messageDiv, actions);
  messageDiv.setAttribute?.("data-message-id", message.id);
  messageDiv.parentElement?.setAttribute?.("data-message-id", message.id);
  let footer = messageFooters.get(messageDiv);
  if (!footer) {
    footer = messageDiv.ownerDocument.createElement("div");
    footer.className = "pp-message-footer";
    messageFooters.set(messageDiv, footer);
    messageDiv.appendChild(footer);
  }
  messageMenus.get(messageDiv)?.remove();
  const menu = messageDiv.ownerDocument.createElement("details");
  menu.className = "pp-message-actions";
  const summary = messageDiv.ownerDocument.createElement("summary");
  summary.textContent = "More";
  menu.appendChild(summary);
  const actionStatus = messageDiv.ownerDocument.createElement("div");
  actionStatus.className = "pp-message-action-status";
  actionStatus.setAttribute("role", "status");
  const entries: Array<[string, keyof ChatMessageActions]> = [
    ["Edit question", "onEdit"],
    ["New conversation from here", "onFork"],
    ["Save to note", "onSaveNote"],
    ["Send comparison question", "onSendToProject"],
    ["Pin / unpin", "onPin"],
  ];
  for (const [label, key] of entries) {
    const action = actions[key];
    if (
      !action ||
      key === "onCitation" ||
      (key === "onFork" &&
        (message.role !== "assistant" || message.status !== "done"))
    )
      continue;
    const button = messageDiv.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "pp-btn pp-btn--ghost";
    button.textContent = label;
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      button.disabled = true;
      actionStatus.textContent = "";
      try {
        await (action as (record: MessageRecord) => unknown)(message);
        menu.removeAttribute("open");
        summary.focus();
      } catch (error) {
        button.title = redactAbsolutePaths(
          error instanceof Error
            ? error.message
            : "The action could not be completed.",
        );
        actionStatus.textContent = button.title;
      } finally {
        button.disabled = false;
      }
    });
    menu.appendChild(button);
  }
  if (menu.childElementCount > 1) {
    menu.appendChild(actionStatus);
    footer.appendChild(menu);
  }
  messageMenus.set(messageDiv, menu);
  decorateCitations(messageDiv);
}

export function setMessageContent(
  messageDiv: HTMLElement,
  text: string,
  sender: "user" | "ai",
) {
  if (sender === "user") {
    messageDiv.textContent = text;
    return;
  }

  const sanitized = sanitizeAssistantText(text);
  if (messageCopyText.get(messageDiv) === sanitized) return;
  const container = messageDiv.parentElement?.parentElement;
  const follow =
    container?.id === "chat-messages" && isChatFollowingLatest(container);
  const footer = messageFooters.get(messageDiv);
  messageDiv.replaceChildren(
    renderMarkdownFragment(sanitized, resolveDocument(messageDiv)),
  );
  messageCopyText.set(messageDiv, sanitized);
  if (footer) messageDiv.appendChild(footer);
  decorateCitations(messageDiv);
  for (const node of Array.from(
    messageDiv.querySelectorAll?.("a.pp-public-source") ?? [],
  )) {
    const anchor = node as HTMLAnchorElement;
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      const url = anchor.getAttribute("href");
      if (url) openPublicURL(url, messageDiv.ownerDocument);
    });
  }
  if (container?.id === "chat-messages")
    notifyChatTranscriptUpdate(container, Boolean(follow));
}

export function addMessage(
  container: Element | null,
  text: string,
  sender: "user" | "ai",
  options: ChatMessageOptions = {},
) {
  if (!container) return null;

  prepareChatTranscriptAppend(container);
  const doc = resolveDocument(container);
  const messageDiv = doc.createElement("div");
  messageDiv.className = `pp-message pp-message--${sender}`;
  if (options.message) messageRecords.set(messageDiv, options.message);
  if (options.actions || options.onCitation)
    messageActions.set(messageDiv, {
      ...options.actions,
      ...(options.onCitation ? { onCitation: options.onCitation } : {}),
    });

  setMessageContent(messageDiv, text, sender);

  if (sender === "ai") {
    const footer = doc.createElement("div");
    footer.className = "pp-message-footer";
    const copyBtn = doc.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "pp-btn pp-btn--ghost pp-message-copy";
    copyBtn.textContent = "Copy";
    let copyResetTimer: ReturnType<typeof setTimeout> | undefined;
    copyBtn.addEventListener("click", async () => {
      if (copyBtn.disabled) return;
      copyBtn.disabled = true;
      if (copyResetTimer !== undefined) {
        clearTimeout(copyResetTimer);
        copyResetTimer = undefined;
      }
      try {
        await copyTextToClipboard(
          messageCopyText.get(messageDiv) || sanitizeAssistantText(text),
          doc,
        );
        copyBtn.textContent = "Copied!";
      } catch {
        copyBtn.textContent = "Copy failed";
      }
      copyBtn.disabled = false;
      copyResetTimer = setTimeout(() => {
        copyBtn.textContent = "Copy";
        copyResetTimer = undefined;
      }, 1500);
    });
    messageFooters.set(messageDiv, footer);
    footer.appendChild(copyBtn);
    messageDiv.appendChild(footer);
  }

  const wrapperDiv = doc.createElement("div");
  wrapperDiv.className = `pp-message-wrapper pp-message-wrapper--${sender}`;
  wrapperDiv.appendChild(messageDiv);

  container.appendChild(wrapperDiv);
  notifyChatTranscriptAppend(container, wrapperDiv);
  if (container.id !== "chat-messages")
    container.scrollTop = container.scrollHeight;
  if (options.message)
    bindMessageActions(
      messageDiv,
      options.message,
      messageActions.get(messageDiv),
    );
  if (options.sourceCheck && options.message) {
    const buttons = Array.from(
      messageDiv.querySelectorAll("[data-pp-citation-id]"),
    ) as HTMLButtonElement[];
    const describe = (button: HTMLElement, checking = false) => {
      const id = button.getAttribute("data-pp-citation-id") ?? "";
      const citation = options.message?.citations?.find(
        (entry) => entry.id === id,
      );
      applyCitationChipState(
        button,
        describeCitationChip(id, citation, { checking }),
      );
    };
    for (const button of buttons) describe(button, true);
    const update = () => {
      for (const button of buttons) describe(button);
    };
    void options.sourceCheck.then(update, (error) => {
      for (const citation of options.message?.citations ?? []) {
        if (citation.status === "verified")
          citation.status =
            error instanceof Error && error.message.includes("changed")
              ? "stale"
              : "source-unavailable";
      }
      update();
    });
  }
  return messageDiv;
}
