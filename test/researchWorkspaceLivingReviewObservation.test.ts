import { test } from "node:test";
import * as assert from "node:assert/strict";

import { createZoteroLivingReviewObserver } from "../src/modules/researchWorkspace/livingReviewObservation";
import type { ResearchWorkspaceSourceRecord } from "../src/modules/researchWorkspace/persistence/contracts";

const OBSERVED_AT = "2026-08-29T12:00:00.000Z";

function source(): ResearchWorkspaceSourceRecord {
  return {
    sourceID: "zotero:7:ITEM-KEY:PDF-KEY",
    identity: {
      libraryID: 7,
      itemKey: "ITEM-KEY",
      attachmentKey: "PDF-KEY",
      standaloneAttachment: false,
    },
    title: "Observed paper",
    extractionQuality: "structured",
    extractionNotes: [],
    availability: "ready",
    lastResolvedAt: "2026-08-29T00:00:00.000Z",
  };
}

function metadataOnlyAnnotation(
  key: string,
  version: number,
  dateModified: string,
) {
  const annotation: Record<string, unknown> = { key, version, dateModified };
  for (const field of ["annotationText", "comment", "color", "position"]) {
    Object.defineProperty(annotation, field, {
      get() {
        throw new Error(`Sensitive annotation field was read: ${field}`);
      },
    });
  }
  return annotation;
}

function attachmentWithAnnotations(annotations: unknown[]) {
  const attachment: Record<string, unknown> = {
    libraryID: 7,
    key: "PDF-KEY",
    version: 12,
    dateModified: "2026-08-29 11:59:00",
    getFilePathAsync: async () => "/storage/PDF-KEY/paper.pdf",
    getAnnotations: (includeEmbedded: boolean) => {
      assert.equal(includeEmbedded, false);
      return annotations;
    },
  };
  Object.defineProperty(attachment, "attachmentText", {
    get() {
      throw new Error("Attachment text must not be read");
    },
  });
  return attachment;
}

test("observes a source by stable library and attachment key and resolves annotation items or IDs", async () => {
  const direct = metadataOnlyAnnotation("ANN-B", 3, "2026-08-29 11:00:00");
  const byID = metadataOnlyAnnotation("ANN-A", 8, "2026-08-29 10:00:00");
  const attachment = attachmentWithAnnotations([direct, 314]);
  const lookupCalls: unknown[][] = [];
  const annotationCalls: unknown[] = [];
  const observer = createZoteroLivingReviewObserver({
    items: {
      getByLibraryAndKeyAsync: async (...args) => {
        lookupCalls.push(args);
        return attachment;
      },
      getAsync: async (id) => {
        annotationCalls.push(id);
        return [byID];
      },
    },
    fileExists: async () => true,
    statFile: async () => ({ size: 41, lastModified: 99 }),
    buildContentFingerprint: async (observedAttachment, path) => {
      assert.equal(observedAttachment, attachment);
      assert.equal(path, "/storage/PDF-KEY/paper.pdf");
      return {
        algorithm: "zotero-version-mtime-size-v1",
        value: "12:41:99:2026-08-29 11:59:00",
      };
    },
  });

  const result = await observer(source(), OBSERVED_AT);

  assert.deepEqual(lookupCalls, [[7, "PDF-KEY"]]);
  assert.deepEqual(annotationCalls, [314]);
  assert.equal(result.availability, "ready");
  assert.equal(result.contentFingerprint, "12:41:99:2026-08-29 11:59:00");
  assert.equal(
    result.annotation?.algorithm,
    "zotero-annotation-keys-version-date-v1",
  );
  assert.equal(result.annotation?.count, 2);
  assert.equal(result.annotationFingerprint, result.annotation?.value);
  assert.equal(result.sourceID, source().sourceID);
  assert.equal(result.observedAt, OBSERVED_AT);
});

test("uses Zotero's synchronous stable-key API when the async API is unavailable", async () => {
  const calls: unknown[][] = [];
  const observer = createZoteroLivingReviewObserver({
    items: {
      getByLibraryAndKey: (...args) => {
        calls.push(args);
        return attachmentWithAnnotations([]);
      },
    },
    fileExists: async () => true,
    statFile: async () => ({}),
    buildContentFingerprint: async () => ({
      algorithm: "zotero-version-mtime-size-v1",
      value: "sync-fingerprint",
    }),
  });

  assert.equal((await observer(source(), OBSERVED_AT)).availability, "ready");
  assert.deepEqual(calls, [[7, "PDF-KEY"]]);
});

test("classifies detached, missing-file, and unreadable sources without reading content", async (t) => {
  await t.test(
    "detached when the stable attachment key no longer resolves",
    async () => {
      const observer = createZoteroLivingReviewObserver({
        items: { getByLibraryAndKeyAsync: async () => undefined },
        fileExists: async () => {
          throw new Error("must not inspect a detached file");
        },
        statFile: async () => {
          throw new Error("must not stat a detached file");
        },
      });
      assert.equal(
        (await observer(source(), OBSERVED_AT)).availability,
        "detached",
      );
    },
  );

  await t.test("missing-file when no local path is available", async () => {
    const attachment = {
      ...attachmentWithAnnotations([]),
      getFilePathAsync: async () => undefined,
    };
    const observer = createZoteroLivingReviewObserver({
      items: { getByLibraryAndKeyAsync: async () => attachment },
      fileExists: async () => {
        throw new Error("must not test an absent path");
      },
    });
    assert.equal(
      (await observer(source(), OBSERVED_AT)).availability,
      "missing-file",
    );
  });

  await t.test(
    "missing-file when the resolved path does not exist",
    async () => {
      const observer = createZoteroLivingReviewObserver({
        items: {
          getByLibraryAndKeyAsync: async () => attachmentWithAnnotations([]),
        },
        fileExists: async () => false,
        statFile: async () => {
          throw new Error("must not stat a missing file");
        },
      });
      assert.equal(
        (await observer(source(), OBSERVED_AT)).availability,
        "missing-file",
      );
    },
  );

  await t.test("unreadable when file stat fails", async () => {
    let fingerprintCalls = 0;
    const observer = createZoteroLivingReviewObserver({
      items: {
        getByLibraryAndKeyAsync: async () => attachmentWithAnnotations([]),
      },
      fileExists: async () => true,
      statFile: async () => {
        throw new Error("permission denied");
      },
      buildContentFingerprint: async () => {
        fingerprintCalls += 1;
        throw new Error("must not fingerprint after stat failure");
      },
    });
    assert.equal(
      (await observer(source(), OBSERVED_AT)).availability,
      "unreadable",
    );
    assert.equal(fingerprintCalls, 0);
  });

  await t.test("unreadable when metadata fingerprinting fails", async () => {
    const observer = createZoteroLivingReviewObserver({
      items: {
        getByLibraryAndKeyAsync: async () => attachmentWithAnnotations([]),
      },
      fileExists: async () => true,
      statFile: async () => ({}),
      buildContentFingerprint: async () => {
        throw new Error("invalid attachment metadata");
      },
    });
    assert.equal(
      (await observer(source(), OBSERVED_AT)).availability,
      "unreadable",
    );
  });
});

test("annotation fingerprints are deterministic, order-independent, and metadata-only", async () => {
  const first = metadataOnlyAnnotation("ANN-A", 1, "2026-08-29 10:00:00");
  const second = metadataOnlyAnnotation("ANN-B", 2, "2026-08-29 11:00:00");
  const changed = metadataOnlyAnnotation("ANN-A", 2, "2026-08-29 10:00:00");

  async function observe(annotations: unknown[]) {
    return createZoteroLivingReviewObserver({
      items: {
        getByLibraryAndKeyAsync: async () =>
          attachmentWithAnnotations(annotations),
      },
      fileExists: async () => true,
      statFile: async () => ({}),
      buildContentFingerprint: async () => ({
        algorithm: "zotero-version-mtime-size-v1",
        value: "content-metadata-only",
      }),
    })(source(), OBSERVED_AT);
  }

  const ordered = await observe([first, second]);
  const reversed = await observe([second, first]);
  const versionChanged = await observe([changed, second]);

  assert.match(
    ordered.annotationFingerprint ?? "",
    /^fnv1a32:\d+:[0-9a-f]{8}$/,
  );
  assert.equal(ordered.annotationFingerprint, reversed.annotationFingerprint);
  assert.notEqual(
    ordered.annotationFingerprint,
    versionChanged.annotationFingerprint,
  );
});
