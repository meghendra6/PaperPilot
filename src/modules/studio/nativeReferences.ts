import { loadResearchWorkspaceProject } from "../researchWorkspace/facade";
import { validateReferences, type StudioReference } from "./referenceContracts";

/** Read-only snapshots; importing references never creates or edits Zotero items. */
export async function projectZoteroReferences(projectID: string) {
  const details = await loadResearchWorkspaceProject(projectID);
  const records: StudioReference[] = [];
  const skipped: string[] = [];
  const keys = new Set<string>();
  for (const source of details.sources) {
    const item = await Zotero.Items.getByLibraryAndKeyAsync(
      source.identity.libraryID,
      source.identity.itemKey,
    );
    if (!item || !item.isRegularItem() || item.deleted) {
      skipped.push(source.title);
      continue;
    }
    const id = `pp_${item.libraryID}_${item.key}`;
    if (keys.has(id)) continue;
    keys.add(id);
    const csl = (Zotero.Utilities as any).Item.itemToCSLJSON(item);
    records.push({ ...csl, id });
  }
  return { records: validateReferences(records), skipped };
}

export async function studioCitationStyles() {
  await Zotero.Styles.init();
  return Zotero.Styles.getVisible().map(
    (style: { styleID: string; title: string }) => ({
      id: style.styleID,
      label: style.title,
    }),
  );
}

export async function studioCitationStyleXML(id: string) {
  await Zotero.Styles.init();
  const style = Zotero.Styles.get(id);
  if (!style) throw new Error("This CSL style is not installed in Zotero.");
  return style.getXML();
}
