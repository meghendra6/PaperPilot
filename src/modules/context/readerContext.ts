export async function getCurrentReaderContext() {
  const reader = await ztoolkit.Reader.getReader();
  if (!reader) {
    return {};
  }

  const annotation =
    ztoolkit.Reader.getSelectedAnnotationData?.(reader) ??
    reader._state?.selectedAnnotationIDs?.[0];

  const viewStats = reader._state?.primaryViewStats;
  return {
    selectedText: ztoolkit.Reader.getSelectedText?.(reader) ?? "",
    pageLabel:
      annotation && typeof annotation === "object" && "pageLabel" in annotation
        ? String((annotation as { pageLabel?: string }).pageLabel || "")
        : String(viewStats?.pageLabel || ""),
    pageIndex:
      annotation && typeof annotation === "object" && "position" in annotation
        ? (annotation as { position?: { pageIndex?: number } }).position
            ?.pageIndex
        : viewStats?.pageIndex,
  };
}
