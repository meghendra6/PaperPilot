import { getPref } from "../../utils/prefs";
import { getStatusLabel } from "../ai/statusLabels";
import type { EngineMode } from "../ai/types";
import { getRecentModels } from "../codex/modelHistory";
import {
  CODEX_DEFAULT_MODEL,
  getAllowedCodexModels,
  getClaudeBuiltInModels,
  getCodexBuiltInModelCatalog,
  getCodexBuiltInModels,
  getGeminiBuiltInModels,
  mergeModelOptions,
  normalizeClaudeModel,
  normalizeClaudeModelList,
  normalizeCodexModel,
  normalizeCodexModelList,
  normalizeCodexReasoningEffort,
  normalizeGeminiModel,
  normalizeGeminiModelList,
  parseAllowedModels,
  resolveCodexModel,
} from "../codex/modelOptions";
import {
  isNativeSelectInteraction,
  shouldDismissPopover,
} from "./popoverDismissal";

export interface PaneHeaderHandle {
  root: HTMLElement;
  trigger: HTMLButtonElement;
  modeChip: HTMLElement;
  modeStatus: HTMLElement;
  modeGeminiButton: HTMLButtonElement;
  modeClaudeButton: HTMLButtonElement;
  modeCodexButton: HTMLButtonElement;
  modeResetButton: HTMLButtonElement;
  newSessionButton: HTMLButtonElement;
  codexActions: HTMLElement;
  codexAuthButton: HTMLButtonElement;
  codexDeviceAuthButton: HTMLButtonElement;
  codexRecheckButton: HTMLButtonElement;
  modelRow: HTMLElement;
  modelInput: HTMLSelectElement;
  modelSaveButton: HTMLButtonElement;
  codexOptionsRow: HTMLElement;
  codexWebSearchToggle: HTMLInputElement;
  modelHistory: HTMLElement;
  setOpen(open: boolean, restoreFocus?: boolean): void;
  dispose(): void;
}

function makeButton(
  doc: Document,
  id: string,
  text: string,
  className = "pp-btn pp-btn--ghost",
) {
  const button = doc.createElement("button");
  button.type = "button";
  button.id = id;
  button.className = className;
  button.textContent = text;
  return button;
}

export function createPaneHeader(params: {
  doc: Document;
  mount: HTMLElement;
}): PaneHeaderHandle {
  const { doc } = params;
  const root = doc.createElement("div");
  root.id = "paper-pilot-pane-header";
  root.className = "pp-pane-header";

  const trigger = makeButton(doc, "paper-pilot-engine-trigger", "");
  trigger.className = "pp-pane-header__trigger";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", "paper-pilot-engine-popover");

  const dot = doc.createElement("span");
  dot.className = "pp-pane-header__dot";
  dot.setAttribute("aria-hidden", "true");
  const modeChip = doc.createElement("span");
  modeChip.id = "paper-pilot-mode-chip";
  modeChip.className = "pp-pane-header__label";
  trigger.append(dot, modeChip);

  const newSessionButton = makeButton(
    doc,
    "chat-new-session",
    "+",
    "pp-btn pp-btn--ghost pp-pane-header__new-session",
  );
  newSessionButton.setAttribute("aria-label", "New session");
  newSessionButton.title = "New session";

  const popover = doc.createElement("div");
  popover.id = "paper-pilot-engine-popover";
  popover.className = "pp-pane-header__popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "AI engine settings");
  popover.tabIndex = -1;
  popover.hidden = true;

  const modeStatus = doc.createElement("div");
  modeStatus.id = "paper-pilot-mode-status";
  modeStatus.className = "pp-pane-header__status";

  const modeActions = doc.createElement("div");
  modeActions.className = "pp-pane-header__mode-actions";
  const modeGeminiButton = makeButton(doc, "chat-mode-gemini", "Gemini CLI");
  const modeClaudeButton = makeButton(doc, "chat-mode-claude", "Claude Code");
  const modeCodexButton = makeButton(doc, "chat-mode-codex", "Codex CLI");
  const modeResetButton = makeButton(doc, "chat-mode-reset", "Use Default");
  modeActions.append(
    modeGeminiButton,
    modeClaudeButton,
    modeCodexButton,
    modeResetButton,
  );

  const modelRow = doc.createElement("div");
  modelRow.id = "paper-pilot-model-row";
  modelRow.className = "pp-model-row";
  const modelLabel = doc.createElement("label");
  modelLabel.htmlFor = "chat-codex-model";
  modelLabel.textContent = "Model";
  const modelInput = doc.createElement("select");
  modelInput.id = "chat-codex-model";
  const modelSaveButton = makeButton(
    doc,
    "chat-codex-model-save",
    "Save",
    "pp-btn pp-btn--primary",
  );
  modelRow.append(modelLabel, modelInput, modelSaveButton);

  const codexOptionsRow = doc.createElement("div");
  codexOptionsRow.id = "paper-pilot-codex-options";
  codexOptionsRow.className = "pp-codex-options";
  const webSearchLabel = doc.createElement("label");
  const codexWebSearchToggle = doc.createElement("input");
  codexWebSearchToggle.type = "checkbox";
  codexWebSearchToggle.id = "chat-codex-web-search";
  const webSearchText = doc.createElement("span");
  webSearchText.textContent = "Allow web search when needed";
  webSearchLabel.append(codexWebSearchToggle, webSearchText);
  codexOptionsRow.append(webSearchLabel);

  const codexActions = doc.createElement("div");
  codexActions.id = "paper-pilot-codex-actions";
  codexActions.className = "pp-codex-actions";
  const codexAuthButton = makeButton(
    doc,
    "chat-codex-auth",
    "Authenticate Codex",
    "pp-btn pp-btn--secondary",
  );
  const codexDeviceAuthButton = makeButton(
    doc,
    "chat-codex-device-auth",
    "Use device auth",
    "pp-btn pp-btn--secondary",
  );
  const codexRecheckButton = makeButton(
    doc,
    "chat-codex-recheck",
    "Re-check status",
    "pp-btn pp-btn--secondary",
  );
  codexActions.append(
    codexAuthButton,
    codexDeviceAuthButton,
    codexRecheckButton,
  );

  const modelHistory = doc.createElement("div");
  modelHistory.id = "paper-pilot-model-history";
  modelHistory.className = "pp-model-history";
  modelHistory.style.display = "none";

  popover.append(
    modeStatus,
    modeActions,
    modelRow,
    codexOptionsRow,
    modelHistory,
    codexActions,
  );
  root.append(trigger, newSessionButton, popover);
  params.mount.replaceWith(root);

  const setOpen = (open: boolean, restoreFocus = false) => {
    popover.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    root.classList.toggle("pp-pane-header--open", open);
    if (open) {
      popover.focus();
    } else if (restoreFocus) {
      trigger.focus();
    }
  };
  const onTrigger = () => setOpen(popover.hidden);
  // Zotero's native select popup retargets its final click to `main-window`.
  // Preserve only that next click when the interaction began in the picker.
  let preserveNextNativeSelectClick = false;
  const onDocumentPointerDown = (event: PointerEvent) => {
    if (popover.hidden) return;
    preserveNextNativeSelectClick = isNativeSelectInteraction(
      modelInput,
      event,
    );
  };
  const onDocumentClick = (event: MouseEvent) => {
    if (popover.hidden) return;
    const preservePopover =
      preserveNextNativeSelectClick && doc.activeElement === modelInput;
    preserveNextNativeSelectClick = false;
    if (!preservePopover && shouldDismissPopover(root, event)) {
      setOpen(false);
    }
  };
  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (!popover.hidden && event.key === "Escape") {
      event.preventDefault();
      setOpen(false, true);
    }
  };
  trigger.addEventListener("click", onTrigger);
  doc.addEventListener("pointerdown", onDocumentPointerDown, true);
  doc.addEventListener("click", onDocumentClick);
  doc.addEventListener("keydown", onDocumentKeyDown, true);
  let disposed = false;

  return {
    root,
    trigger,
    modeChip,
    modeStatus,
    modeGeminiButton,
    modeClaudeButton,
    modeCodexButton,
    modeResetButton,
    newSessionButton,
    codexActions,
    codexAuthButton,
    codexDeviceAuthButton,
    codexRecheckButton,
    modelRow,
    modelInput,
    modelSaveButton,
    codexOptionsRow,
    codexWebSearchToggle,
    modelHistory,
    setOpen,
    dispose() {
      if (disposed) return;
      disposed = true;
      trigger.removeEventListener("click", onTrigger);
      doc.removeEventListener("pointerdown", onDocumentPointerDown, true);
      doc.removeEventListener("click", onDocumentClick);
      doc.removeEventListener("keydown", onDocumentKeyDown, true);
    },
  };
}

function getModeShortLabel(label: string) {
  if (label.includes("Gemini")) return "Gemini";
  if (label.includes("Claude")) return "Claude";
  return "Codex";
}

export function renderModeHeader(
  chip: HTMLElement,
  status: HTMLElement,
  label: string,
  providerStatus: string,
) {
  const root = chip.closest(".pp-pane-header") as HTMLElement | null;
  const modelInput = root?.querySelector(
    "#chat-codex-model",
  ) as HTMLSelectElement | null;
  const modelLabel = modelInput?.selectedOptions[0]?.textContent?.trim();
  chip.textContent = [getModeShortLabel(label), modelLabel]
    .filter(Boolean)
    .join(" · ");
  status.textContent = `Status: ${getStatusLabel(providerStatus)}`;
  root?.setAttribute("data-status", providerStatus);
  const trigger = root?.querySelector(
    "#paper-pilot-engine-trigger",
  ) as HTMLButtonElement | null;
  trigger?.setAttribute(
    "aria-label",
    `${chip.textContent}. ${status.textContent}. Open engine settings`,
  );
}

export function renderModelRow(
  modelRow: HTMLElement,
  modelInput: HTMLSelectElement,
  _mode: EngineMode,
) {
  modelRow.style.display = "flex";
  modelInput.disabled = false;
}

export function renderCodexOptionsRow(
  codexOptionsRow: HTMLElement,
  codexWebSearchToggle: HTMLInputElement,
  mode: EngineMode,
) {
  if (mode !== "codex_cli") {
    codexOptionsRow.style.display = "none";
    codexWebSearchToggle.checked = false;
    return;
  }
  codexOptionsRow.style.display = "flex";
  codexWebSearchToggle.checked = Boolean(getPref("codexEnableWebSearch"));
}

function getDefaultModelPrefForMode(mode: EngineMode) {
  if (mode === "gemini_cli") return "geminiDefaultModel";
  if (mode === "claude_code") return "claudeDefaultModel";
  return "codexDefaultModel";
}

function getAllowedModelsPrefForMode(mode: EngineMode) {
  if (mode === "gemini_cli") return "geminiAllowedModels";
  if (mode === "claude_code") return "claudeAllowedModels";
  return "codexAllowedModels";
}

function getFallbackModelForMode(mode: EngineMode) {
  if (mode === "gemini_cli") return "gemini-3.1-pro-preview";
  if (mode === "claude_code") return "sonnet";
  return CODEX_DEFAULT_MODEL;
}

function getBuiltInModelsForMode(mode: EngineMode) {
  if (mode === "gemini_cli") return getGeminiBuiltInModels();
  if (mode === "claude_code") return getClaudeBuiltInModels();
  return getCodexBuiltInModels();
}

export function normalizeModelForMode(mode: EngineMode, model: string) {
  if (mode === "gemini_cli") return normalizeGeminiModel(model);
  if (mode === "claude_code") return normalizeClaudeModel(model);
  return normalizeCodexModel(model);
}

function normalizeModelListForMode(mode: EngineMode, models: string[]) {
  if (mode === "gemini_cli") return normalizeGeminiModelList(models);
  if (mode === "claude_code") return normalizeClaudeModelList(models);
  return normalizeCodexModelList(models);
}

export function renderModelHistory(
  modelHistory: HTMLElement,
  modelInput: HTMLSelectElement,
  mode: EngineMode,
) {
  const recentModels = normalizeModelListForMode(mode, getRecentModels(mode));
  const allowedModels = normalizeModelListForMode(
    mode,
    parseAllowedModels(
      String(getPref(getAllowedModelsPrefForMode(mode)) || ""),
    ),
  );
  const options = mergeModelOptions(
    recentModels,
    mergeModelOptions(allowedModels, getBuiltInModelsForMode(mode)),
  );
  const currentValue = String(
    getPref(getDefaultModelPrefForMode(mode)) || getFallbackModelForMode(mode),
  );
  const selectedValue =
    mode === "codex_cli"
      ? resolveCodexModel(
          currentValue,
          String(getPref("codexAllowedModels") || ""),
        )
      : normalizeModelForMode(mode, currentValue);
  const currentReasoningEffort =
    mode === "codex_cli"
      ? normalizeCodexReasoningEffort(
          String(getPref("codexReasoningEffort") || "medium"),
          selectedValue,
        )
      : "";
  const optionMap = new Map<string, string>();

  if (mode === "codex_cli") {
    const allowed = getAllowedCodexModels(
      String(getPref("codexAllowedModels") || ""),
    );
    for (const model of getCodexBuiltInModelCatalog().filter((entry) =>
      allowed.includes(entry.slug),
    )) {
      const efforts = model.reasoningEfforts.length
        ? model.reasoningEfforts
        : [model.defaultReasoningEffort || "medium"];
      for (const effort of efforts) {
        optionMap.set(
          `${model.slug}|${effort}`,
          `${model.displayName} (${effort})`,
        );
      }
    }
  } else {
    for (const model of options) {
      optionMap.set(`${model}|`, model);
    }
  }

  const currentKey =
    mode === "codex_cli"
      ? `${selectedValue}|${currentReasoningEffort}`
      : `${selectedValue}|`;
  const doc = modelInput.ownerDocument;
  modelInput.replaceChildren(
    ...[...optionMap.entries()].map(([value, label]) => {
      const option = doc.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === currentKey;
      return option;
    }),
  );
  if (!optionMap.has(currentKey)) {
    const fallback = doc.createElement("option");
    fallback.value = currentKey;
    fallback.textContent =
      mode === "codex_cli" && currentReasoningEffort
        ? `${selectedValue} (${currentReasoningEffort})`
        : selectedValue;
    fallback.selected = true;
    modelInput.appendChild(fallback);
  }
  modelHistory.style.display = "none";
  modelHistory.replaceChildren();
}
