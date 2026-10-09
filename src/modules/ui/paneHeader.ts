import { getPref } from "../../utils/prefs";
import { getStatusLabel } from "../ai/statusLabels";
import type { EngineMode } from "../ai/types";
import { getRecentModels } from "../codex/modelHistory";
import {
  CODEX_DEFAULT_MODEL,
  getAllowedCodexModels,
  getClaudeBuiltInModels,
  getClaudeModelLabel,
  getClaudeReasoningEfforts,
  getCodexBuiltInModelCatalog,
  getCodexBuiltInModels,
  mergeModelOptions,
  normalizeClaudeModel,
  normalizeClaudeModelList,
  normalizeClaudeReasoningEffort,
  normalizeCodexModel,
  normalizeCodexModelList,
  normalizeCodexReasoningEffort,
  parseAllowedModels,
  resolveCodexModel,
} from "../codex/modelOptions";
import { WEB_SEARCH_SETTING_LABEL } from "../discovery/capabilities";
import {
  getEngineSelectionPresentation,
  isModelSelectionDirty,
  shouldShowCodexAuthActions,
} from "./engineSettingsState";
import {
  createNativeSelectClickGuard,
  shouldDismissPopover,
} from "./popoverDismissal";

export interface PaneHeaderHandle {
  root: HTMLElement;
  trigger: HTMLButtonElement;
  modeChip: HTMLElement;
  modeStatus: HTMLElement;
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
  claudeEffortInput: HTMLSelectElement;
  modelSaveButton: HTMLButtonElement;
  codexOptionsRow: HTMLElement;
  codexWebSearchToggle: HTMLInputElement;
  modelHistory: HTMLElement;
  setOpen(open: boolean, restoreFocus?: boolean): void;
  /** Confirms a saved default model until the selection changes again. */
  markModelSaved(): void;
  /** Shows Codex authentication guidance inside the popover. */
  setCodexAuthStatus(text: string): void;
  dispose(): void;
}

const MODEL_SAVE_LABEL = "Save";
const MODEL_SAVED_LABEL = "Saved";

/** The saved default each picker shows when no unsaved choice is pending. */
const savedSelectValues = new WeakMap<HTMLSelectElement, string>();

function getSavedSelectValue(select: HTMLSelectElement) {
  return savedSelectValues.get(select);
}

function setSavedSelectValue(select: HTMLSelectElement, value?: string) {
  if (value === undefined) savedSelectValues.delete(select);
  else savedSelectValues.set(select, value);
}

/**
 * A re-render rebuilds the options from the saved prefs. The reader's unsaved
 * choice survives it, so ticking web search or Re-check does not undo a pick.
 * Closing the popover still reverts it on purpose.
 */
export function captureUnsavedSelection(
  select: HTMLSelectElement,
): string | undefined {
  const saved = getSavedSelectValue(select);
  const value = select.value;
  return saved !== undefined && typeof value === "string" && value !== saved
    ? value
    : undefined;
}

export function restoreUnsavedSelection(
  select: HTMLSelectElement,
  pending: string | undefined,
): void {
  if (pending === undefined) return;
  // Zotero's DOM typings list options as plain Elements.
  const values = Array.from(
    select.options ?? [],
    (option) => (option as HTMLOptionElement).value,
  );
  if (values.includes(pending)) select.value = pending;
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

  const engineLabel = doc.createElement("div");
  engineLabel.id = "paper-pilot-engine-label";
  engineLabel.className = "pp-pane-header__row-label";
  engineLabel.textContent = "Engine for this paper";
  const modeActions = doc.createElement("div");
  modeActions.className = "pp-pane-header__mode-actions";
  modeActions.setAttribute("role", "group");
  modeActions.setAttribute("aria-labelledby", engineLabel.id);
  const modeClaudeButton = makeButton(doc, "chat-mode-claude", "Claude Code");
  const modeCodexButton = makeButton(doc, "chat-mode-codex", "Codex CLI");
  modeClaudeButton.setAttribute("aria-pressed", "false");
  modeCodexButton.setAttribute("aria-pressed", "false");
  const modeResetButton = makeButton(doc, "chat-mode-reset", "Use default");
  modeActions.append(modeClaudeButton, modeCodexButton, modeResetButton);

  const modelRow = doc.createElement("div");
  modelRow.id = "paper-pilot-model-row";
  modelRow.className = "pp-model-row";
  const modelLabel = doc.createElement("label");
  modelLabel.htmlFor = "chat-codex-model";
  modelLabel.textContent = "Default model (all papers)";
  const modelInput = doc.createElement("select");
  modelInput.id = "chat-codex-model";
  const modelSaveButton = makeButton(
    doc,
    "chat-codex-model-save",
    MODEL_SAVE_LABEL,
    "pp-btn pp-btn--primary",
  );
  modelSaveButton.title = "Save as the default model for all papers";
  modelSaveButton.disabled = true;
  const modelSaveStatus = doc.createElement("span");
  modelSaveStatus.id = "chat-codex-model-save-status";
  modelSaveStatus.className = "pp-visually-hidden";
  modelSaveStatus.setAttribute("role", "status");
  modelSaveStatus.setAttribute("aria-live", "polite");
  const claudeEffortInput = doc.createElement("select");
  claudeEffortInput.id = "chat-claude-effort";
  claudeEffortInput.setAttribute("aria-label", "Claude effort");
  claudeEffortInput.hidden = true;
  modelRow.append(
    modelLabel,
    modelInput,
    claudeEffortInput,
    modelSaveButton,
    modelSaveStatus,
  );

  const codexOptionsRow = doc.createElement("div");
  codexOptionsRow.id = "paper-pilot-codex-options";
  codexOptionsRow.className = "pp-codex-options";
  const webSearchLabel = doc.createElement("label");
  const codexWebSearchToggle = doc.createElement("input");
  codexWebSearchToggle.type = "checkbox";
  codexWebSearchToggle.id = "chat-codex-web-search";
  const webSearchText = doc.createElement("span");
  webSearchText.textContent = WEB_SEARCH_SETTING_LABEL;
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
  const codexAuthStatus = doc.createElement("div");
  codexAuthStatus.id = "paper-pilot-codex-auth-status";
  codexAuthStatus.className = "pp-codex-actions__status";
  codexAuthStatus.setAttribute("role", "status");
  codexAuthStatus.setAttribute("aria-live", "polite");
  codexActions.style.display = "none";
  codexActions.append(
    codexAuthButton,
    codexDeviceAuthButton,
    codexRecheckButton,
    codexAuthStatus,
  );

  const modelHistory = doc.createElement("div");
  modelHistory.id = "paper-pilot-model-history";
  modelHistory.className = "pp-model-history";
  modelHistory.style.display = "none";

  popover.append(
    modeStatus,
    engineLabel,
    modeActions,
    modelRow,
    codexOptionsRow,
    modelHistory,
    codexActions,
  );
  root.append(trigger, newSessionButton, popover);
  params.mount.replaceWith(root);

  const clearModelSavedConfirmation = () => {
    modelSaveButton.removeAttribute("data-saved");
    modelSaveButton.textContent = MODEL_SAVE_LABEL;
    modelSaveStatus.textContent = "";
  };
  const onModelSelectionChange = () => {
    clearModelSavedConfirmation();
    syncModelSaveState(modelInput);
  };
  // Closing the popover discards a selection that was never saved, so the
  // picker and the header chip always show the saved default.
  const resetUnsavedModelSelection = () => {
    const savedModel = getSavedSelectValue(modelInput);
    if (savedModel !== undefined) modelInput.value = savedModel;
    const savedEffort = getSavedSelectValue(claudeEffortInput);
    if (savedEffort !== undefined) claudeEffortInput.value = savedEffort;
    clearModelSavedConfirmation();
    syncModelSaveState(modelInput);
  };
  const setOpen = (open: boolean, restoreFocus = false) => {
    if (!open && !popover.hidden) resetUnsavedModelSelection();
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
  const nativeSelectClickGuard = createNativeSelectClickGuard([
    modelInput,
    claudeEffortInput,
  ]);
  const onDocumentPointerDown = (event: PointerEvent) => {
    if (popover.hidden) return;
    nativeSelectClickGuard.notePointerDown(event);
  };
  const onDocumentClick = (event: MouseEvent) => {
    if (popover.hidden) return;
    const preservePopover = nativeSelectClickGuard.consumeClick(
      doc.activeElement,
    );
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
  modelInput.addEventListener("change", onModelSelectionChange);
  claudeEffortInput.addEventListener("change", onModelSelectionChange);
  doc.addEventListener("pointerdown", onDocumentPointerDown, true);
  doc.addEventListener("click", onDocumentClick);
  doc.addEventListener("keydown", onDocumentKeyDown, true);
  let disposed = false;

  return {
    root,
    trigger,
    modeChip,
    modeStatus,
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
    claudeEffortInput,
    modelSaveButton,
    codexOptionsRow,
    codexWebSearchToggle,
    modelHistory,
    setOpen,
    markModelSaved() {
      setSavedSelectValue(modelInput, modelInput.value);
      if (!claudeEffortInput.hidden) {
        setSavedSelectValue(claudeEffortInput, claudeEffortInput.value);
      }
      syncModelSaveState(modelInput);
      modelSaveButton.setAttribute("data-saved", "true");
      modelSaveButton.textContent = MODEL_SAVED_LABEL;
      modelSaveStatus.textContent = "Default model saved for all papers.";
    },
    setCodexAuthStatus(text: string) {
      setTextWithInlineCode(codexAuthStatus, text);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      trigger.removeEventListener("click", onTrigger);
      modelInput.removeEventListener("change", onModelSelectionChange);
      claudeEffortInput.removeEventListener("change", onModelSelectionChange);
      doc.removeEventListener("pointerdown", onDocumentPointerDown, true);
      doc.removeEventListener("click", onDocumentClick);
      doc.removeEventListener("keydown", onDocumentKeyDown, true);
    },
  };
}

/** Renders `code` spans from a short instruction without parsing HTML. */
function setTextWithInlineCode(element: HTMLElement, text: string) {
  const doc = element.ownerDocument;
  element.replaceChildren(
    ...text.split("`").map((part, index) => {
      if (index % 2 === 0) return doc.createTextNode(part);
      const code = doc.createElement("code");
      code.textContent = part;
      return code;
    }),
  );
}

/** Enables Save only for an unsaved selection and keeps a Saved confirmation. */
function syncModelSaveState(rowElement: HTMLElement) {
  const row = rowElement.closest?.(".pp-model-row");
  const modelInput = row?.querySelector(
    "#chat-codex-model",
  ) as HTMLSelectElement | null;
  const effortInput = row?.querySelector(
    "#chat-claude-effort",
  ) as HTMLSelectElement | null;
  const saveButton = row?.querySelector(
    "#chat-codex-model-save",
  ) as HTMLButtonElement | null;
  if (!modelInput || !saveButton) return;
  const dirty = isModelSelectionDirty({
    selectedModel: modelInput.value,
    savedModel: getSavedSelectValue(modelInput),
    effortVisible: Boolean(effortInput && !effortInput.hidden),
    selectedEffort: effortInput?.value,
    savedEffort: effortInput ? getSavedSelectValue(effortInput) : undefined,
  });
  saveButton.disabled = !dirty;
  if (dirty && saveButton.getAttribute("data-saved") === "true") {
    saveButton.removeAttribute("data-saved");
    saveButton.textContent = MODEL_SAVE_LABEL;
  }
}

/** Marks the active engine and labels the reset with the real default. */
export function renderEngineSelection(
  anchor: HTMLElement,
  state: {
    mode: EngineMode;
    defaultMode: EngineMode;
    hasOverride: boolean;
  },
) {
  const root = anchor.closest(".pp-pane-header");
  if (!root) return;
  const presentation = getEngineSelectionPresentation(state);
  root
    .querySelector("#chat-mode-claude")
    ?.setAttribute("aria-pressed", String(presentation.claudePressed));
  root
    .querySelector("#chat-mode-codex")
    ?.setAttribute("aria-pressed", String(presentation.codexPressed));
  const reset = root.querySelector(
    "#chat-mode-reset",
  ) as HTMLButtonElement | null;
  if (reset) {
    reset.textContent = presentation.resetLabel;
    reset.disabled = presentation.resetDisabled;
    reset.title = presentation.resetTitle;
  }
}

/** Authentication controls appear only when Codex needs them. */
export function renderCodexAuthActions(
  codexActions: HTMLElement,
  mode: EngineMode,
  loginState?: string,
) {
  const visible = shouldShowCodexAuthActions(mode, loginState);
  codexActions.style.display = visible ? "flex" : "none";
  if (!visible) {
    codexActions
      .querySelector("#paper-pilot-codex-auth-status")
      ?.replaceChildren();
  }
}

function getModeShortLabel(label: string) {
  if (label.includes("Claude")) return "Claude";
  return "Codex";
}

function findOptionByValue(select: HTMLSelectElement, value?: string) {
  if (value === undefined) return undefined;
  const options = Array.from(
    select.querySelectorAll("option"),
  ) as unknown as HTMLOptionElement[];
  return options.find((option) => option.value === value);
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
  // The chip shows the saved default, not an unsaved choice in the picker.
  const modelOption = modelInput
    ? (findOptionByValue(modelInput, getSavedSelectValue(modelInput)) ??
      modelInput.selectedOptions[0])
    : undefined;
  const modelLabel = modelOption?.textContent?.trim();
  const effortInput = root?.querySelector(
    "#chat-claude-effort",
  ) as HTMLSelectElement | null;
  const effortValue =
    effortInput && !effortInput.hidden
      ? (getSavedSelectValue(effortInput) ?? effortInput.value)
      : undefined;
  const effortLabel = effortValue || undefined;
  chip.textContent = [getModeShortLabel(label), modelLabel, effortLabel]
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
  if (mode === "claude_code") return "claudeDefaultModel";
  return "codexDefaultModel";
}

function getAllowedModelsPrefForMode(mode: EngineMode) {
  if (mode === "claude_code") return "claudeAllowedModels";
  return "codexAllowedModels";
}

function getFallbackModelForMode(mode: EngineMode) {
  if (mode === "claude_code") return getClaudeBuiltInModels()[0];
  return CODEX_DEFAULT_MODEL;
}

function getBuiltInModelsForMode(mode: EngineMode) {
  if (mode === "claude_code") return getClaudeBuiltInModels();
  return getCodexBuiltInModels();
}

export function normalizeModelForMode(mode: EngineMode, model: string) {
  if (mode === "claude_code") return normalizeClaudeModel(model);
  return normalizeCodexModel(model);
}

function normalizeModelListForMode(mode: EngineMode, models: string[]) {
  if (mode === "claude_code") return normalizeClaudeModelList(models);
  return normalizeCodexModelList(models);
}

export function renderModelHistory(
  modelHistory: HTMLElement,
  modelInput: HTMLSelectElement,
  mode: EngineMode,
) {
  const pending = captureUnsavedSelection(modelInput);
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
      optionMap.set(`${model}|`, getClaudeModelLabel(model));
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
        : getClaudeModelLabel(selectedValue);
    fallback.selected = true;
    modelInput.appendChild(fallback);
  }
  setSavedSelectValue(modelInput, currentKey);
  restoreUnsavedSelection(modelInput, pending);
  syncModelSaveState(modelInput);
  modelHistory.style.display = "none";
  modelHistory.replaceChildren();
}

export function renderClaudeEffortInput(
  effortInput: HTMLSelectElement,
  mode: EngineMode,
) {
  if (mode !== "claude_code") {
    effortInput.hidden = true;
    effortInput.replaceChildren();
    setSavedSelectValue(effortInput, undefined);
    syncModelSaveState(effortInput);
    return;
  }
  const pending = captureUnsavedSelection(effortInput);
  const current = normalizeClaudeReasoningEffort(
    String(getPref("claudeReasoningEffort") || ""),
  );
  const doc = effortInput.ownerDocument;
  effortInput.replaceChildren(
    ...["", ...getClaudeReasoningEfforts()].map((effort) => {
      const option = doc.createElement("option");
      option.value = effort;
      option.textContent = effort || "default effort";
      option.selected = effort === current;
      return option;
    }),
  );
  effortInput.hidden = false;
  setSavedSelectValue(effortInput, current);
  restoreUnsavedSelection(effortInput, pending);
  syncModelSaveState(effortInput);
}
