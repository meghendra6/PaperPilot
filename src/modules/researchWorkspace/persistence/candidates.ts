import {
  assertResearchWorkspaceID,
  type ResearchWorkspaceCandidate,
  type ResearchWorkspaceCandidatesFile,
} from "./contracts";
import { buildZoteroSourceID } from "../sourceIdentity";

function string(
  value: unknown,
  label: string,
  max = 4000,
): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`Invalid candidate ${label}.`);
}
function optional(value: unknown, label: string, max = 4000) {
  if (value !== undefined) string(value, label, max);
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid candidate ${label}.`);
  return value as Record<string, unknown>;
}
function date(value: unknown) {
  string(value, "timestamp", 100);
  if (!Number.isFinite(Date.parse(value)))
    throw new Error("Invalid candidate timestamp.");
}
function library(value: unknown) {
  if (!Number.isInteger(value) || Number(value) <= 0)
    throw new Error("Invalid candidate library.");
}

export function parseResearchWorkspaceCandidates(
  value: unknown,
): ResearchWorkspaceCandidatesFile {
  const file = object(value, "file");
  if (
    file.schemaVersion !== 1 ||
    !Number.isInteger(file.revision) ||
    Number(file.revision) < 0
  )
    throw new Error("Unsupported candidate file version or revision.");
  string(file.projectID, "project ID", 128);
  assertResearchWorkspaceID(file.projectID, "project ID");
  if (!Array.isArray(file.candidates) || file.candidates.length > 5000)
    throw new Error("Candidate inbox must contain at most 5000 entries.");
  const ids = new Set<string>();
  for (const raw of file.candidates) {
    const candidate = object(raw, "entry");
    string(candidate.candidateID, "ID", 128);
    assertResearchWorkspaceID(candidate.candidateID, "candidate ID");
    if (ids.has(candidate.candidateID))
      throw new Error("Duplicate candidate ID.");
    ids.add(candidate.candidateID);
    const metadata = object(candidate.metadata, "metadata");
    string(metadata.title, "title", 1000);
    optional(metadata.doi, "DOI", 500);
    optional(metadata.url, "URL", 2000);
    if (
      metadata.year !== undefined &&
      (!Number.isInteger(metadata.year) ||
        Number(metadata.year) < 0 ||
        Number(metadata.year) > 9999)
    )
      throw new Error("Invalid candidate year.");
    if (
      metadata.authors !== undefined &&
      (!Array.isArray(metadata.authors) || metadata.authors.length > 300)
    )
      throw new Error("Invalid candidate authors.");
    for (const author of (metadata.authors as unknown[] | undefined) ?? [])
      string(author, "author", 300);
    const provenance = object(candidate.provenance, "provenance");
    if (!["discovery", "chat", "manual"].includes(String(provenance.kind)))
      throw new Error("Invalid candidate provenance kind.");
    for (const field of ["url", "sessionID", "messageID", "note"])
      optional(provenance[field], `provenance ${field}`);
    optional(candidate.userNote, "note");
    date(candidate.createdAt);
    date(candidate.updatedAt);
    if (candidate.zoteroItem !== undefined) {
      const item = object(candidate.zoteroItem, "Zotero item");
      library(item.libraryID);
      string(item.itemKey, "item key", 128);
    }
    if (candidate.binding !== undefined) {
      const binding = object(candidate.binding, "binding");
      library(binding.libraryID);
      string(binding.itemKey, "item key", 128);
      string(binding.attachmentKey, "attachment key", 128);
      string(binding.sourceID, "source ID", 500);
      string(binding.contentFingerprint, "content fingerprint", 500);
      date(binding.boundAt);
      if (candidate.zoteroItem !== undefined) {
        const item = candidate.zoteroItem as Record<string, unknown>;
        if (
          item.libraryID !== binding.libraryID ||
          item.itemKey !== binding.itemKey
        )
          throw new Error(
            "Candidate Zotero item differs from its exact PDF binding.",
          );
      }
      if (
        buildZoteroSourceID({
          libraryID: Number(binding.libraryID),
          itemKey: binding.itemKey,
          attachmentKey: binding.attachmentKey,
          standaloneAttachment: binding.itemKey === binding.attachmentKey,
        }) !== binding.sourceID
      )
        throw new Error(
          "Candidate binding identity does not match its source.",
        );
    }
  }
  return JSON.parse(JSON.stringify(value)) as ResearchWorkspaceCandidatesFile;
}

export function candidateBindingState(
  candidate: ResearchWorkspaceCandidate,
  source?: { availability: string; contentFingerprint?: { value: string } },
) {
  if (!candidate.binding)
    return candidate.zoteroItem ? "PDF needed" : "Candidate";
  if (!source || source.availability !== "ready") return "PDF unavailable";
  if (source.contentFingerprint?.value !== candidate.binding.contentFingerprint)
    return "PDF changed";
  return "PDF ready";
}
