import { node } from "./dom";
import {
  citationKeys,
  formatReferences,
  parseReferences,
  referencesBibTeX,
  validateReferences,
  type StudioReference,
} from "./references";
import type { StudioDocument } from "./contracts";
import type { ReferencePassage } from "./referenceEvidence";

export function referencePanel(
  host: HTMLElement,
  actions: {
    request<T>(method: string, payload?: unknown): Promise<T>;
    documents(): StudioDocument[];
    activeName(): string | undefined;
    activeID(): string | undefined;
    save(): Promise<void>;
    create(name: string, text: string): Promise<void>;
    insert(text: string, targetID?: string): Promise<void>;
    wordReferences(
      records: StudioReference[],
      style: string,
      xml: string | undefined,
      bibliography: boolean,
      targetID?: string,
    ): Promise<void>;
  },
) {
  const panel = node("section", undefined, "reference-panel");
  panel.hidden = true;
  panel.id = "studio-references";
  let opener: HTMLElement | undefined;
  const close = (restoreFocus = true) => {
    panel.hidden = true;
    host.classList.remove("with-references");
    opener?.setAttribute("aria-expanded", "false");
    if (restoreFocus) opener?.focus();
  };
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      close();
    }
  });
  panel.setAttribute("aria-label", "Project references");
  const heading = node("div", undefined, "panel-heading");
  const status = node("output");
  status.setAttribute("aria-live", "polite");
  const fail = (error: unknown) => {
    status.textContent = error instanceof Error ? error.message : String(error);
  };
  const button = (label: string, action: () => unknown | Promise<unknown>) => {
    const item = node("button", label);
    item.onclick = () => void Promise.resolve().then(action).catch(fail);
    return item;
  };
  const closeButton = button("×", () => close());
  closeButton.className = "icon-button";
  closeButton.setAttribute("aria-label", "Close references");
  closeButton.title = "Close references";
  heading.append(node("h2", "References"), closeButton);
  const file = node("select");
  file.setAttribute("aria-label", "Reference file");
  const style = node("select");
  style.setAttribute("aria-label", "Citation style");
  for (const [id, label] of [
    ["apa", "APA"],
    ["vancouver", "Vancouver"],
    ["harvard1", "Harvard"],
  ]) {
    const option = node("option", label);
    option.value = id;
    style.append(option);
  }
  const filter = node("input");
  filter.placeholder = "Find a reference";
  filter.setAttribute("aria-label", "Find a reference");
  const list = node("div", undefined, "reference-list");
  const preview = node("pre", undefined, "reference-preview");
  const selected = new Set<string>();
  let records: StudioReference[] = [];
  let busy = false;
  let loading = false;
  let loadGeneration = 0;
  const guarded = async (action: () => Promise<unknown>) => {
    if (busy) return;
    if (loading)
      throw new Error("Wait for the reference file to finish loading.");
    const focused = document.activeElement as HTMLElement | null;
    busy = true;
    panel.inert = true;
    panel.setAttribute("aria-busy", "true");
    try {
      return await action();
    } finally {
      busy = false;
      panel.inert = false;
      panel.removeAttribute("aria-busy");
      // Inert moved focus to the body; return it to the control that ran the
      // action, or to the panel's first step when that control is now hidden.
      if (!panel.hidden && document.activeElement === document.body)
        (focused?.isConnected && focused.getClientRects().length
          ? focused
          : primaryControl()
        ).focus();
    }
  };
  const format = async (kind: "citation" | "bibliography") => {
    const styleID = style.value;
    const xml = styleID.startsWith("zotero:")
      ? await actions.request<string>("references.style", {
          id: styleID.slice(7),
        })
      : undefined;
    return formatReferences(records, [...selected], styleID, kind, xml);
  };
  const toolbar = node("div", undefined, "surface-controls");
  const wordToolbar = node("div", undefined, "surface-controls");
  wordToolbar.append(
    button("Insert Word citation field", () =>
      guarded(async () => {
        const targetID = actions.activeID();
        const xml = style.value.startsWith("zotero:")
          ? await actions.request<string>("references.style", {
              id: style.value.slice(7),
            })
          : undefined;
        await actions.wordReferences(
          records.filter((record) => selected.has(record.id)),
          style.value,
          xml,
          false,
          targetID,
        );
        status.textContent =
          "Word citation field inserted; document-wide citation text refreshed.";
      }),
    ),
    button("Refresh Word citations and bibliography", () =>
      guarded(async () => {
        const targetID = actions.activeID();
        const xml = style.value.startsWith("zotero:")
          ? await actions.request<string>("references.style", {
              id: style.value.slice(7),
            })
          : undefined;
        await actions.wordReferences([], style.value, xml, true, targetID);
        status.textContent =
          "Word citation fields and bibliography refreshed from all citations in this draft.";
      }),
    ),
  );
  toolbar.append(
    button("Preview bibliography", () =>
      guarded(async () => {
        preview.textContent = await format("bibliography");
      }),
    ),
    button("Insert formatted citation", () =>
      guarded(async () => {
        const targetID = actions.activeID();
        await actions.insert(await format("citation"), targetID);
        status.textContent = "Formatted citation inserted as text.";
      }),
    ),
    button("Insert citation keys", () =>
      guarded(async () => {
        const targetID = actions.activeID();
        await actions.insert(
          citationKeys(actions.activeName() ?? "", [...selected]),
          targetID,
        );
        status.textContent = "Citation keys inserted.";
      }),
    ),
    button("Insert bibliography", () =>
      guarded(async () => {
        const targetID = actions.activeID();
        await actions.insert(`\n${await format("bibliography")}\n`, targetID);
        status.textContent = "Bibliography inserted as text.";
      }),
    ),
  );
  const importZotero = button("Import project Zotero references", () =>
    guarded(async () => {
      await actions.save();
      const result = await actions.request<{
        records: StudioReference[];
        skipped: string[];
      }>("references.zotero");
      if (!result.records.length)
        throw new Error("No available Zotero reference items in this project.");
      await actions.create(
        `references/zotero-${Date.now()}.bib`,
        referencesBibTeX(result.records),
      );
      await loadFiles(true);
      status.textContent = `${result.records.length} reference snapshots imported.${result.skipped.length ? ` Unavailable: ${result.skipped.join(", ")}` : ""}`;
    }),
  );
  const manual = node("details");
  manual.append(node("summary", "Add a manual reference"));
  const fields: Record<string, HTMLInputElement> = {};
  for (const [key, label] of [
    ["key", "Citation key"],
    ["title", "Reference title"],
    ["authors", "Authors (separate with semicolons)"],
    ["year", "Publication year"],
    ["journal", "Journal or publisher"],
    ["doi", "DOI (optional)"],
  ]) {
    const input = node("input");
    input.placeholder = label;
    input.setAttribute("aria-label", label);
    fields[key] = input;
    manual.append(input);
  }
  const type = node("select");
  type.setAttribute("aria-label", "Reference type");
  for (const [id, label] of [
    ["article-journal", "Journal article"],
    ["book", "Book"],
    ["paper-conference", "Conference paper"],
    ["report", "Report"],
    ["webpage", "Webpage"],
    ["dataset", "Dataset"],
  ]) {
    const option = node("option", label);
    option.value = id;
    type.append(option);
  }
  manual.append(
    type,
    button("Save manual reference", () =>
      guarded(async () => {
        const year = fields.year.value.trim();
        if (year && !/^\d{4}$/.test(year))
          throw new Error(
            "Use a four-digit publication year or leave it empty.",
          );
        const reference = validateReferences([
          {
            id: fields.key.value.trim(),
            title: fields.title.value.trim(),
            type: type.value,
            author: fields.authors.value
              .split(";")
              .map((name) => name.trim())
              .filter(Boolean)
              .map((name) => {
                const parts = name.split(",").map((part) => part.trim());
                return parts.length === 2
                  ? { family: parts[0], given: parts[1] }
                  : { literal: name };
              }),
            ...(year ? { issued: { "date-parts": [[Number(year)]] } } : {}),
            ...(fields.doi.value.trim()
              ? { DOI: fields.doi.value.trim() }
              : {}),
            ...(fields.journal.value.trim()
              ? {
                  [type.value === "book" ? "publisher" : "container-title"]:
                    fields.journal.value.trim(),
                }
              : {}),
          },
        ]);
        await actions.create(
          `references/${reference[0].id}-${Date.now()}.bib`,
          referencesBibTeX(reference),
        );
        await loadFiles(true);
        status.textContent = "Manual reference saved locally.";
      }),
    ),
  );
  const help = node("details");
  help.append(
    node("summary", "About citation formats"),
    node(
      "p",
      "Word citation fields can be refreshed after moving citations or changing style. Word uses its own style engine when refreshing. Keep the original reference file for full metadata. Text citations are independent snapshots; source documents can use citation keys.",
      "dialog-hint",
    ),
  );
  const sources = node("details");
  sources.append(node("summary", "Add sources"), importZotero, manual);
  const otherFormats = node("details");
  otherFormats.append(node("summary", "Text citations & keys"), toolbar);
  const targetNotice = node("p", undefined, "reference-target");
  const fileLabel = node("label", "Reference file");
  fileLabel.append(file);
  const styleLabel = node("label", "Citation style");
  styleLabel.append(style);
  let targetIsWord: boolean | undefined;
  let hasFiles = false;
  /** The search field, the empty state's import action, or Close. */
  const primaryControl = (): HTMLElement =>
    [filter, importFirst, closeButton].find(
      (control) => control.getClientRects().length > 0,
    ) ?? closeButton;
  const refreshTarget = () => {
    const name = actions.activeName();
    const word = !!name && /\.docx$/i.test(name);
    wordToolbar.hidden = !word || !hasFiles;
    otherFormats.hidden = !hasFiles;
    targetNotice.textContent = name
      ? `Insert into ${name}`
      : "Open a draft to insert a citation.";
    if (targetIsWord !== word) otherFormats.open = !word;
    targetIsWord = word;
  };
  // Without a reference file, the first step is adding sources.
  const empty = node("div", undefined, "reference-empty");
  empty.hidden = true;
  const addManual = button("Add one manually", () => {
    sources.open = true;
    manual.open = true;
    fields.key.focus();
  });
  const importFirst = button("Import project Zotero references", () =>
    importZotero.click(),
  );
  importFirst.className = "primary";
  empty.append(
    node("strong", "No reference files yet"),
    node(
      "p",
      "Import this project's Zotero papers as a BibTeX snapshot, or add a reference by hand. Citations then insert into the open draft.",
    ),
    importFirst,
    addManual,
  );
  panel.append(
    heading,
    targetNotice,
    empty,
    fileLabel,
    styleLabel,
    filter,
    list,
    wordToolbar,
    otherFormats,
    preview,
    status,
    sources,
    help,
  );
  host.append(panel);
  function render() {
    list.replaceChildren();
    for (const record of records.filter((record) =>
      `${record.id} ${record.title} ${JSON.stringify(record.author ?? [])}`
        .toLocaleLowerCase()
        .includes(filter.value.toLocaleLowerCase()),
    )) {
      const input = node("input");
      input.type = "checkbox";
      input.checked = selected.has(record.id);
      input.onchange = () => {
        if (input.checked) selected.add(record.id);
        else selected.delete(record.id);
      };
      const label = node("label", ` ${record.id} · ${record.title}`);
      label.prepend(input);
      list.append(label);
      if (/^pp_\d+_/.test(record.id))
        list.append(
          button(`Verified passages for ${record.id}`, () =>
            guarded(async () => {
              const passages = await actions.request<
                Array<Omit<ReferencePassage, "reference">>
              >("references.passages", { citationKey: record.id });
              preview.replaceChildren(
                node("strong", `${record.title} · supporting passages`),
              );
              if (!passages.length)
                preview.append(
                  node(
                    "p",
                    "No current verified passages are available. Run an evidence workflow in Research Workspace first; imported historical snapshots are not current source bindings.",
                  ),
                );
              for (const passage of passages)
                preview.append(
                  node("blockquote", passage.quote),
                  node("p", `Page ${passage.page} · ${passage.statement}`),
                  button("Verify and open exact PDF passage", () =>
                    guarded(async () => {
                      await actions.request("references.openPassage", {
                        citationKey: record.id,
                        atomID: passage.atomID,
                        evidenceIndex: passage.evidenceIndex,
                      });
                      status.textContent =
                        "Passage verified against the current PDF and opened in Zotero.";
                    }),
                  ),
                );
            }),
          ),
        );
    }
  }
  async function load() {
    const generation = ++loadGeneration;
    const fileID = file.value;
    loading = true;
    toolbar.inert = wordToolbar.inert = true;
    records = [];
    selected.clear();
    preview.textContent = "";
    status.textContent = "Loading references…";
    render();
    try {
      if (fileID) {
        const saved = await actions.request<{
          document: StudioDocument;
          base64: string;
        }>("read", { id: fileID });
        if (generation !== loadGeneration || file.value !== fileID) return;
        records = parseReferences(
          saved.document.name,
          new TextDecoder("utf-8", { fatal: true }).decode(
            Uint8Array.from(atob(saved.base64), (c) => c.charCodeAt(0)),
          ),
        );
      }
      status.textContent = `${records.length} references`;
      render();
    } catch (error) {
      if (generation === loadGeneration && file.value === fileID) throw error;
    } finally {
      if (generation === loadGeneration) {
        loading = false;
        toolbar.inert = wordToolbar.inert = false;
      }
    }
  }
  async function loadFiles(latest = false) {
    const previous = file.value;
    const candidates = actions
      .documents()
      .filter((doc) => !doc.archived && /\.(bib|csl\.json)$/i.test(doc.name));
    file.replaceChildren();
    hasFiles = candidates.length > 0;
    empty.hidden = hasFiles;
    for (const element of [fileLabel, styleLabel, filter, list])
      element.hidden = !hasFiles;
    refreshTarget();
    for (const doc of candidates) {
      const option = node("option", doc.name);
      option.value = doc.id;
      file.append(option);
    }
    if (latest && candidates.length) file.value = candidates.at(-1)!.id;
    else if (candidates.some((doc) => doc.id === previous))
      file.value = previous;
    await load();
  }
  file.onchange = () => void load().catch(fail);
  filter.oninput = render;
  return {
    close,
    refresh: refreshTarget,
    async open(trigger?: HTMLElement) {
      opener = trigger ?? opener;
      opener?.setAttribute("aria-controls", panel.id);
      opener?.setAttribute("aria-expanded", "true");
      panel.hidden = false;
      host.classList.add("with-references");
      refreshTarget();
      primaryControl().focus();
      if (loading) return;
      try {
        await guarded(async () => {
          await actions.save();
          await loadFiles();
          if (!style.querySelector("[data-zotero-style]")) {
            const styles =
              await actions.request<Array<{ id: string; label: string }>>(
                "references.styles",
              );
            for (const entry of styles) {
              const option = node("option", `Zotero · ${entry.label}`);
              option.value = `zotero:${entry.id}`;
              option.dataset.zoteroStyle = "true";
              style.append(option);
            }
          }
        });
      } catch (error) {
        fail(error);
      } finally {
        if (!panel.hidden && !busy && !loading) primaryControl().focus();
      }
    },
  };
}
