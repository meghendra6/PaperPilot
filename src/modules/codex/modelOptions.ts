declare const Zotero: any;

export function parseAllowedModels(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function mergeModelOptions(recent: string[], allowed: string[]) {
  return [...new Set([...recent, ...allowed])];
}

export function getGeminiBuiltInModels() {
  return [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
  ];
}

export interface CachedCodexModel {
  slug: string;
  displayName: string;
  reasoningEfforts: string[];
  defaultReasoningEffort?: string;
}

function getUserHomeFromProfilePath() {
  const profilePath = Zotero.getProfileDirectory()?.path || "";
  return profilePath.includes("/Library/")
    ? profilePath.split("/Library/")[0]
    : "";
}

export async function loadCodexCachedModels() {
  const userHome = getUserHomeFromProfilePath();
  if (!userHome) {
    return [];
  }

  const cachePath = `${userHome}/.codex/models_cache.json`;

  try {
    const raw = await Promise.resolve(
      Zotero.File.getContentsAsync(cachePath, "utf-8"),
    );
    const parsed = JSON.parse(String(raw || "{}")) as {
      models?: Array<{
        slug?: string;
        display_name?: string;
        visibility?: string;
      }>;
    };
    const models = Array.isArray(parsed.models) ? parsed.models : [];

    return models
      .filter((model) => model.visibility !== "hidden")
      .map((model) => model.slug || model.display_name || "")
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function loadCodexCachedModelCatalog(): Promise<
  CachedCodexModel[]
> {
  const userHome = getUserHomeFromProfilePath();
  if (!userHome) {
    return [];
  }

  const cachePath = `${userHome}/.codex/models_cache.json`;

  try {
    const raw = await Promise.resolve(
      Zotero.File.getContentsAsync(cachePath, "utf-8"),
    );
    const parsed = JSON.parse(String(raw || "{}")) as {
      models?: Array<{
        slug?: string;
        display_name?: string;
        visibility?: string;
        supported_reasoning_levels?: Array<{ effort?: string }>;
        default_reasoning_level?: string;
      }>;
    };
    const models = Array.isArray(parsed.models) ? parsed.models : [];

    return models
      .filter(
        (model) =>
          model.visibility !== "hidden" && (model.slug || model.display_name),
      )
      .map((model) => {
        const efforts = (model.supported_reasoning_levels || [])
          .map((level) => String(level.effort || "").trim())
          .filter(Boolean);

        return {
          slug: String(model.slug || model.display_name || ""),
          displayName: String(model.display_name || model.slug || ""),
          reasoningEfforts: efforts,
          defaultReasoningEffort: model.default_reasoning_level,
        } satisfies CachedCodexModel;
      })
      .filter((model) => Boolean(model.slug));
  } catch {
    return [];
  }
}
