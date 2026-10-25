import { strict as assert } from "node:assert";
import { test, type TestContext } from "node:test";
import {
  ExtractorCleanupUnconfirmedError,
  PaperWorkspaceContentCache,
  extractStructuredPdf,
  probeJavaRuntime,
  resetJavaRuntimeProbeForTests,
  resolveOpenDataLoaderJarPath,
  waitForExtractorCompletion,
  withOpenDataLoaderOutputCleanup,
} from "../src/modules/tools/paperWorkspaceContent";
import {
  PDFReadTimeoutError,
  waitForPDFRead,
} from "../src/modules/tools/pdfReadDeadline";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const never = <T>() => new Promise<T>(() => {});
let sequence = 0;
function fixture(t: TestContext) {
  const globals = globalThis as any;
  const previous = {
    Zotero: globals.Zotero,
    IOUtils: globals.IOUtils,
    PathUtils: globals.PathUtils,
    rootURI: globals.rootURI,
  };
  resetJavaRuntimeProbeForTests();
  t.after(() => {
    Object.assign(globals, previous);
    resetJavaRuntimeProbeForTests();
  });
  const directory = `/owned/pdf-deadline-${++sequence}/run`;
  const disk = new Map<string, string | Uint8Array<ArrayBuffer>>();
  const removed: string[] = [];
  const cleaned = deferred<void>();
  let launches = 0;
  let stops = 0;
  let fallbackReads = 0;
  const controls = {
    probe: async () => "__PAPERPILOT_EXIT__=0\n",
    process: async () =>
      `/bin/zsh -lc java ${directory}/extractor\n__PAPERPILOT_EXIT__=0\n`,
    jar: async () => ({ response: new Uint8Array([80, 75, 3, 4]).buffer }),
    launch: async () => {
      disk.set(`${directory}/extractor-exit.txt`, "0");
      disk.set(`${directory}/document.md`, "Structured PDF text");
      disk.set(`${directory}/document.json`, "{}");
    },
    stop: async () => {},
    fallback: () => Promise.resolve("Zotero text"),
    read: async (path: string): Promise<string> => {
      const value = disk.get(path);
      if (value === undefined) throw new Error("file missing");
      return String(value);
    },
    write: async (path: string, bytes: Uint8Array<ArrayBuffer>) => {
      disk.set(path, bytes);
    },
  };
  globals.rootURI = `jar:file:///installed/pdf-${sequence}.xpi!/`;
  globals.Zotero = {
    Profile: { dir: `/profile/pdf-${sequence}` },
    logError: () => {},
    getTempDirectory: () => ({ path: "/synthetic/temp" }),
    HTTP: { request: () => controls.jar() },
    Utilities: {
      Internal: {
        subprocess: (_executable: string, args: string[]) =>
          args.join(" ").includes("/bin/ps")
            ? controls.process()
            : controls.probe(),
        exec: async (_executable: string, args: string[]) => {
          if (args.join(" ").includes("terminate_run_tree")) {
            stops++;
            await controls.stop();
          } else {
            launches++;
            await controls.launch();
          }
          return true;
        },
      },
    },
    File: {
      getContentsAsync: (path: string) => controls.read(path),
      iterateDirectory: async (
        path: string,
        visit: (entry: { path: string; isDir: boolean }) => Promise<void>,
      ) => {
        for (const name of disk.keys())
          if (name.startsWith(`${path}/`))
            await visit({ path: name, isDir: false });
      },
    },
  };
  globals.PathUtils = { join: (...parts: string[]) => parts.join("/") };
  globals.IOUtils = {
    exists: async (path: string) => disk.has(path),
    stat: async () => ({ size: 1, lastModified: 1 }),
    read: async (path: string) => disk.get(path),
    makeDirectory: async () => {},
    createUniqueDirectory: async () => directory,
    write: (path: string, bytes: Uint8Array<ArrayBuffer>) =>
      controls.write(path, bytes),
    writeUTF8: async (path: string, text: string) => {
      disk.set(path, text);
    },
    remove: async (path: string) => {
      removed.push(path);
      for (const name of disk.keys())
        if (name === path || name.startsWith(`${path}/`)) disk.delete(name);
      if (path === directory) cleaned.resolve();
    },
  };
  const parent = { id: 1, key: "ITEM", libraryID: 7 };
  const attachment = {
    id: 2,
    key: "PDF",
    libraryID: 7,
    version: 1,
    getFilePathAsync: async (): Promise<string | undefined> =>
      "/synthetic/input.pdf",
    getField: () => "2026-10-24",
    get attachmentText() {
      fallbackReads++;
      return controls.fallback();
    },
  };
  const timeouts = {
    javaMs: 10,
    stageMs: 20,
    runMs: 40,
    cleanupMs: 20,
    fallbackMs: 10,
  };
  return {
    controls,
    disk,
    directory,
    removed,
    cleaned,
    parent,
    attachment,
    timeouts,
    launches: () => launches,
    stops: () => stops,
    fallbackReads: () => fallbackReads,
  };
}

test("PDF deadline rejects promptly and observes late failures without starting canceled actions", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    waitForPDFRead(() => assert.fail("Already canceled"), {
      timeoutMs: 10,
      signal: controller.signal,
      stage: "fixture",
    }),
    { name: "AbortError" },
  );
  const late = deferred<string>();
  await assert.rejects(
    waitForPDFRead(late.promise, { timeoutMs: 5, stage: "fixture" }),
    PDFReadTimeoutError,
  );
  late.reject(new Error("late underlying failure"));
  await tick();
});

test("a stalled Java probe falls back within its budget and cannot publish late availability", async (t) => {
  const f = fixture(t);
  const probe = deferred<string>();
  f.controls.probe = () => probe.promise;
  const result = await new PaperWorkspaceContentCache().getPaperContent(
    f.parent,
    { attachment: f.attachment, timeouts: f.timeouts },
  );
  assert.equal(result.fullText, "Zotero text");
  assert.match(result.extractionNotes[0], /timeout/);
  assert.equal(f.launches(), 0);
  probe.resolve("__PAPERPILOT_EXIT__=0\n");
  await tick();
  let checked = false;
  assert.equal(
    await probeJavaRuntime(async () => {
      checked = true;
      throw new Error("java missing");
    }),
    false,
  );
  assert.equal(
    checked,
    true,
    "A timed-out probe must not populate the availability cache later.",
  );
});

test("canceling Java preflight prevents fallback and every later launch", async (t) => {
  const f = fixture(t);
  const probe = deferred<string>();
  const entered = deferred<void>();
  f.controls.probe = () => {
    entered.resolve();
    return probe.promise;
  };
  const controller = new AbortController();
  const request = new PaperWorkspaceContentCache().getPaperContent(f.parent, {
    attachment: f.attachment,
    signal: controller.signal,
    timeouts: f.timeouts,
  });
  const rejected = assert.rejects(request, { name: "AbortError" });
  await entered.promise;
  controller.abort();
  await rejected;
  probe.resolve("__PAPERPILOT_EXIT__=0\n");
  await tick();
  assert.equal(f.fallbackReads(), 0);
  assert.equal(f.launches(), 0);
  assert.equal(f.disk.size, 0);
});

test("a stalled JAR read falls back and its late response cannot stage or launch an extractor", async (t) => {
  const f = fixture(t);
  const jar = deferred<{ response: ArrayBuffer }>();
  f.controls.jar = () => jar.promise;
  const result = await new PaperWorkspaceContentCache().getPaperContent(
    f.parent,
    { attachment: f.attachment, timeouts: f.timeouts },
  );
  assert.equal(result.extractionMethod, "zotero-attachment-text");
  jar.resolve({ response: new Uint8Array([1, 2, 3]).buffer });
  await tick();
  assert.equal(f.launches(), 0);
  assert.equal(f.disk.size, 0);
});

test("canceling one JAR reader leaves a concurrent reader's shared preparation running", async (t) => {
  const f = fixture(t);
  const jar = deferred<{ response: ArrayBuffer }>();
  const entered = deferred<void>();
  let reads = 0;
  f.controls.jar = () => {
    reads++;
    entered.resolve();
    return jar.promise;
  };
  const first = new AbortController();
  const second = new AbortController();
  const canceled = resolveOpenDataLoaderJarPath({
    signal: first.signal,
    timeouts: f.timeouts,
  });
  const rejected = assert.rejects(canceled, { name: "AbortError" });
  await entered.promise;
  const active = resolveOpenDataLoaderJarPath({
    signal: second.signal,
    timeouts: f.timeouts,
  });
  first.abort();
  await rejected;
  jar.resolve({ response: new Uint8Array([1, 2, 3]).buffer });
  assert.match(await active, /opendataloader-pdf-cli-.*\.jar$/);
  assert.equal(reads, 1);
  assert.equal(second.signal.aborted, false);
});

test("JAR preparation gets its cancellation controller from the Zotero window when needed", async (t) => {
  const f = fixture(t);
  const globals = globalThis as any;
  const Constructor = globals.AbortController;
  t.after(() => {
    globals.AbortController = Constructor;
  });
  globals.AbortController = undefined;
  globals.Zotero.getMainWindow = () => ({ AbortController: Constructor });
  assert.match(
    await resolveOpenDataLoaderJarPath({ timeouts: f.timeouts }),
    /opendataloader-pdf-cli-.*\.jar$/,
  );
});

test("a timed-out native JAR write keeps ownership until it settles before retry can replace the cache", async (t) => {
  const f = fixture(t);
  const write = deferred<void>();
  const entered = deferred<void>();
  let writes = 0;
  f.controls.jar = async () => ({ response: new Uint8Array([1]).buffer });
  f.controls.write = async (path, bytes) => {
    writes++;
    entered.resolve();
    await write.promise;
    f.disk.set(path, bytes);
  };
  const old = resolveOpenDataLoaderJarPath({ timeouts: f.timeouts });
  const rejected = assert.rejects(old, PDFReadTimeoutError);
  await entered.promise;
  await rejected;
  const removals = f.removed.length;
  f.controls.jar = async () => ({ response: new Uint8Array([2]).buffer });
  await assert.rejects(
    resolveOpenDataLoaderJarPath({ timeouts: f.timeouts }),
    PDFReadTimeoutError,
  );
  assert.equal(
    writes,
    1,
    "A pending native write must block competing writes.",
  );
  assert.equal(
    f.removed.length,
    removals,
    "Do not remove an active write's temporary file.",
  );
  write.resolve();
  await tick();
  const path = await resolveOpenDataLoaderJarPath({ timeouts: f.timeouts });
  assert.deepEqual(f.disk.get(path), new Uint8Array([2]));
  assert.equal(writes, 2);
});

for (const interruption of ["timeout", "abort"] as const) {
  test(`Zotero text ${interruption} permits retry and cannot overwrite the fresh cache later`, async (t) => {
    const f = fixture(t);
    f.attachment.getFilePathAsync = async () => undefined;
    const stale = deferred<string>();
    const entered = deferred<void>();
    f.controls.fallback = () => {
      entered.resolve();
      return stale.promise;
    };
    const cache = new PaperWorkspaceContentCache();
    const controller = new AbortController();
    const old = cache.getPaperContent(f.parent, {
      attachment: f.attachment,
      signal: controller.signal,
      timeouts: f.timeouts,
    });
    const rejected = assert.rejects(
      old,
      interruption === "abort" ? { name: "AbortError" } : PDFReadTimeoutError,
    );
    await entered.promise;
    if (interruption === "abort") controller.abort();
    await rejected;
    f.controls.fallback = () => Promise.resolve("Fresh text");
    assert.equal(
      (
        await cache.getPaperContent(f.parent, {
          attachment: f.attachment,
          timeouts: f.timeouts,
        })
      ).fullText,
      "Fresh text",
    );
    stale.resolve("Stale text");
    await tick();
    assert.equal(
      (
        await cache.getPaperContent(f.parent, {
          attachment: f.attachment,
          timeouts: f.timeouts,
        })
      ).fullText,
      "Fresh text",
    );
    assert.equal(f.fallbackReads(), 2);
  });
}

test("a never-settling poll read or stop cannot bypass the extraction and cleanup budgets", async () => {
  await assert.rejects(
    waitForExtractorCompletion({
      exitCodePath: "/owned/job/exit",
      pidPath: "/owned/job/pid",
      stderrPath: "/owned/job/stderr",
      timeoutMs: 5,
      cleanupTimeoutMs: 5,
      read: () => never<string>(),
    }),
    ExtractorCleanupUnconfirmedError,
  );
  await assert.rejects(
    waitForExtractorCompletion({
      exitCodePath: "/owned/job/exit",
      pidPath: "/owned/job/pid",
      stderrPath: "/owned/job/stderr",
      timeoutMs: 0,
      cleanupTimeoutMs: 5,
      read: async (path) => (path.endsWith("/pid") ? "4242" : ""),
      stop: () => never<void>(),
    }),
    ExtractorCleanupUnconfirmedError,
  );
});

test("a stalled removal reports its own bounded failure instead of hanging the PDF read", async () => {
  await assert.rejects(
    withOpenDataLoaderOutputCleanup(
      "/owned/job",
      async () => "text",
      () => never<void>(),
      5,
    ),
    PDFReadTimeoutError,
  );
});

test("structured success reports progress and removes its owned output", async (t) => {
  const f = fixture(t);
  const statuses: string[] = [];
  const result = await extractStructuredPdf("/synthetic/input.pdf", undefined, {
    timeouts: f.timeouts,
    onStatus: (status) => statuses.push(status),
  });
  assert.equal(result.markdownText, "Structured PDF text");
  assert.equal(f.launches(), 1);
  assert.ok(f.removed.includes(f.directory));
  assert.ok(statuses.some((status) => status.includes("Extracting")));
  assert.ok(
    statuses.some((status) => status.includes("Reading the extracted")),
  );
});

for (const interruption of ["timeout", "abort"] as const) {
  test(`late launch after ${interruption} retains evidence until its owned process is stopped`, async (t) => {
    const f = fixture(t);
    const launch = deferred<void>();
    const entered = deferred<void>();
    f.controls.launch = () => {
      entered.resolve();
      return launch.promise;
    };
    const controller = new AbortController();
    const read = extractStructuredPdf(
      "/synthetic/input.pdf",
      controller.signal,
      { timeouts: f.timeouts },
    );
    const rejected = assert.rejects(read, ExtractorCleanupUnconfirmedError);
    await entered.promise;
    if (interruption === "abort") controller.abort();
    await rejected;
    assert.equal(f.removed.includes(f.directory), false);
    assert.equal(f.disk.get(`${f.directory}/launch-intent`), "opendataloader");
    f.disk.set(`${f.directory}/extractor-pid.txt`, "4242");
    launch.resolve();
    await waitForPDFRead(f.cleaned.promise, {
      timeoutMs: 200,
      stage: "late fixture cleanup",
    });
    assert.equal(f.stops(), 1);
    assert.equal(f.disk.has(`${f.directory}/launch-intent`), false);
  });
}

test("a stalled extracted-text read is bounded even after the process has exited", async (t) => {
  const f = fixture(t);
  const originalRead = f.controls.read;
  f.controls.read = (path) =>
    path.endsWith("/document.md") ? never<string>() : originalRead(path);
  await assert.rejects(
    extractStructuredPdf("/synthetic/input.pdf", undefined, {
      timeouts: f.timeouts,
    }),
    PDFReadTimeoutError,
  );
  assert.ok(f.removed.includes(f.directory));
  assert.equal(f.stops(), 0);
});

test("an expired cleanup cannot authorize a late PID signal while the ownership timer is still pending", async (t) => {
  const f = fixture(t);
  const timers = new Set<{ fire: () => void }>();
  t.mock.method(Date, "now", () => 1_000);
  t.mock.method(globalThis, "setTimeout", (callback: () => void) => {
    const timer = { fire: callback };
    timers.add(timer);
    return timer as unknown as ReturnType<typeof setTimeout>;
  });
  t.mock.method(globalThis, "clearTimeout", (timer: unknown) => {
    timers.delete(timer as { fire: () => void });
  });
  const process = deferred<string>();
  const ownershipEntered = deferred<void>();
  f.controls.process = () => {
    ownershipEntered.resolve();
    return process.promise;
  };
  f.controls.launch = async () => {
    f.disk.set(`${f.directory}/extractor-pid.txt`, "4242");
  };
  const failed = assert.rejects(
    extractStructuredPdf("/synthetic/input.pdf", undefined, {
      timeouts: { ...f.timeouts, runMs: 0, cleanupMs: 100 },
    }),
    ExtractorCleanupUnconfirmedError,
  );
  await ownershipEntered.promise;
  // The enclosing cleanup timer can fire before the nested ownership timer.
  // Keep the wall clock within budget to ensure revocation is authoritative.
  const [cleanupTimer] = [...timers];
  assert.equal(timers.size, 2);
  cleanupTimer.fire();
  await failed;
  assert.equal(f.stops(), 0);
  process.resolve(
    `/bin/zsh -lc java ${f.directory}/extractor\n__PAPERPILOT_EXIT__=0\n`,
  );
  await tick();
  assert.equal(
    f.stops(),
    0,
    "An expired ownership result must never authorize a kill.",
  );
  assert.equal(f.removed.includes(f.directory), false);
  assert.equal(f.disk.get(`${f.directory}/launch-intent`), "opendataloader");
});
