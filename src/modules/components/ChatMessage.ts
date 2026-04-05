import { sanitizeAssistantText } from "../message/assistantOutput";
import { renderMarkdownFragment } from "./markdownRenderer";

function resolveDocument(node: { ownerDocument?: Document | null }): Document {
  const doc = node.ownerDocument || globalThis.document;
  if (!doc) {
    throw new Error("No document is available to render chat messages.");
  }
  return doc;
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

  messageDiv.replaceChildren(
    renderMarkdownFragment(
      sanitizeAssistantText(text),
      resolveDocument(messageDiv),
    ),
  );
}

export function addMessage(
  container: Element | null,
  text: string,
  sender: "user" | "ai",
) {
  if (!container) return null;

  const doc = resolveDocument(container);
  const messageDiv = doc.createElement("div");
  messageDiv.className = `pp-message pp-message--${sender}`;

  setMessageContent(messageDiv, text, sender);

  if (sender === "ai") {
    const footer = doc.createElement("div");
    footer.className = "pp-message-footer";
    const copyBtn = doc.createElement("button");
    copyBtn.className = "pp-btn pp-btn--ghost pp-message-copy";
    copyBtn.textContent = "Copy";
    let copyResetTimer: ReturnType<typeof setTimeout> | undefined;
    copyBtn.addEventListener("click", () => {
      const sanitized = sanitizeAssistantText(text);
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(sanitized);
      } else {
        const ta = doc.createElement("textarea");
        ta.value = sanitized;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        doc.body.appendChild(ta);
        ta.select();
        doc.execCommand("copy");
        ta.remove();
      }
      copyBtn.textContent = "Copied!";
      if (copyResetTimer !== undefined) clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => {
        copyBtn.textContent = "Copy";
        copyResetTimer = undefined;
      }, 1500);
    });
    footer.appendChild(copyBtn);
    messageDiv.appendChild(footer);
  }

  const wrapperDiv = doc.createElement("div");
  wrapperDiv.className = `pp-message-wrapper pp-message-wrapper--${sender}`;
  wrapperDiv.appendChild(messageDiv);

  container.appendChild(wrapperDiv);
  container.scrollTop = container.scrollHeight;
  return messageDiv;
}
