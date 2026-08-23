import { sanitizeAssistantText } from "../message/assistantOutput";
import {
  notifyChatTranscriptAppend,
  prepareChatTranscriptAppend,
} from "../ui/chatTranscriptWindow";
import { renderMarkdownFragment } from "./markdownRenderer";

const messageFooters = new WeakMap<HTMLElement, HTMLElement>();
const messageCopyText = new WeakMap<HTMLElement, string>();

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

function scrollUpdatedMessageToBottom(messageDiv: HTMLElement) {
  const container = messageDiv.parentElement?.parentElement;
  if (container?.id !== "chat-messages") return;
  const scrollToBottom = () => {
    container.scrollTop = container.scrollHeight;
  };
  scrollToBottom();

  const view = messageDiv.ownerDocument.defaultView;
  if (!view?.requestAnimationFrame) return;
  view.requestAnimationFrame(() => {
    scrollToBottom();
    view.requestAnimationFrame(scrollToBottom);
  });
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
  const footer = messageFooters.get(messageDiv);
  messageDiv.replaceChildren(
    renderMarkdownFragment(sanitized, resolveDocument(messageDiv)),
  );
  messageCopyText.set(messageDiv, sanitized);
  if (footer) messageDiv.appendChild(footer);
  scrollUpdatedMessageToBottom(messageDiv);
}

export function addMessage(
  container: Element | null,
  text: string,
  sender: "user" | "ai",
) {
  if (!container) return null;

  prepareChatTranscriptAppend(container);
  const doc = resolveDocument(container);
  const messageDiv = doc.createElement("div");
  messageDiv.className = `pp-message pp-message--${sender}`;

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
  container.scrollTop = container.scrollHeight;
  return messageDiv;
}
