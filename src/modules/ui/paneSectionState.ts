export type PaneSectionID = "workbench" | "related" | "sessions";

export type PaneSectionState = Record<PaneSectionID, boolean>;

export const DEFAULT_PANE_SECTION_STATE: PaneSectionState = {
  workbench: true,
  related: false,
  sessions: false,
};

const SECTION_IDS: PaneSectionID[] = ["workbench", "related", "sessions"];

export function parsePaneSectionState(
  value: unknown,
  defaults: PaneSectionState = DEFAULT_PANE_SECTION_STATE,
): PaneSectionState {
  let candidate: unknown = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value);
    } catch {
      return { ...defaults };
    }
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ...defaults };
  }

  const record = candidate as Record<string, unknown>;
  const state = { ...defaults };
  for (const id of SECTION_IDS) {
    if (typeof record[id] === "boolean") {
      state[id] = record[id];
    }
  }
  return state;
}

export function serializePaneSectionState(value: PaneSectionState): string {
  const normalized = parsePaneSectionState(value);
  return JSON.stringify({
    workbench: normalized.workbench,
    related: normalized.related,
    sessions: normalized.sessions,
  });
}
