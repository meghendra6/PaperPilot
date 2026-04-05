function sanitizeSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function buildPaperWorkspacePath(params: {
  root: string;
  itemID: number;
  title: string;
}) {
  const slug = sanitizeSegment(params.title) || `paper-${params.itemID}`;
  return `${params.root.replace(/\/+$/, "")}/${params.itemID}-${slug}`;
}
