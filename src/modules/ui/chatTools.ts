import type { ChatResponseLength } from "../message/chatTypes";
import type { ReaderActionName } from "../readerActionPrompt";

export interface ChatSearchResult {
  sessionId: string;
  title: string;
  messageId: string;
  text: string;
  role: string;
}
export function createChatTools(params: {
  doc: Document;
  input: HTMLTextAreaElement;
  getLength(): ChatResponseLength;
  onLength(value: ChatResponseLength): void;
  onAction(action: ReaderActionName): void;
  onSearch(
    query: string,
    scope: "current" | "saved",
  ): Promise<ChatSearchResult[]>;
  onResult(result: ChatSearchResult): Promise<void>;
  onSearchClose(): boolean | void;
  onSummary(): Promise<void>;
}) {
  const doc = params.doc;
  const root = doc.createElement("div");
  root.className = "pp-chat-tools";
  const bar = doc.createElement("div");
  bar.className = "pp-chat-tools__bar";
  const button = (label: string, action: () => void) => {
    const el = doc.createElement("button");
    el.type = "button";
    el.className = "pp-btn pp-btn--ghost";
    el.textContent = label;
    el.addEventListener("click", action);
    return el;
  };
  const commands = doc.createElement("div");
  commands.hidden = true;
  commands.className = "pp-chat-commands";
  commands.setAttribute("role", "group");
  commands.setAttribute("aria-label", "Paper actions");
  for (const action of [
    "explain",
    "summarize",
    "translate",
    "critique",
  ] as const)
    commands.append(
      button(action[0].toUpperCase() + action.slice(1), () => {
        commands.hidden = true;
        params.onAction(action);
      }),
    );
  const actionButton = button("/ Actions", () => {
    commands.hidden = !commands.hidden;
    actionButton.setAttribute("aria-expanded", String(!commands.hidden));
    if (!commands.hidden) commands.querySelector("button")?.focus();
  });
  actionButton.setAttribute("aria-expanded", "false");
  const length = doc.createElement("select");
  length.className = "pp-chat-length";
  length.setAttribute("aria-label", "Response length");
  for (const value of ["short", "default", "detailed"] as const) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent =
      value === "default"
        ? "Default length"
        : value === "short"
          ? "Short answer"
          : "Detailed answer";
    length.append(option);
  }
  length.value = params.getLength();
  length.addEventListener("change", () =>
    params.onLength(length.value as ChatResponseLength),
  );
  const search = doc.createElement("div");
  search.hidden = true;
  search.className = "pp-chat-search";
  const query = doc.createElement("input");
  query.type = "search";
  query.placeholder = "Search this paper’s conversations";
  query.setAttribute("aria-label", "Search messages");
  const scope = doc.createElement("select");
  scope.setAttribute("aria-label", "Search scope");
  for (const [value, label] of [
    ["current", "This conversation"],
    ["saved", "Saved conversations"],
  ]) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = label;
    scope.append(option);
  }
  const results = doc.createElement("div");
  results.className = "pp-chat-search__results";
  results.setAttribute("aria-live", "polite");
  let searchRevision = 0;
  const runSearch = async () => {
    const revision = ++searchRevision;
    const found = query.value.trim()
      ? await params.onSearch(query.value, scope.value as "current" | "saved")
      : [];
    if (revision !== searchRevision || search.hidden) return;
    results.replaceChildren();
    if (!found.length) {
      results.textContent = query.value.trim()
        ? "No matching messages."
        : "Search includes messages outside the visible history.";
      return;
    }
    for (const result of found.slice(0, 100))
      results.append(
        button(
          `${result.title} · ${result.role}: ${result.text.slice(0, 160)}`,
          () => {
            void params.onResult(result).catch((error) => {
              results.textContent = String(error);
            });
          },
        ),
      );
    if (found.length > 100)
      results.append(
        doc.createTextNode(
          `${found.length} results. Refine your search to show fewer.`,
        ),
      );
  };
  const onSearchInput = () => {
    void runSearch().catch((error) => {
      results.textContent = String(error);
    });
  };
  query.addEventListener("input", onSearchInput);
  scope.addEventListener("change", onSearchInput);
  const closeSearch = () => {
    if (params.onSearchClose() === false) return;
    search.hidden = true;
    searchRevision++;
    params.input.focus();
  };
  search.append(
    query,
    scope,
    button("Return to reading", closeSearch),
    results,
  );
  search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeSearch();
    }
  });
  const summary = button("Summarize chat", () => {
    summary.disabled = true;
    void params
      .onSummary()
      .catch((error) => {
        status.textContent = String(error);
      })
      .finally(() => {
        summary.disabled = false;
      });
  });
  bar.append(
    actionButton,
    length,
    button("Search", () => {
      if (search.hidden) {
        search.hidden = false;
        query.focus();
        onSearchInput();
      } else closeSearch();
    }),
    summary,
  );
  const status = doc.createElement("div");
  status.className = "pp-chat-context-status";
  status.setAttribute("role", "status");
  root.append(bar, commands, search, status);
  const onInput = () => {
    commands.hidden = !/^\/[a-z]*$/i.test(params.input.value);
    actionButton.setAttribute("aria-expanded", String(!commands.hidden));
  };
  const onKey = (event: KeyboardEvent) => {
    if (!commands.hidden && event.key === "ArrowDown") {
      event.preventDefault();
      commands.querySelector("button")?.focus();
    }
    if (event.key === "Escape") commands.hidden = true;
  };
  params.input.addEventListener("input", onInput);
  params.input.addEventListener("keydown", onKey);
  return {
    root,
    setStatus(text: string) {
      status.textContent = text;
    },
    refresh() {
      length.value = params.getLength();
    },
    dispose() {
      searchRevision++;
      params.input.removeEventListener("input", onInput);
      params.input.removeEventListener("keydown", onKey);
    },
  };
}

/** Inline review surface. Writes happen only through its explicit final button. */
export function showChatReviewPanel(params: {
  mount: HTMLElement;
  title: string;
  body: string;
  fields?: HTMLElement[];
  confirmLabel: string;
  onConfirm(): Promise<string | void>;
}) {
  params.mount.querySelector(".pp-chat-review")?.remove();
  const doc = params.mount.ownerDocument;
  const panel = doc.createElement("section");
  panel.className = "pp-chat-review";
  panel.setAttribute("aria-label", params.title);
  const title = doc.createElement("strong");
  title.textContent = params.title;
  const body = doc.createElement("div");
  body.className = "pp-chat-review__body";
  body.textContent = params.body;
  const status = doc.createElement("div");
  status.setAttribute("role", "status");
  const confirm = doc.createElement("button");
  confirm.type = "button";
  confirm.className = "pp-btn pp-btn--primary";
  confirm.textContent = params.confirmLabel;
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "pp-btn pp-btn--ghost";
  cancel.textContent = "Close";
  cancel.addEventListener("click", () => panel.remove());
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    try {
      status.textContent = (await params.onConfirm()) || "Saved.";
    } catch (error) {
      status.textContent = String(error);
      confirm.disabled = false;
    }
  });
  panel.append(title, body, ...(params.fields ?? []), confirm, cancel, status);
  params.mount.append(panel);
  confirm.focus();
  return panel;
}
