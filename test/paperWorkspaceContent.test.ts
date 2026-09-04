import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  buildOpenDataLoaderScript,
  classifyStructuredExtractionFailure,
  PaperWorkspaceContentCache,
  probeJavaRuntime,
  resetJavaRuntimeProbeForTests,
  resolveOpenDataLoaderJarPath,
  waitForExtractorCompletion,
  withOpenDataLoaderOutputCleanup,
} from "../src/modules/tools/paperWorkspaceContent";
import { checkShellSyntax } from "./helpers/shellSyntax";

test("OpenDataLoader extraction records a pid and exit code", () => {
  const script = buildOpenDataLoaderScript({
    jarPath: "/tmp/tools/opendataloader.jar",
    inputPath: "/tmp/papers/input.pdf",
    outputDir: "/tmp/output",
    exitCodePath: "/tmp/output/extractor-exit.txt",
    pidPath: "/tmp/output/extractor-pid.txt",
    stderrPath: "/tmp/output/extractor-stderr.log",
  });
  assert.equal(checkShellSyntax(script).status, 0);
  assert.match(script, /echo \$! > '\/tmp\/output\/extractor-pid\.txt'/);
  assert.match(
    script,
    /printf '%s' \$\? > '\/tmp\/output\/extractor-exit\.txt'/,
  );
});

test("OpenDataLoader extraction stops its recorded pid on timeout", async () => {
  const stopped: string[] = [];
  await assert.rejects(
    () =>
      waitForExtractorCompletion({
        exitCodePath: "/tmp/output/exit.txt",
        pidPath: "/tmp/output/pid.txt",
        stderrPath: "/tmp/output/stderr.log",
        timeoutMs: 0,
        read: async (path) => (path.endsWith("pid.txt") ? "4242" : ""),
        stop: async (processId) => {
          stopped.push(String(processId));
        },
      }),
    /timed out after 0 seconds/,
  );
  assert.deepEqual(stopped, ["4242"]);
});

test("OpenDataLoader output cleanup runs on success and failure", async () => {
  const removed: string[] = [];
  const remove = async (path: string) => {
    removed.push(path);
  };
  assert.equal(
    await withOpenDataLoaderOutputCleanup(
      "/tmp/output-success",
      async () => "done",
      remove,
    ),
    "done",
  );
  await assert.rejects(
    withOpenDataLoaderOutputCleanup(
      "/tmp/output-failure",
      async () => {
        throw new Error("injected failure");
      },
      remove,
    ),
    /injected failure/,
  );
  assert.deepEqual(removed, ["/tmp/output-success", "/tmp/output-failure"]);
});

test("a negative Java runtime probe is cached for the session", async () => {
  resetJavaRuntimeProbeForTests();
  let probes = 0;
  const unavailable = async () => {
    probes += 1;
    throw new Error("java unavailable");
  };
  assert.equal(await probeJavaRuntime(unavailable), false);
  assert.equal(await probeJavaRuntime(unavailable), false);
  assert.equal(probes, 1);
  resetJavaRuntimeProbeForTests();
});

test("structured extraction failures persist canned reasons only", () => {
  assert.equal(
    classifyStructuredExtractionFailure(
      new Error("/private/var/folders/secret output is invalid JSON"),
    ),
    "invalid-json",
  );
  assert.equal(
    classifyStructuredExtractionFailure(new Error("java-missing")),
    "java-missing",
  );
});

test("resolveOpenDataLoaderJarPath falls back to node_modules for file roots", async () => {
  const resolved = await resolveOpenDataLoaderJarPath({
    rootUri: "file:///tmp/project/build/addon/",
    exists: async (candidate) =>
      candidate ===
      "/tmp/project/node_modules/@opendataloader/pdf/lib/opendataloader-pdf-cli.jar",
  });

  assert.equal(
    resolved,
    "/tmp/project/node_modules/@opendataloader/pdf/lib/opendataloader-pdf-cli.jar",
  );
});

test("paper content extraction stays bound to the explicitly requested attachment", async () => {
  const cache = new PaperWorkspaceContentCache();
  const parent = {
    id: 1,
    key: "ITEM",
    libraryID: 7,
    isAttachment: () => false,
  };
  const attachmentB = {
    id: 3,
    key: "ATTACH-B",
    libraryID: 7,
    version: 1,
    attachmentText: "Text from PDF B",
    getFilePathAsync: async () => undefined,
    getField: () => "2026-08-29 00:00:00",
  };

  const content = await cache.getPaperContent(parent, {
    attachment: attachmentB,
    source: {
      libraryID: 7,
      itemKey: "ITEM",
      attachmentKey: "ATTACH-B",
      standaloneAttachment: false,
    },
  });

  assert.equal(content.fullText, "Text from PDF B");
  assert.equal(content.source?.attachmentKey, "ATTACH-B");
});

test("paper content cache invalidates when the Zotero attachment version changes", async () => {
  const cache = new PaperWorkspaceContentCache();
  const parent = {
    id: 1,
    key: "ITEM",
    libraryID: 7,
    isAttachment: () => false,
  };
  const attachment = {
    id: 2,
    key: "ATTACH",
    libraryID: 7,
    version: 1,
    attachmentText: "First revision",
    getFilePathAsync: async () => undefined,
    getField: () => "2026-08-29 00:00:00",
  };
  const source = {
    libraryID: 7,
    itemKey: "ITEM",
    attachmentKey: "ATTACH",
    standaloneAttachment: false,
  };

  const first = await cache.getPaperContent(parent, { attachment, source });
  attachment.version = 2;
  attachment.attachmentText = "Second revision";
  const second = await cache.getPaperContent(parent, { attachment, source });

  assert.equal(first.fullText, "First revision");
  assert.equal(second.fullText, "Second revision");
  assert(first.contentFingerprint);
  assert(second.contentFingerprint);
  assert.notEqual(
    first.contentFingerprint.value,
    second.contentFingerprint.value,
  );
});

test("paper content extraction rejects an attachment outside the requested source", async () => {
  const cache = new PaperWorkspaceContentCache();
  const attachment = {
    id: 2,
    key: "ATTACH-A",
    libraryID: 7,
    version: 1,
    attachmentText: "Text",
    getFilePathAsync: async () => undefined,
  };

  await assert.rejects(
    () =>
      cache.getPaperContent(
        { id: 1, key: "ITEM", libraryID: 7 },
        {
          attachment,
          source: {
            libraryID: 7,
            itemKey: "ITEM",
            attachmentKey: "ATTACH-B",
            standaloneAttachment: false,
          },
        },
      ),
    /does not match the requested source identity/,
  );
});
