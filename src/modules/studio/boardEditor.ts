import { node, type TextSurface } from "./dom";
import { moveCard, parseBoard, type BoardCard } from "./board";
import type { StudioDocument } from "./contracts";

/** Planning state is file-local; it never changes research screening/reading states. */
export function boardEditor(
  host: HTMLElement,
  source: string,
  readOnly: boolean,
  changed: () => void,
  documents: StudioDocument[],
  open: (id: string) => Promise<void>,
): TextSurface {
  const board = parseBoard(source);
  let modified = false;
  let dragged: string | undefined;
  let graph = false;
  const shell = node("div", undefined, "board-surface");
  const controls = node("div", undefined, "surface-controls");
  const search = node("input");
  search.placeholder = "Filter titles, descriptions or labels";
  search.setAttribute("aria-label", "Filter board cards");
  const archived = node("input");
  archived.type = "checkbox";
  const archivedLabel = node("label", " Archived cards");
  archivedLabel.prepend(archived);
  const area = node("div", undefined, "board-columns");
  const status = node("output");
  status.setAttribute("aria-live", "polite");
  const error = (cause: unknown) => {
    status.textContent = String(cause);
  };
  const save = () => {
    modified = true;
    changed();
  };
  const button = (
    label: string,
    action: () => unknown | Promise<unknown>,
    mutation = false,
  ) => {
    const item = node("button", label);
    item.disabled = mutation && readOnly;
    item.onclick = () => void Promise.resolve().then(action).catch(error);
    return item;
  };
  controls.append(
    search,
    archivedLabel,
    button(
      "Add column",
      () => {
        if (board.columns.length >= 30)
          throw new Error("A board supports at most 30 columns.");
        board.columns.push({ id: crypto.randomUUID(), title: "New column" });
        save();
        render();
      },
      true,
    ),
    button("Links graph", () => {
      graph = !graph;
      render();
    }),
    status,
  );
  shell.append(controls, area);
  host.append(shell);
  search.oninput = render;
  archived.onchange = render;
  function visible(card: BoardCard) {
    return (
      card.archived === archived.checked &&
      `${card.title} ${card.description} ${card.labels.join(" ")}`
        .toLocaleLowerCase()
        .includes(search.value.toLocaleLowerCase())
    );
  }
  function renderGraph(cards: BoardCard[]) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    const linked = documents.filter((doc) =>
      cards.some((card) => card.documentIDs.includes(doc.id)),
    );
    const count = Math.max(cards.length, linked.length, 1);
    svg.setAttribute("viewBox", `0 0 900 ${count * 72 + 30}`);
    svg.setAttribute("role", "group");
    svg.setAttribute(
      "aria-label",
      "Links from planning cards to project documents",
    );
    const text = (x: number, y: number, label: string) => {
      const item = document.createElementNS(ns, "text");
      item.setAttribute("x", String(x));
      item.setAttribute("y", String(y));
      item.textContent = label.length > 48 ? `${label.slice(0, 45)}…` : label;
      return item;
    };
    cards.forEach((card, index) => {
      for (const id of card.documentIDs) {
        const target = linked.findIndex((doc) => doc.id === id);
        if (target < 0) continue;
        const line = document.createElementNS(ns, "line");
        for (const [key, value] of Object.entries({
          x1: 380,
          y1: index * 72 + 35,
          x2: 490,
          y2: target * 72 + 35,
          stroke: "#a2b6bb",
        }))
          line.setAttribute(key, String(value));
        svg.append(line);
      }
      svg.append(text(15, index * 72 + 40, card.title || "Untitled card"));
    });
    linked.forEach((doc, index) => {
      const label = text(500, index * 72 + 40, doc.name);
      label.setAttribute("role", "link");
      label.setAttribute("tabindex", "0");
      label.setAttribute("aria-label", `Open ${doc.name}`);
      label.addEventListener("click", () => void open(doc.id).catch(error));
      label.addEventListener("keydown", (event) => {
        if (event.key === "Enter") void open(doc.id).catch(error);
      });
      svg.append(label);
    });
    area.append(svg);
    if (!linked.length)
      area.append(
        node("p", "Link project files from a card to show connections."),
      );
  }
  function render() {
    area.replaceChildren();
    area.classList.toggle("board-graph", graph);
    const cards = board.cards.filter(visible);
    status.textContent = `${cards.length} cards`;
    if (graph) {
      renderGraph(cards);
      return;
    }
    for (const column of board.columns) {
      const lane = node("section", undefined, "board-column");
      const name = node("input");
      name.value = column.title;
      name.readOnly = readOnly;
      name.setAttribute("aria-label", `Column ${column.title}`);
      name.onchange = () => {
        if (name.value.trim()) {
          column.title = name.value.trim();
          save();
        } else name.value = column.title;
      };
      lane.append(
        name,
        button(
          "Add card",
          () => {
            if (board.cards.length >= 2000)
              throw new Error(
                "A board supports at most 2,000 cards, including archived cards.",
              );
            board.cards.push({
              id: crypto.randomUUID(),
              columnID: column.id,
              title: "Untitled card",
              description: "",
              labels: [],
              documentIDs: [],
              archived: false,
            });
            archived.checked = false;
            search.value = "";
            save();
            render();
          },
          true,
        ),
      );
      if (
        board.columns.length > 1 &&
        !board.cards.some((card) => card.columnID === column.id)
      )
        lane.append(
          button(
            "Remove empty column",
            () => {
              board.columns = board.columns.filter(
                (entry) => entry.id !== column.id,
              );
              save();
              render();
            },
            true,
          ),
        );
      lane.ondragover = (event) => {
        if (!readOnly && dragged) event.preventDefault();
      };
      lane.ondrop = (event) => {
        if (readOnly || !dragged) return;
        event.preventDefault();
        moveCard(board, dragged, column.id);
        dragged = undefined;
        save();
        render();
      };
      for (const card of cards.filter((card) => card.columnID === column.id)) {
        const item = node("article", undefined, "board-card");
        item.draggable = !readOnly;
        item.ondragstart = (event) => {
          dragged = card.id;
          event.dataTransfer?.setData("text/plain", card.id);
        };
        item.ondragend = () => {
          dragged = undefined;
        };
        item.ondragover = (event) => {
          if (!readOnly && dragged) event.preventDefault();
        };
        item.ondrop = (event) => {
          if (readOnly || !dragged) return;
          event.preventDefault();
          event.stopPropagation();
          moveCard(board, dragged, column.id, card.id);
          dragged = undefined;
          save();
          render();
        };
        const title = node("input");
        title.value = card.title;
        title.readOnly = readOnly;
        title.setAttribute("aria-label", "Card title");
        title.oninput = () => {
          card.title = title.value;
          save();
        };
        const description = node("textarea");
        description.value = card.description;
        description.readOnly = readOnly;
        description.rows = 3;
        description.setAttribute("aria-label", "Card description");
        description.oninput = () => {
          card.description = description.value;
          save();
        };
        const labels = node("input");
        labels.value = card.labels.join(", ");
        labels.readOnly = readOnly;
        labels.placeholder = "Labels, separated by commas";
        labels.setAttribute("aria-label", "Card labels");
        labels.oninput = () => {
          card.labels = [
            ...new Set(
              labels.value
                .split(",")
                .map((label) => label.trim())
                .filter(Boolean),
            ),
          ];
          save();
        };
        const state = node("select");
        state.disabled = readOnly;
        state.setAttribute("aria-label", "Move card to column");
        for (const destination of board.columns) {
          const option = node("option", destination.title);
          option.value = destination.id;
          state.append(option);
        }
        state.value = card.columnID;
        state.onchange = () => {
          moveCard(board, card.id, state.value);
          save();
          render();
        };
        const links = node("details");
        const linkSummary = node(
          "summary",
          `Project files (${card.documentIDs.length})`,
        );
        links.append(linkSummary);
        for (const doc of documents) {
          const input = node("input");
          input.type = "checkbox";
          input.checked = card.documentIDs.includes(doc.id);
          input.disabled = readOnly;
          input.onchange = () => {
            card.documentIDs = input.checked
              ? [...card.documentIDs, doc.id]
              : card.documentIDs.filter((id) => id !== doc.id);
            linkSummary.textContent = `Project files (${card.documentIDs.length})`;
            save();
          };
          const label = node("label", ` ${doc.name}`);
          label.prepend(input);
          links.append(label);
          if (input.checked)
            links.append(button(`Open ${doc.name}`, () => open(doc.id)));
        }
        const missing = card.documentIDs.filter(
          (id) => !documents.some((doc) => doc.id === id),
        );
        if (missing.length)
          links.append(
            node(
              "p",
              `${missing.length} linked files are unavailable. Their identifiers are preserved.`,
            ),
          );
        item.append(
          title,
          description,
          labels,
          state,
          links,
          button(
            card.archived ? "Restore card" : "Archive card",
            () => {
              card.archived = !card.archived;
              save();
              render();
            },
            true,
          ),
        );
        lane.append(item);
      }
      area.append(lane);
    }
  }
  render();
  return {
    text: () => (modified ? JSON.stringify(board, null, 2) + "\n" : source),
    selectedText: () => "",
    insert: () => {
      throw new Error("Edit a card field or use source view.");
    },
    destroy: () => shell.remove(),
  };
}
