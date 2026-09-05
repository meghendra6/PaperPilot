import { getEngineLabel } from "../ai/runFailure";
import { isRunProgressActive, type RunProgressState } from "../ai/runProgress";

export const PAPER_PILOT_PREF_PANE_ID = "paper-pilot-preferences";

export interface RunProgressCardHandle {
  render(state?: RunProgressState): void;
  dispose(): void;
}

export interface RunProgressCardActions {
  onRetry(): void | Promise<void>;
  onOpenSettings(): void | Promise<void>;
  onShowLoginHelp(engine: RunProgressState["engine"]): void | Promise<void>;
}

const PHASE_LABELS: Record<RunProgressState["phase"], string> = {
  preparing: "Preparing paper context",
  running: "Waiting for answer",
  finishing: "Finishing answer",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function formatRunElapsed(startedAt: number, now = Date.now()): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function createRunProgressCard(params: {
  container: HTMLElement;
  actions: RunProgressCardActions;
}): RunProgressCardHandle {
  let disposed = false;
  let state: RunProgressState | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let elapsedElement: HTMLElement | undefined;

  const stopTimer = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  };

  const makeButton = (label: string, action: () => void | Promise<void>) => {
    const button = params.container.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "pp-btn pp-btn--secondary";
    button.textContent = label;
    let busy = false;
    button.addEventListener("click", () => {
      if (busy) return;
      busy = true;
      button.disabled = true;
      void Promise.resolve(action()).finally(() => {
        busy = false;
        button.disabled = false;
      });
    });
    return button;
  };

  const updateElapsed = () => {
    if (!state || !elapsedElement) return;
    elapsedElement.textContent = formatRunElapsed(
      state.startedAt,
      isRunProgressActive(state) ? Date.now() : state.updatedAt,
    );
    elapsedElement.setAttribute(
      "aria-label",
      `Elapsed ${elapsedElement.textContent}`,
    );
  };

  const paint = () => {
    if (disposed) return;
    params.container.replaceChildren();
    elapsedElement = undefined;
    if (!state) {
      params.container.style.display = "none";
      delete params.container.dataset.phase;
      params.container.removeAttribute("role");
      params.container.removeAttribute("aria-live");
      return;
    }

    params.container.style.display = "block";
    params.container.setAttribute("role", "status");
    params.container.setAttribute("aria-live", "polite");
    params.container.dataset.phase = state.phase;

    const doc = params.container.ownerDocument;
    const header = doc.createElement("div");
    header.className = "pp-run-progress__header";
    const label = doc.createElement("strong");
    label.textContent = getEngineLabel(state.engine);
    const phase = doc.createElement("span");
    phase.textContent = PHASE_LABELS[state.phase];
    const elapsed = doc.createElement("time");
    elapsed.setAttribute("aria-live", "off");
    elapsedElement = elapsed;
    updateElapsed();
    header.append(label, phase, elapsed);

    const body = doc.createElement("div");
    body.className = "pp-run-progress__body";
    if (state.failure) {
      const message = doc.createElement("div");
      message.className = "pp-run-progress__message";
      message.textContent = state.failure.userMessage;
      body.appendChild(message);

      if (state.failure.rawError) {
        const details = doc.createElement("details");
        const summary = doc.createElement("summary");
        summary.textContent = "Raw logs";
        const raw = doc.createElement("pre");
        raw.textContent = state.failure.rawError;
        details.append(summary, raw);
        body.appendChild(details);
      }
    }

    if (!state.failure && isRunProgressActive(state)) {
      const guidance = doc.createElement("div");
      guidance.className = "pp-run-progress__message";
      guidance.textContent =
        state.phase === "preparing"
          ? "Preparing your request. Stop it before asking a new question."
          : state.phase === "running"
            ? "Your request is running. The answer will appear here; no need to send it again."
            : "Saving the answer. You can send another message when this finishes.";
      body.appendChild(guidance);
    }
    const actions = doc.createElement("div");
    actions.className = "pp-run-progress__actions";
    if (!isRunProgressActive(state) && state.canRetry) {
      actions.appendChild(makeButton("Retry", params.actions.onRetry));
    }
    if (state.failure?.action === "open_settings") {
      actions.appendChild(
        makeButton("Open settings", params.actions.onOpenSettings),
      );
    }
    if (state.failure?.action === "show_login_help") {
      actions.appendChild(
        makeButton("Login help", () =>
          params.actions.onShowLoginHelp(state!.engine),
        ),
      );
    }

    params.container.append(header, body, actions);
  };

  return {
    render(nextState) {
      if (disposed) return;
      state = nextState;
      stopTimer();
      paint();
      if (state && isRunProgressActive(state)) {
        timer = setInterval(updateElapsed, 1000);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopTimer();
      params.container.replaceChildren();
      params.container.style.display = "none";
      delete params.container.dataset.phase;
      params.container.removeAttribute("role");
      params.container.removeAttribute("aria-live");
    },
  };
}
