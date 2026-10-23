import { node } from "./dom";
import { renderMarkdown } from "./sourceEditor";
import {
  TEXT_DOCUMENT,
  type StudioAIConfig,
  type StudioConversation,
  type StudioChange,
} from "./aiContracts";
import type { StudioDocument } from "./contracts";

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
  const closePanel = (restoreFocus = true) => {
    panel.hidden = true;
    host.classList.remove("with-assistant");
    opener?.setAttribute("aria-expanded", "false");
    if (restoreFocus) opener?.focus();
  };
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      closePanel();
    }
  });
  const heading = node("div", undefined, "panel-heading");
  const close = node("button", "Close assistant");
  close.onclick = () => closePanel();
  const fresh = node("button", "New conversation");
  heading.append(node("h2", "Assistant"), close);
  const archives = node("select");
  archives.setAttribute("aria-label", "Archived conversations");
  const resume = node("button", "Resume conversation");
  const historyControls = node("details");
  historyControls.append(
    node("summary", "Conversation history"),
    fresh,
    archives,
    resume,
  );
  const provider = node("select");
  provider.setAttribute("aria-label", "AI provider");
  for (const [value, label] of [
    ["codex", "Codex CLI"],
    ["claude", "Claude Code"],
    ["local", "Local model"],
  ]) {
    const option = node("option", label);
    option.value = value;
    provider.append(option);
  }
  const model = node("input");
  model.placeholder = "Model identifier";
  model.setAttribute("aria-label", "AI model");
  const endpoint = node("input");
  endpoint.value = "http://127.0.0.1:11434/v1";
  endpoint.setAttribute("aria-label", "Local model API base URL");
  endpoint.hidden = true;
  const key = node("input");
  key.type = "password";
  key.autocomplete = "off";
  key.placeholder = "API key · this window only";
  key.setAttribute("aria-label", "Provider API key");
  key.hidden = true;
  const disclosure = node(
    "p",
    "Selected files go through your CLI to its model provider.",
    "surface-notice",
  );
  const context = node("details");
  const contextSummary = node("summary", "Choose context files");
  const choices = node("div", undefined, "ai-context");
  context.append(contextSummary, choices);
  const transcript = node("div", undefined, "ai-transcript");
  const contextLabels: Array<{
    element: HTMLElement;
    captured: StudioConversation["turns"][number]["context"];
  }> = [];
  const refreshContextLabels = () => {
    for (const { element, captured } of contextLabels)
      element.textContent = `Context: ${captured
        .map((doc) => {
          const current = actions
            .documents()
            .find((entry) => entry.id === doc.id);
          const state = !current
            ? " · unavailable now"
            : current.archived
              ? " · archived now"
              : current.revision !== doc.revision
                ? ` · now v${current.revision}`
                : "";
          return `${doc.name} v${doc.revision}${state}`;
        })
        .join(", ")}`;
  };
  const question = node("textarea");
  question.rows = 3;
  question.placeholder = "Ask about the selected files or propose an edit…";
  question.setAttribute("aria-label", "Project question");
  const send = node("button", "Send");
  send.disabled = true;
  question.addEventListener("input", () => {
    send.disabled = busy || !question.value.trim();
  });
  const quote = node("button", "Use selected passage");
  quote.onclick = () => {
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
    question.value = `${question.value}${question.value ? "\n\n" : ""}Selected passage from ${JSON.stringify(passage.name)}:\n${JSON.stringify(passage.text)}\n`;
    renderChoices();
    send.disabled = busy || !question.value.trim();
    question.focus();
  };
  const stop = node("button", "Stop");
  stop.disabled = true;
  const status = node("output");
  status.setAttribute("aria-live", "polite");
  const controls = node("div", undefined, "surface-controls");
  controls.append(quote, send, stop);
  send.className = "primary";
  stop.hidden = true;
  const settings = node("details", undefined, "ai-settings");
  const settingsSummary = node("summary", "Model settings");
  const providerLabel = node("label", "Provider");
  providerLabel.append(provider);
  const modelLabel = node("label", "Model");
  modelLabel.append(model);
  settings.append(settingsSummary, providerLabel, modelLabel, endpoint, key);
  const updateSettingsLabel = () => {
    settingsSummary.textContent = `${provider.options[provider.selectedIndex]?.text || "Model"} · ${model.value || "choose model"}`;
  };
  model.addEventListener("input", updateSettingsLabel);
  const setup = node("div", undefined, "ai-setup");
  setup.append(settings, historyControls, context, disclosure);
  const composer = node("div", undefined, "ai-composer");
  composer.append(question, controls, status);
  panel.append(heading, setup, transcript, composer);
  host.append(panel);
  let defaults = { codex: "", claude: "" };
  let busy = false;
  const selected = new Set<string>();
  const error = (value: unknown) => {
    status.textContent = value instanceof Error ? value.message : String(value);
    status.dataset.error = "true";
  };
  const busyState = (value: boolean) => {
    busy = value;
    for (const control of [
      send,
      fresh,
      provider,
      model,
      endpoint,
      key,
      archives,
      resume,
      question,
      quote,
    ])
      control.disabled = value;
    send.disabled ||= !question.value.trim();
    stop.disabled = !value;
    stop.hidden = !value;
    resume.disabled ||= !archives.options.length;
    choices.inert = value;
    transcript.inert = value;
  };
  const renderChoices = () => {
    if (busy) return;
    choices.replaceChildren();
    const available = actions
      .documents()
      .filter(
        (doc) =>
          !doc.archived &&
          (TEXT_DOCUMENT.test(doc.name) || /\.(docx|pdf)$/i.test(doc.name)),
      );
    for (const id of selected)
      if (!available.some((doc) => doc.id === id)) selected.delete(id);
    for (const doc of available) {
      const input = node("input");
      input.type = "checkbox";
      input.checked = selected.has(doc.id);
      input.onchange = () => {
        if (input.checked) selected.add(doc.id);
        else selected.delete(doc.id);
        contextSummary.textContent = `Context files (${selected.size})`;
      };
      const label = node("label", ` ${doc.name} · v${doc.revision}`);
      label.prepend(input);
      choices.append(label);
    }
    contextSummary.textContent = `Context files (${selected.size})`;
  };
  const render = (conversation: StudioConversation) => {
    transcript.replaceChildren();
    contextLabels.length = 0;
    if (!conversation.turns.length)
      transcript.append(
        node(
          "p",
          "Ask a question about your files, or describe a change. You review edits before they are applied.",
          "assistant-empty",
        ),
      );
    for (const turn of conversation.turns) {
      const article = node("article", undefined, "ai-turn");
      article.append(
        node("p", turn.question, "ai-question"),
        node("small", `${turn.provider} · ${turn.model} · ${turn.status}`),
      );
      if (turn.context.length) {
        const element = node("small");
        contextLabels.push({ element, captured: turn.context });
        article.append(element);
      }
      if (turn.reply) {
        const reply = node("div");
        renderMarkdown(reply, turn.reply);
        article.append(reply);
      }
      if (turn.error) article.append(node("p", turn.error, "ai-error"));
      for (const change of turn.changes) {
        const review = node("details", undefined, "ai-change");
        review.append(
          node(
            "summary",
            `${change.kind} · ${change.name || turn.context.find((doc) => doc.id === change.documentID)?.name || "document"} · ${change.decision}`,
          ),
        );
        review.append(node("p", change.reason));
        if (change.before)
          review.append(node("strong", "Before"), node("pre", change.before));
        if (change.after)
          review.append(node("strong", "After"), node("pre", change.after));
        if (change.proposedAfter !== undefined) {
          const original = node("details");
          original.append(
            node("summary", "Original AI wording"),
            node("pre", change.proposedAfter),
          );
          review.append(original);
        }
        if (change.decision === "pending") {
          const editable = ["replace", "append", "create"].includes(
            change.kind,
          );
          const revised = node("textarea");
          revised.setAttribute("aria-label", "Reviewed replacement text");
          revised.value = change.after;
          revised.maxLength = 1_000_000;
          revised.rows = 5;
          if (editable)
            review.append(
              node("p", "Edit the replacement before applying it."),
              revised,
            );
          const apply = node("button", "Apply change");
          const reject = node("button", "Reject");
          const decide = async (action: "apply" | "reject") => {
            busyState(true);
            status.textContent = "Saving review decision…";
            try {
              render(
                action === "apply"
                  ? await actions.apply(
                      change,
                      editable ? revised.value : undefined,
                    )
                  : await actions.request<StudioConversation>("ai.decide", {
                      changeID: change.id,
                      decision: "reject",
                    }),
              );
              status.textContent =
                action === "apply"
                  ? "Change applied and version saved."
                  : "Proposal rejected.";
            } catch (cause) {
              error(cause);
            } finally {
              busyState(false);
              renderChoices();
            }
          };
          apply.onclick = () => void decide("apply");
          reject.onclick = () => void decide("reject");
          review.append(apply, reject);
        }
        article.append(review);
      }
      transcript.append(article);
    }
    transcript.scrollTop = transcript.scrollHeight;
    refreshContextLabels();
  };
  provider.onchange = () => {
    model.value =
      provider.value === "codex"
        ? defaults.codex
        : provider.value === "claude"
          ? defaults.claude
          : "";
    endpoint.hidden = provider.value !== "local";
    key.hidden = provider.value !== "local";
    key.value = "";
    disclosure.textContent =
      provider.value === "local"
        ? "Selected files are sent to the loopback endpoint. The endpoint controls where inference runs."
        : "Selected files go through your CLI to its model provider.";
    updateSettingsLabel();
  };
  send.onclick = () =>
    void (async () => {
      busyState(true);
      status.textContent = "Saving context and running…";
      delete status.dataset.error;
      try {
        await actions.save();
        const config: StudioAIConfig = {
          provider: provider.value as StudioAIConfig["provider"],
          model: model.value.trim(),
          endpoint: endpoint.value.trim(),
          apiKey: key.value.trim(),
        };
        render(
          await actions.request<StudioConversation>("ai.ask", {
            config,
            question: question.value,
            documentIDs: [...selected],
          }),
        );
        question.value = "";
        status.textContent =
          "Reply saved. Review each proposal before applying.";
      } catch (cause) {
        error(cause);
        try {
          render(await actions.request<StudioConversation>("ai.history"));
        } catch {
          /* Preserve the visible transcript on storage failure. */
        }
      } finally {
        busyState(false);
        renderChoices();
      }
    })();
  stop.onclick = () =>
    void actions
      .request("ai.cancel")
      .then(() => {
        status.textContent = "Stopping…";
      })
      .catch(error);
  fresh.onclick = () =>
    void (async () => {
      busyState(true);
      try {
        render(await actions.request<StudioConversation>("ai.new"));
        await loadArchives();
        status.textContent = "Previous conversation archived locally.";
      } catch (cause) {
        error(cause);
      } finally {
        busyState(false);
      }
    })();
  async function loadArchives() {
    const list =
      await actions.request<
        Array<{ id: string; title: string; createdAt: string; turns: number }>
      >("ai.conversations");
    archives.replaceChildren();
    for (const item of list) {
      const option = node(
        "option",
        `${item.createdAt.slice(0, 10)} · ${item.title} (${item.turns} turns)`,
      );
      option.value = item.id;
      archives.append(option);
    }
    resume.disabled = busy || !list.length;
  }
  resume.onclick = () =>
    void (async () => {
      if (!archives.value || busy) return;
      busyState(true);
      try {
        render(
          await actions.request<StudioConversation>("ai.resume", {
            id: archives.value,
          }),
        );
        await loadArchives();
        status.textContent =
          "Conversation resumed. The previous conversation was archived; document revisions still guard every proposal.";
      } catch (cause) {
        error(cause);
      } finally {
        busyState(false);
      }
    })();
  return {
    refresh() {
      renderChoices();
      refreshContextLabels();
    },
    close: closePanel,
    async open(trigger?: HTMLElement) {
      opener = trigger ?? opener;
      opener?.setAttribute("aria-controls", panel.id);
      opener?.setAttribute("aria-expanded", "true");
      panel.hidden = false;
      host.classList.add("with-assistant");
      question.focus();
      if (busy) return;
      const activeID = actions.activeID();
      if (!selected.size && activeID) {
        selected.add(activeID);
        renderChoices();
      }
      if (loaded) return;
      try {
        defaults = await actions.request("ai.defaults");
        if (!model.value)
          model.value =
            provider.value === "codex"
              ? defaults.codex
              : provider.value === "claude"
                ? defaults.claude
                : "";
        updateSettingsLabel();
        renderChoices();
        render(await actions.request<StudioConversation>("ai.history"));
        await loadArchives();
        loaded = true;
      } catch (cause) {
        error(cause);
      }
    },
  };
}
