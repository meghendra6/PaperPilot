import type { ChatResponseLength } from "../message/chatTypes";
import type { ReaderActionName } from "../readerActionPrompt";

export const SLASH_COMMANDS = [
  "explain",
  "summarize",
  "translate",
  "critique",
] as const satisfies readonly ReaderActionName[];
export type SlashCommand = (typeof SLASH_COMMANDS)[number];

/** Returns the typed word of a bare `/word` draft, or undefined otherwise. */
export function parseSlashCommandInput(value: string): string | undefined {
  const match = /^\/([a-z]*)$/i.exec(value);
  return match ? match[1].toLowerCase() : undefined;
}

export function filterSlashCommands(
  typed: string,
  commands: readonly SlashCommand[] = SLASH_COMMANDS,
): SlashCommand[] {
  const prefix = typed.toLowerCase();
  return commands.filter((command) => command.startsWith(prefix));
}

export type SlashCommandSubmission =
  | { kind: "not_command" }
  | { kind: "pick"; command: SlashCommand }
  | { kind: "unknown"; typed: string };

/**
 * A bare `/word` draft is never sent as a question. It picks the highlighted
 * (first) matching command, or reports that no command matches.
 */
export function resolveSlashCommandSubmission(
  value: string,
): SlashCommandSubmission {
  const typed = parseSlashCommandInput(value);
  if (typed === undefined) return { kind: "not_command" };
  const [command] = filterSlashCommands(typed);
  return command ? { kind: "pick", command } : { kind: "unknown", typed };
}

export function formatUnknownSlashCommand(typed: string): string {
  const available = SLASH_COMMANDS.map((command) => `/${command}`).join(", ");
  return `Unknown command /${typed}. Available commands: ${available}.`;
}

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
  onSearchClose(): boolean | void | Promise<boolean | void>;
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
  const setCommandsOpen = (open: boolean) => {
    commands.hidden = !open;
    actionButton.setAttribute("aria-expanded", String(open));
  };
  const commandButtons = SLASH_COMMANDS.map((action) => {
    const el = button(action[0].toUpperCase() + action.slice(1), () => {
      setCommandsOpen(false);
      params.onAction(action);
    });
    el.setAttribute("data-command", action);
    return el;
  });
  commands.append(...commandButtons);
  /** Shows only matching commands and highlights the first one for Enter. */
  const showCommandMatches = (matches: readonly SlashCommand[]) => {
    let highlighted = false;
    SLASH_COMMANDS.forEach((command, index) => {
      const visible = matches.includes(command);
      commandButtons[index].hidden = !visible;
      commandButtons[index].setAttribute(
        "data-active",
        String(visible && !highlighted),
      );
      if (visible) highlighted = true;
    });
  };
  const focusHighlightedCommand = () =>
    commandButtons.find((el) => !el.hidden)?.focus();
  const actionButton = button("/ Actions", () => {
    showCommandMatches(SLASH_COMMANDS);
    setCommandsOpen(commands.hidden);
    if (!commands.hidden) focusHighlightedCommand();
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
  let disposed = false;
  let closingSearch = false;
  const ownsSearch = (revision: number) =>
    !disposed && revision === searchRevision && !search.hidden;
  const runSearch = async () => {
    const revision = ++searchRevision;
    let found: ChatSearchResult[];
    try {
      found = query.value.trim()
        ? await params.onSearch(query.value, scope.value as "current" | "saved")
        : [];
    } catch (error) {
      if (ownsSearch(revision)) results.textContent = String(error);
      return;
    }
    if (!ownsSearch(revision)) return;
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
            if (closingSearch) return;
            void params.onResult(result).catch((error) => {
              if (ownsSearch(revision)) results.textContent = String(error);
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
    if (closingSearch) return;
    void runSearch();
  };
  query.addEventListener("input", onSearchInput);
  scope.addEventListener("change", onSearchInput);
  const closeSearch = () => {
    if (closingSearch) return;
    closingSearch = true;
    query.disabled = true;
    scope.disabled = true;
    search.setAttribute("aria-busy", "true");
    const revision = searchRevision;
    void Promise.resolve()
      .then(() => params.onSearchClose())
      .then((closed) => {
        if (disposed || search.hidden || closed === false) return;
        search.hidden = true;
        searchRevision++;
        params.input.focus();
      })
      .catch((error) => {
        if (ownsSearch(revision)) results.textContent = String(error);
      })
      .finally(() => {
        closingSearch = false;
        query.disabled = false;
        scope.disabled = false;
        search.setAttribute("aria-busy", "false");
      });
  };
  search.append(
    query,
    scope,
    button("Return to reading", closeSearch),
    results,
  );
  search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
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
    const typed = parseSlashCommandInput(params.input.value);
    const matches = typed === undefined ? [] : filterSlashCommands(typed);
    showCommandMatches(matches);
    setCommandsOpen(matches.length > 0);
  };
  const onKey = (event: KeyboardEvent) => {
    if (commands.hidden) return;
    if (event.target === params.input && event.key === "ArrowDown") {
      event.preventDefault();
      focusHighlightedCommand();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setCommandsOpen(false);
      params.input.focus();
    }
  };
  root.addEventListener("keydown", onKey);
  params.input.addEventListener("input", onInput);
  params.input.addEventListener("keydown", onKey);
  return {
    root,
    setStatus(text: string) {
      status.textContent = text;
    },
    /**
     * Handles a bare `/word` draft on submit. Returns true when the draft was
     * a command attempt, so the caller must not send it as a question.
     */
    submitSlashCommand(): boolean {
      const submission = resolveSlashCommandSubmission(params.input.value);
      if (submission.kind === "not_command") return false;
      if (submission.kind === "unknown") {
        setCommandsOpen(false);
        status.textContent = formatUnknownSlashCommand(submission.typed);
        return true;
      }
      setCommandsOpen(false);
      params.onAction(submission.command);
      return true;
    },
    refresh() {
      length.value = params.getLength();
    },
    dispose() {
      disposed = true;
      searchRevision++;
      root.removeEventListener("keydown", onKey);
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
