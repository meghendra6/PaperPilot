import { node } from "./dom";
import {
  STUDIO_PROVIDERS,
  providerLabel,
  type StudioAIConfig,
  type StudioAIDefaults,
} from "./aiContracts";

type Provider = StudioAIConfig["provider"];
const OTHER_MODEL = "__other__";
const LOCAL_ENDPOINT = "http://127.0.0.1:11434/v1";

/**
 * The assistant's engine picker: a provider switch and a model list from the
 * reader's engine settings. Each provider remembers its own model choice while
 * the window is open.
 */
export function engineBar(onChange: () => void) {
  const element = node("div", undefined, "engine-bar");
  const providers = node("fieldset", undefined, "engine-switch");
  providers.append(node("legend", "AI provider", "visually-hidden"));
  const radios = new Map<Provider, HTMLInputElement>();
  for (const { id, label } of STUDIO_PROVIDERS) {
    const option = node("label", undefined, "engine-option");
    const input = node("input", undefined, "visually-hidden");
    input.type = "radio";
    input.name = "studio-ai-provider";
    input.value = id;
    input.addEventListener("change", () => select(id));
    radios.set(id, input);
    option.append(input, node("span", label));
    providers.append(option);
  }
  const modelRow = node("div", undefined, "engine-model");
  const modelList = node("select");
  modelList.setAttribute("aria-label", "AI model");
  const modelText = node("input");
  modelText.setAttribute("aria-label", "AI model identifier");
  modelText.autocomplete = "off";
  modelText.spellcheck = false;
  modelRow.append(modelList, modelText);
  const local = node("div", undefined, "engine-local");
  const endpoint = node("input");
  endpoint.value = LOCAL_ENDPOINT;
  endpoint.setAttribute("aria-label", "Local model API base URL");
  endpoint.spellcheck = false;
  const key = node("input");
  key.type = "password";
  key.autocomplete = "off";
  key.placeholder = "API key (optional) · kept in this window only";
  key.setAttribute("aria-label", "Provider API key");
  local.append(endpoint, key);
  element.append(providers, modelRow, local);

  let defaults: StudioAIDefaults = { provider: "codex", codex: "", claude: "" };
  let provider: Provider = "codex";
  const chosen: Record<Provider, string> = { codex: "", claude: "", local: "" };

  const renderModels = () => {
    const choices = provider === "local" ? [] : defaults.models?.[provider];
    const current = chosen[provider];
    modelList.hidden = !choices?.length;
    modelList.replaceChildren();
    for (const choice of choices ?? []) {
      const option = node("option", choice.label);
      option.value = choice.value;
      modelList.append(option);
    }
    if (choices?.length) {
      const other = node("option", "Other model…");
      other.value = OTHER_MODEL;
      modelList.append(other);
      const listed = choices.some((choice) => choice.value === current);
      modelList.value = listed ? current : OTHER_MODEL;
      modelText.hidden = listed;
    } else modelText.hidden = false;
    modelText.value = current;
    modelText.placeholder =
      provider === "local"
        ? "Model name, for example llama3.1"
        : "Model identifier";
    local.hidden = provider !== "local";
    for (const [id, radio] of radios) radio.checked = id === provider;
  };
  const select = (next: Provider) => {
    provider = next;
    key.value = "";
    renderModels();
    onChange();
  };
  modelList.addEventListener("change", () => {
    if (modelList.value === OTHER_MODEL) {
      modelText.hidden = false;
      modelText.value = "";
      chosen[provider] = "";
      modelText.focus();
    } else {
      chosen[provider] = modelList.value;
      modelText.hidden = true;
    }
    onChange();
  });
  modelText.addEventListener("input", () => {
    chosen[provider] = modelText.value.trim();
    onChange();
  });
  renderModels();

  return {
    element,
    /** Applies host defaults, then an optional earlier provider and model. */
    setDefaults(next: StudioAIDefaults, preferred?: StudioAIConfig) {
      defaults = next;
      chosen.codex ||= next.codex;
      chosen.claude ||= next.claude;
      provider = next.provider === "claude" ? "claude" : "codex";
      if (
        preferred &&
        STUDIO_PROVIDERS.some((entry) => entry.id === preferred.provider)
      ) {
        provider = preferred.provider;
        if (preferred.model) chosen[provider] = preferred.model;
      }
      renderModels();
      onChange();
    },
    config(): StudioAIConfig {
      return {
        provider,
        model: chosen[provider].trim(),
        endpoint: endpoint.value.trim(),
        apiKey: key.value.trim(),
      };
    },
    /** "Claude Code · Opus (latest)" for status lines. */
    summary() {
      const value = chosen[provider];
      const label =
        defaults.models?.[provider as "codex" | "claude"]?.find(
          (choice) => choice.value === value,
        )?.label ?? value;
      return `${providerLabel(provider)}${label ? ` · ${label}` : ""}`;
    },
    disclosure() {
      return provider === "local"
        ? "Selected files are sent to the loopback endpoint. The endpoint controls where inference runs."
        : `Selected files go through ${providerLabel(provider)} to its model provider.`;
    },
    setDisabled(disabled: boolean) {
      element.inert = disabled;
      element.classList.toggle("is-disabled", disabled);
    },
  };
}
