/**
 * Context status shown above the composer. Warnings come first and stay
 * fully visible. Routine diagnostics fit on one ellipsized line.
 */
export interface ChatContextStatus {
  warnings: readonly string[];
  /** Continuity mode plus prior turn, pin, and omission counts. */
  continuity: string;
  /** Preparation and answer timing, added after a run completes. */
  timing?: string;
  /** Paper title and attachment key. */
  source: string;
}

const SEPARATOR = " · ";

function joinSegments(segments: readonly (string | undefined)[]) {
  return segments
    .map((segment) => segment?.trim() ?? "")
    .filter(Boolean)
    .join(SEPARATOR);
}

export function buildChatContextStatus(params: {
  continuityMode: string;
  paperTitle: string;
  attachmentKey: string;
  includedTurns: number;
  includedPins: number;
  usedSummary: boolean;
  omitted: number;
  warnings: readonly string[];
}): ChatContextStatus {
  const counts = `${params.includedTurns} prior turns, ${params.includedPins} pins${params.usedSummary ? ", summary" : ""}; ${params.omitted} omitted`;
  return {
    warnings: Array.from(
      new Set(params.warnings.map((warning) => warning.trim())),
    ).filter(Boolean),
    continuity: joinSegments([params.continuityMode, counts]),
    source: joinSegments([params.paperTitle, params.attachmentKey]),
  };
}

export function withChatContextTiming(
  status: ChatContextStatus | undefined,
  timing: string,
): ChatContextStatus {
  return {
    warnings: status?.warnings ?? [],
    continuity: status?.continuity ?? "",
    source: status?.source ?? "",
    timing,
  };
}

/** One-line diagnostics. Timing sits before the long paper identity. */
export function formatChatContextDetails(status: ChatContextStatus) {
  return joinSegments([status.continuity, status.timing, status.source]);
}

export function renderChatContextStatus(
  element: Element,
  status: ChatContextStatus,
) {
  const doc = element.ownerDocument;
  const nodes: HTMLElement[] = status.warnings.map((warning) => {
    const node = doc.createElement("span");
    node.className = "pp-chat-context-status__warning";
    node.textContent = warning;
    return node;
  });
  const details = formatChatContextDetails(status);
  if (details) {
    const node = doc.createElement("span");
    node.className = "pp-chat-context-status__details";
    node.textContent = details;
    node.title = details;
    nodes.push(node);
  }
  element.replaceChildren(...nodes);
}
