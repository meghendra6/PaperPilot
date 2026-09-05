import { getModeForItem } from "../ai/modeStore";
import {
  type PaperArtifactCard,
  type PaperArtifactKind,
} from "../paperArtifacts";
import { sessionStore } from "../session/sessionStore";
export function getPaperArtifactState(itemID: number) {
  return (
    addon.data.paperArtifactStates?.get(itemID) || {
      running: false,
      status: "",
      cards: [] as PaperArtifactCard[],
    }
  );
}

export interface WorkbenchElements {
  researchBriefButton: HTMLButtonElement;
  contributionsButton: HTMLButtonElement;
  limitationsButton: HTMLButtonElement;
  followUpsButton: HTMLButtonElement;
  saveWorkbenchNoteButton: HTMLButtonElement;
  saveWorkbenchCollectionButton: HTMLButtonElement;
  clearWorkbenchButton: HTMLButtonElement;
  statusElement: HTMLElement;
  cardsElement: HTMLElement;
}

export function renderWorkbenchArtifactState(
  elements: WorkbenchElements,
  itemID: number,
) {
  renderPaperArtifactState(
    elements.researchBriefButton,
    elements.contributionsButton,
    elements.limitationsButton,
    elements.followUpsButton,
    elements.saveWorkbenchNoteButton,
    elements.saveWorkbenchCollectionButton,
    elements.clearWorkbenchButton,
    elements.statusElement,
    elements.cardsElement,
    itemID,
  );
}

export function setPaperArtifactState(
  itemID: number,
  state: {
    running: boolean;
    status: string;
    activeKind?: PaperArtifactKind;
    cards: PaperArtifactCard[];
  },
) {
  addon.data.paperArtifactStates?.set(itemID, state);
}

export function renderPaperArtifactState(
  researchBriefButton: HTMLButtonElement,
  contributionsButton: HTMLButtonElement,
  limitationsButton: HTMLButtonElement,
  followUpsButton: HTMLButtonElement,
  saveWorkbenchNoteButton: HTMLButtonElement,
  saveWorkbenchCollectionButton: HTMLButtonElement,
  clearWorkbenchButton: HTMLButtonElement,
  statusElement: HTMLElement,
  cardsElement: HTMLElement,
  itemID: number,
) {
  const state = getPaperArtifactState(itemID);
  researchBriefButton.disabled = state.running;
  contributionsButton.disabled = state.running;
  limitationsButton.disabled = state.running;
  followUpsButton.disabled = state.running;
  saveWorkbenchNoteButton.disabled = state.running || !state.cards.length;
  saveWorkbenchCollectionButton.disabled = state.running || !state.cards.length;
  clearWorkbenchButton.disabled = state.running || !state.cards.length;

  statusElement.style.display = state.status ? "block" : "none";
  statusElement.textContent = state.status;

  cardsElement.replaceChildren();
  if (!state.cards.length) {
    cardsElement.style.display = "none";
    return;
  }

  cardsElement.style.display = "flex";
  const doc = cardsElement.ownerDocument;
  for (const card of state.cards) {
    cardsElement.appendChild(buildPaperArtifactCardElement(doc, card, itemID));
  }
}

export function buildPaperArtifactCardElement(
  doc: Document,
  card: PaperArtifactCard,
  itemID: number,
) {
  const root = doc.createElement("section");
  root.className = "pp-artifact-card";

  const titleRow = doc.createElement("div");
  titleRow.className = "pp-artifact-card__header";
  const title = doc.createElement("div");
  title.textContent = card.title;
  title.className = "pp-artifact-card__title";
  const updated = doc.createElement("div");
  updated.textContent = new Date(card.updatedAt).toLocaleTimeString();
  updated.className = "pp-artifact-card__time";
  titleRow.append(title, updated);
  root.appendChild(titleRow);

  const summary = doc.createElement("div");
  summary.textContent = card.summary;
  summary.className = "pp-artifact-card__summary";
  root.appendChild(summary);

  const sourceLabel = doc.createElement("div");
  sourceLabel.textContent = card.sourceLabel;
  sourceLabel.className = "pp-artifact-card__source";
  root.appendChild(sourceLabel);

  for (const section of card.sections) {
    const sectionRoot = doc.createElement("div");
    sectionRoot.className = "pp-artifact-card__section";

    const headingRow = doc.createElement("div");
    headingRow.className = "pp-artifact-card__section-header";

    const heading = doc.createElement("div");
    heading.textContent = section.heading;
    heading.className = "pp-artifact-card__section-heading";
    headingRow.appendChild(heading);

    if (section.evidence) {
      const evidence = doc.createElement("span");
      evidence.textContent = section.evidence;
      evidence.className = "pp-artifact-card__evidence";
      headingRow.appendChild(evidence);
    }

    const list = doc.createElement("ul");
    list.className = "pp-artifact-card__list";
    for (const item of section.items) {
      const bullet = doc.createElement("li");
      const itemText = doc.createElement("span");
      itemText.textContent = item;
      bullet.appendChild(itemText);
      if (
        card.kind === "extract-limitations" ||
        card.kind === "suggest-follow-ups"
      ) {
        const findPriorWork = doc.createElement("button");
        findPriorWork.className = "pp-btn pp-btn--ghost";
        findPriorWork.textContent = "Find prior work";
        findPriorWork.addEventListener("click", () => {
          addon.data.pendingDiscoveryConcerns?.set(itemID, {
            sessionId: sessionStore.getOrCreate(itemID, getModeForItem(itemID))
              .sessionId,
            text: item,
            origin:
              card.kind === "extract-limitations" ? "limitation" : "follow_up",
            updatedAt: new Date().toISOString(),
          });
          void addon.data.applyReaderActionToPane?.get(itemID)?.();
        });
        bullet.appendChild(findPriorWork);
      }
      list.appendChild(bullet);
    }

    sectionRoot.append(headingRow, list);
    root.appendChild(sectionRoot);
  }

  if (card.searchQueries?.length) {
    const queriesHeading = doc.createElement("div");
    queriesHeading.textContent = "Search queries";
    queriesHeading.className = "pp-artifact-card__section-heading";
    root.appendChild(queriesHeading);

    const list = doc.createElement("ul");
    list.className = "pp-artifact-card__list";
    for (const query of card.searchQueries) {
      const bullet = doc.createElement("li");
      bullet.textContent = query.rationale
        ? `${query.query} — ${query.rationale}`
        : query.query;
      list.appendChild(bullet);
    }
    root.appendChild(list);
  }

  return root;
}
