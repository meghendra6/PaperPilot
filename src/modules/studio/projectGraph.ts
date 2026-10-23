import { node } from "./dom";
import type { StudioRepository } from "./repository";

export function projectGraph(
  data: Awaited<ReturnType<StudioRepository["links"]>>,
  activeID: string | undefined,
  open: (id: string) => Promise<void>,
) {
  const dialog = node("dialog");
  dialog.setAttribute("aria-label", "Project links graph");
  const filter = node("select");
  filter.setAttribute("aria-label", "Focus document links");
  const all = node("option", "All project links");
  all.value = "";
  filter.append(all);
  for (const doc of data.manifest.documents) {
    const option = node("option", doc.name);
    option.value = doc.id;
    filter.append(option);
  }
  filter.value = activeID ?? "";
  const area = node("section");
  const close = node("button", "Close links graph");
  close.onclick = () => dialog.close();
  const render = () => {
    area.replaceChildren();
    const edges = data.edges.filter(
      (edge) =>
        !filter.value || edge.from === filter.value || edge.to === filter.value,
    );
    area.append(
      node(
        "p",
        `${edges.length} links · literal document references, board cards and recorded notebook outputs`,
      ),
    );
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute(
      "viewBox",
      `0 0 800 ${Math.max(1, Math.min(edges.length, 50)) * 36}`,
    );
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      "Document links; open either endpoint in the list below",
    );
    const label = (x: number, y: number, value: string) => {
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", String(x));
      text.setAttribute("y", String(y));
      text.setAttribute("fill", "currentColor");
      text.setAttribute("font-size", "12");
      text.textContent = value.slice(0, 43);
      return text;
    };
    const rows = node("ul");
    for (const [index, edge] of edges.entries()) {
      const from = data.manifest.documents.find((doc) => doc.id === edge.from);
      const to = data.manifest.documents.find((doc) => doc.id === edge.to);
      const source = from?.name ?? edge.from;
      const target = `${to?.name ?? edge.label}${to?.archived ? " (archived)" : !to ? " (unavailable)" : ""}`;
      if (index < 50) {
        const line = document.createElementNS(ns, "line");
        for (const [key, value] of Object.entries({
          x1: 295,
          x2: 475,
          y1: index * 36 + 18,
          y2: index * 36 + 18,
          stroke: "currentColor",
        }))
          line.setAttribute(key, String(value));
        svg.append(
          line,
          label(5, index * 36 + 22, source),
          label(480, index * 36 + 22, target),
        );
      }
      const row = node("li");
      for (const [name, id] of [
        [source, from?.id],
        [target, to?.id],
      ]) {
        const item = node(id ? "button" : "span", name);
        if (id)
          item.addEventListener("click", () => {
            dialog.close();
            void open(id);
          });
        row.append(item, node("span", " "));
      }
      row.append(node("small", `${edge.kind}: ${edge.label}`));
      rows.append(row);
    }
    if (edges.length) area.append(svg, rows);
    else area.append(node("p", "No links found for this selection."));
    if (edges.length > 50)
      area.append(
        node(
          "p",
          "Diagram shows the first 50 links; the list includes every match.",
        ),
      );
  };
  filter.onchange = render;
  dialog.append(
    node("h2", "Project links"),
    node(
      "p",
      "Dynamic code paths, arbitrary binary links and external URLs are not inferred. Archived files and missing targets remain visible.",
    ),
    filter,
    area,
    close,
  );
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  render();
  dialog.showModal();
}
