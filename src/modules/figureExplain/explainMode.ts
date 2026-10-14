/** An armed toolbar mode expires so a forgotten click cannot start a run later. */
export const EXPLAIN_MODE_TIMEOUT_MS = 2 * 60 * 1000;
/** Zotero stores dateAdded in whole seconds, so allow the truncation. */
const DATE_ADDED_TOLERANCE_MS = 2_000;

/** One reader waiting for the area that the reader is about to draw. */
export interface ArmedFigureReader {
  readerID: string;
  attachmentID: number;
  /** Zotero tool to restore after the area is drawn or the mode is cancelled. */
  previousTool: string;
  armedAt: number;
}

export interface AddedAnnotation {
  key?: string;
  annotationType?: string;
  parentItemID?: number;
  /** Creation time in milliseconds, when known. */
  dateAdded?: number;
}

/**
 * Returns the armed reader that a newly saved annotation completes. Only an
 * area (image) annotation of the same PDF counts, created after arming and
 * before expiry, so a synced or imported older area cannot complete it.
 */
export function matchArmedArea(
  armed: readonly ArmedFigureReader[],
  annotation: AddedAnnotation,
  now: number,
): ArmedFigureReader | undefined {
  if (annotation.annotationType !== "image" || !annotation.key)
    return undefined;
  const created = annotation.dateAdded;
  return armed.find(
    (entry) =>
      entry.attachmentID === Number(annotation.parentItemID) &&
      now - entry.armedAt <= EXPLAIN_MODE_TIMEOUT_MS &&
      (created === undefined ||
        !Number.isFinite(created) ||
        created >= entry.armedAt - DATE_ADDED_TOLERANCE_MS),
  );
}

/** The tool to restore; an armed mode never restores the area tool itself. */
export function restorableTool(tool: unknown): string {
  const type = String(tool || "");
  return type && type !== "image" ? type : "pointer";
}

export interface WindowFrame {
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
}

export interface ScreenArea {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
}

const WINDOW_MARGIN = 24;
const WINDOW_TOP_OFFSET = 72;

/**
 * Places the explanation window inside the right edge of the Zotero window,
 * so the PDF figure in the middle stays visible next to its explanation.
 * Zotero 10 can report a main-window origin outside the screen (seen as the
 * screen's far corner), so the frame is clamped onto the screen first.
 */
export function figureWindowPosition(
  main: WindowFrame,
  size: { width: number; height: number },
  screen: ScreenArea,
): { left: number; top: number } {
  const clamp = (value: number, min: number, max: number) =>
    Math.round(Math.max(min, Math.min(value, Math.max(min, max))));
  const right = screen.availLeft + screen.availWidth;
  const bottom = screen.availTop + screen.availHeight;
  const width = Math.min(main.outerWidth, screen.availWidth);
  const mainLeft = clamp(main.screenX, screen.availLeft, right - width);
  const mainTop = clamp(
    main.screenY,
    screen.availTop,
    bottom - Math.min(main.outerHeight, screen.availHeight),
  );
  return {
    left: clamp(
      mainLeft + width - size.width - WINDOW_MARGIN,
      screen.availLeft,
      right - size.width,
    ),
    top: clamp(
      mainTop + WINDOW_TOP_OFFSET,
      screen.availTop,
      bottom - size.height,
    ),
  };
}
