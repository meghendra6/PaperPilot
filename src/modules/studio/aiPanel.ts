import { academicDraftRequest } from "./academicDraft";
import { node } from "./dom";
import {
  TEXT_DOCUMENT,
  type StudioAIDefaults,
  type StudioConversation,
  type StudioChange,
} from "./aiContracts";
import type { StudioDocument } from "./contracts";
import { engineBar } from "./aiEngine";
import { renderHistory, type ConversationSummary } from "./aiHistory";
import { pendingTurn, renderTranscript } from "./aiTranscript";

/** The composer grows with its text up to this height, then scrolls. */
const COMPOSER_MAX_HEIGHT = 220;

function iconButton(label: string, glyph: string, className = "icon-button") {
  const item = node("button", undefined, className);
  item.type = "button";
  item.setAttribute("aria-label", label);
  item.title = label;
  item.append(node("span", glyph));
  item.firstElementChild?.setAttribute("aria-hidden", "true");
  return item;
}

function conversationTitle(conversation?: StudioConversation) {
  const first = conversation?.turns[0]?.question.split("\n")[0]?.trim();
  if (!first) return "New conversation";
  return first.length > 80 ? `${first.slice(0, 79)}…` : first;
}

export function aiPanel(
  host: HTMLElement,
  actions: {
    request<T>(method: string, payload?: unknown): Promise<T>;
    documents(): StudioDocument[];
    activeID(): string | undefined;
    selection(): { id: string; name: string; text: string } | undefined;
    save(): Promise<void>;
    apply(
      change: StudioChange,
      editedAfter?: string,
    ): Promise<StudioConversation>;
  },
) {
  const panel = node("aside", undefined, "ai-panel");
  panel.setAttribute("aria-label", "Project assistant");
  panel.hidden = true;
  panel.id = "studio-assistant";
  let opener: HTMLElement | undefined;
  let loaded = false;
  let busy = false;
  let historyOpen = false;
  let conversation: StudioConversation | undefined;
  let archives: ConversationSummary[] = [];
  let refreshContext = () => {};
  const selected = new Set<string>();

  // Header: title, the open conversation, and conversation commands.
  const heading = node("div", undefined, "panel-heading ai-heading");
  const titles = node("div", undefined, "panel-titles");
  const subtitle = node("p", "New conversation", "panel-subtitle");
  titles.append(node("h2", "Assistant"), subtitle);
  const historyButton = node("button", "History", "quiet-button");
  historyButton.type = "button";
  historyButton.setAttribute("aria-pressed", "false");
  historyButton.title = "Earlier conversations in this project";
  const fresh = node("button", "New", "quiet-button");
  fresh.type = "button";
  fresh.title = "Start a new conversation. The open one is archived.";
  const close = iconButton("Close assistant", "×");
  const commands = node("div", undefined, "panel-actions");
  commands.append(historyButton, fresh, close);
  heading.append(titles, commands);

  const disclosure = node("p", undefined, "ai-disclosure");
  const engine = engineBar(() => {
    disclosure.textContent = engine.disclosure();
  });
  disclosure.textContent = engine.disclosure();

  const body = node("div", undefined, "ai-body");
  const transcript = node("div", undefined, "ai-transcript");
  const history = node("div", undefined, "ai-history");
  history.hidden = true;
  body.append(transcript, history);

  // Composer: context files, the request, and run controls.
  const composer = node("div", undefined, "ai-composer");
  const contextRow = node("div", undefined, "context-row");
  const contextLabel = node("span", "Context", "context-label");
  const chips = node("ul", undefined, "context-chips");
  chips.setAttribute("aria-label", "Selected context files");
  const addContext = node("button", "Add files", "chip-button");
  addContext.type = "button";
  addContext.setAttribute("aria-expanded", "false");
  addContext.setAttribute("aria-controls", "studio-context-picker");
  contextRow.append(contextLabel, chips, addContext);
  const picker = node("div", undefined, "context-picker");
  picker.id = "studio-context-picker";
  picker.hidden = true;
  const pickerHint = node(
    "p",
    "Text, DOCX and PDF files can be context. PDFs stay read-only.",
    "context-hint",
  );
  const choices = node("div", undefined, "ai-context");
  picker.append(pickerHint, choices);
  const question = node("textarea");
  question.rows = 3;
  question.placeholder =
    "Ask about the context files, or describe an edit to propose…";
  question.setAttribute("aria-label", "Project question");
  const quote = node("button", "Quote selection", "quiet-button");
  quote.type = "button";
  quote.title = "Add the passage selected in the open document";
  const draft = node("button", "Draft paper", "quiet-button");
  draft.type = "button";
  draft.title = "Prepare an academic draft in the open DOCX";
  const stop = node("button", "Stop");
  stop.type = "button";
  stop.hidden = true;
  const send = node("button", "Send", "primary");
  send.type = "button";
  send.title = "Send (Ctrl or ⌘ + Enter)";
  send.disabled = true;
  const controls = node("div", undefined, "composer-actions");
  controls.append(quote, draft, node("span", undefined, "spacer"), stop, send);
  const status = node("output", undefined, "composer-status");
  status.setAttribute("aria-live", "polite");
  composer.append(contextRow, picker, question, controls, status, disclosure);
  panel.append(heading, engine.element, body, composer);
  host.append(panel);

  const error = (value: unknown) => {
    status.textContent = value instanceof Error ? value.message : String(value);
    status.dataset.error = "true";
  };
  const note = (text: string) => {
    status.textContent = text;
    delete status.dataset.error;
  };
  const updateSend = () => {
    send.disabled = busy || !question.value.trim();
  };
  const autosize = () => {
    question.style.height = "auto";
    question.style.height = `${Math.min(question.scrollHeight + 2, COMPOSER_MAX_HEIGHT)}px`;
  };
  const busyState = (value: boolean) => {
    busy = value;
    for (const control of [question, quote, draft, historyButton, fresh])
      control.disabled = value;
    engine.setDisabled(value);
    updateSend();
    send.hidden = value;
    stop.hidden = !value;
    stop.disabled = !value;
    contextRow.inert = value;
    picker.inert = value;
    transcript.inert = value;
    history.inert = value;
    panel.setAttribute("aria-busy", String(value));
  };

  const togglePicker = (open = picker.hidden) => {
    picker.hidden = !open;
    addContext.setAttribute("aria-expanded", String(open));
    addContext.textContent = open ? "Done" : "Add files";
  };
  addContext.addEventListener("click", () => togglePicker());

  const renderChoices = () => {
    if (busy) return;
    const documents = actions.documents();
    const available = documents
      .filter(
        (doc) =>
          !doc.archived &&
          (TEXT_DOCUMENT.test(doc.name) || /\.(docx|pdf)$/i.test(doc.name)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const id of selected)
      if (!available.some((doc) => doc.id === id)) selected.delete(id);
    choices.replaceChildren();
    for (const doc of available) {
      const input = node("input");
      input.type = "checkbox";
      input.checked = selected.has(doc.id);
      input.onchange = () => {
        if (input.checked) selected.add(doc.id);
        else selected.delete(doc.id);
        renderChips();
      };
      const label = node("label");
      label.append(
        input,
        node("span", doc.name, "context-name"),
        node("span", `v${doc.revision}`, "context-revision"),
      );
      choices.append(label);
    }
    if (!available.length)
      choices.append(
        node("p", "No text, DOCX or PDF files yet.", "context-hint"),
      );
    renderChips();
  };
  const renderChips = () => {
    chips.replaceChildren();
    const documents = actions.documents();
    for (const id of selected) {
      const doc = documents.find((entry) => entry.id === id);
      if (!doc) continue;
      const chip = node("li", undefined, "context-chip");
      const label = doc.name.split("/").at(-1) ?? doc.name;
      chip.title = doc.name;
      const remove = node("button", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${doc.name} from context`);
      remove.addEventListener("click", () => {
        selected.delete(id);
        renderChoices();
        question.focus();
      });
      chip.append(node("span", label), remove);
      chips.append(chip);
    }
    // Offer the open document when it is not context yet.
    const activeID = actions.activeID();
    const active = documents.find((doc) => doc.id === activeID);
    if (
      active &&
      !selected.has(active.id) &&
      !active.archived &&
      (TEXT_DOCUMENT.test(active.name) || /\.(docx|pdf)$/i.test(active.name))
    ) {
      const item = node("li");
      const suggest = node(
        "button",
        `+ ${active.name.split("/").at(-1)}`,
        "chip-button is-suggestion",
      );
      suggest.type = "button";
      suggest.title = `Add the open document ${active.name}`;
      suggest.addEventListener("click", () => {
        selected.add(active.id);
        renderChoices();
      });
      item.append(suggest);
      chips.append(item);
    }
    if (!chips.childElementCount)
      chips.append(
        node("li", "No files · general questions only", "context-none"),
      );
  };

  const decide = (
    change: StudioChange,
    action: "apply" | "reject",
    editedAfter?: string,
  ) =>
    void (async () => {
      if (busy) return;
      busyState(true);
      note("Saving review decision…");
      try {
        render(
          action === "apply"
            ? await actions.apply(change, editedAfter)
            : await actions.request<StudioConversation>("ai.decide", {
                changeID: change.id,
                decision: "reject",
              }),
        );
        note(
          action === "apply"
            ? "Change applied and version saved."
            : "Proposal rejected.",
        );
      } catch (cause) {
        error(cause);
      } finally {
        busyState(false);
        renderChoices();
      }
    })();

  const render = (next: StudioConversation) => {
    conversation = next;
    subtitle.textContent = conversationTitle(next);
    subtitle.title = next.turns[0]?.question.slice(0, 500) ?? "";
    refreshContext = renderTranscript(transcript, next, {
      documents: actions.documents,
      decide,
    });
  };

  const showTranscript = (restoreFocus = true) => {
    historyOpen = false;
    history.hidden = true;
    transcript.hidden = false;
    // A conversation rendered while hidden keeps its scroll at the top.
    transcript.scrollTop = transcript.scrollHeight;
    historyButton.setAttribute("aria-pressed", "false");
    historyButton.classList.remove("is-active");
    if (restoreFocus) historyButton.focus();
  };
  const showHistory = () => {
    historyOpen = true;
    transcript.hidden = true;
    history.hidden = false;
    historyButton.setAttribute("aria-pressed", "true");
    historyButton.classList.add("is-active");
    renderHistory(
      history,
      {
        title: conversationTitle(conversation),
        turns: conversation?.turns.length ?? 0,
        updatedAt: conversation?.turns.at(-1)?.createdAt ?? "",
      },
      archives,
      (id) => void resume(id),
      () => {
        showTranscript(false);
        question.focus();
      },
    );
  };
  historyButton.addEventListener("click", () =>
    historyOpen ? showTranscript() : showHistory(),
  );

  async function loadArchives() {
    archives = await actions.request<ConversationSummary[]>("ai.conversations");
    historyButton.textContent = archives.length
      ? `History (${archives.length})`
      : "History";
  }

  async function resume(id: string) {
    if (busy) return;
    busyState(true);
    try {
      render(await actions.request<StudioConversation>("ai.resume", { id }));
      await loadArchives();
      showTranscript(false);
      question.focus();
      note(
        "Conversation resumed. The previous one is in History; document revisions still guard every proposal.",
      );
    } catch (cause) {
      error(cause);
    } finally {
      busyState(false);
    }
  }

  const closePanel = (restoreFocus = true) => {
    panel.hidden = true;
    host.classList.remove("with-assistant");
    opener?.setAttribute("aria-expanded", "false");
    if (restoreFocus) opener?.focus();
  };
  /** Escape closes the innermost open part first. */
  const dismiss = () => {
    if (!picker.hidden) {
      togglePicker(false);
      addContext.focus();
    } else if (historyOpen) showTranscript();
    else closePanel();
  };
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      dismiss();
    }
  });
  close.addEventListener("click", () => closePanel());

  question.addEventListener("input", () => {
    updateSend();
    autosize();
  });
  question.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      !send.disabled
    ) {
      event.preventDefault();
      send.click();
    }
  });
  const appendToQuestion = (text: string) => {
    question.value = text;
    autosize();
    updateSend();
    question.focus();
  };
  quote.addEventListener("click", () => {
    const passage = actions.selection();
    if (!passage?.text.trim()) {
      error(new Error("Select a passage in the open document first."));
      return;
    }
    if (passage.text.length > 10000) {
      error(new Error("Choose a passage of at most 10,000 characters."));
      return;
    }
    selected.add(passage.id);
    renderChoices();
    appendToQuestion(
      `${question.value}${question.value ? "\n\n" : ""}Selected passage from ${JSON.stringify(passage.name)}:\n${JSON.stringify(passage.text)}\n`,
    );
  });
  draft.addEventListener("click", () => {
    const target = actions
      .documents()
      .find((doc) => doc.id === actions.activeID());
    if (!target || !/\.docx$/i.test(target.name)) {
      error(
        new Error(
          "Create or open a DOCX first, then add source files as context.",
        ),
      );
      return;
    }
    selected.add(target.id);
    renderChoices();
    appendToQuestion(academicDraftRequest(target.name) + question.value);
    question.setSelectionRange(question.value.length, question.value.length);
    note(
      "Add your topic and journal instructions at the end, add source files as context, then Send. You review the draft before it is appended.",
    );
  });

  send.addEventListener(
    "click",
    () =>
      void (async () => {
        if (busy || !question.value.trim()) return;
        if (historyOpen) showTranscript(false);
        const asked = question.value;
        busyState(true);
        note("Saving context and running…");
        const pending = pendingTurn(asked, engine.summary());
        transcript.querySelector(".assistant-empty")?.remove();
        transcript.append(pending.element);
        transcript.scrollTop = transcript.scrollHeight;
        try {
          await actions.save();
          render(
            await actions.request<StudioConversation>("ai.ask", {
              config: engine.config(),
              question: asked,
              documentIDs: [...selected],
            }),
          );
          question.value = "";
          autosize();
          note(
            conversation?.turns.at(-1)?.changes.length
              ? "Reply saved. Review each proposal before applying it."
              : "Reply saved.",
          );
        } catch (cause) {
          error(cause);
          try {
            render(await actions.request<StudioConversation>("ai.history"));
          } catch {
            /* Preserve the visible transcript on storage failure. */
            pending.element.remove();
          }
        } finally {
          pending.stop();
          busyState(false);
          renderChoices();
          question.focus();
        }
      })(),
  );
  stop.addEventListener(
    "click",
    () =>
      void actions
        .request("ai.cancel")
        .then(() => note("Stopping…"))
        .catch(error),
  );
  fresh.addEventListener(
    "click",
    () =>
      void (async () => {
        if (busy) return;
        const hadTurns = !!conversation?.turns.length;
        busyState(true);
        try {
          render(await actions.request<StudioConversation>("ai.new"));
          await loadArchives();
          if (historyOpen) showTranscript(false);
          note(
            hadTurns
              ? "Previous conversation archived. Find it in History."
              : "New conversation started.",
          );
        } catch (cause) {
          error(cause);
        } finally {
          busyState(false);
          question.focus();
        }
      })(),
  );

  return {
    refresh() {
      renderChoices();
      refreshContext();
    },
    close: closePanel,
    dismiss,
    async open(trigger?: HTMLElement) {
      opener = trigger ?? opener;
      opener?.setAttribute("aria-controls", panel.id);
      opener?.setAttribute("aria-expanded", "true");
      panel.hidden = false;
      host.classList.add("with-assistant");
      question.focus();
      if (busy) return;
      const activeID = actions.activeID();
      if (!selected.size && activeID) selected.add(activeID);
      renderChoices();
      if (loaded) return;
      try {
        const defaults = await actions.request<StudioAIDefaults>("ai.defaults");
        const current = await actions.request<StudioConversation>("ai.history");
        // Continue with the provider and model of the latest question.
        const last = current.turns.at(-1);
        engine.setDefaults(
          defaults,
          last ? { provider: last.provider, model: last.model } : undefined,
        );
        render(current);
        await loadArchives();
        loaded = true;
      } catch (cause) {
        error(cause);
      }
    },
  };
}
