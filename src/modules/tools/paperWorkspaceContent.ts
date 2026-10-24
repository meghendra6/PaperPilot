import { isPdfFileAttachment } from "../../utils/pdfAttachment";
import { version as openDataLoaderVersion } from "../../../node_modules/@opendataloader/pdf/package.json";
import { config } from "../../../package.json";
import { getZoteroProfilePath } from "../../utils/zoteroProfile";
import { launchDetachedShellScript } from "../ai/launchScript";
import { stopDetachedRunProcess } from "../ai/runCompletion";
import {
  parseExitStatusMarker,
  withExitStatusMarker,
} from "../ai/subprocessStatus";
import { buildCodexCommandEnvironment } from "../codex/environment";
import { shellEscape, shellExportLine } from "../codex/shell";
import {
  createPDFReadController,
  PDFReadTimeoutError,
  throwIfPDFReadAborted,
  waitForPDFRead,
} from "./pdfReadDeadline";

declare const Zotero: any;
declare const IOUtils: any;
declare const PathUtils: any;

export interface PaperWorkspaceContent {
  fullText: string;
  markdownText?: string;
  structuredContent?: unknown;
  extractionMethod: "opendataloader-pdf" | "zotero-attachment-text";
  extractionNotes: string[];
  source?: PaperWorkspaceContentSource;
  contentFingerprint?: PaperContentFingerprint;
}

export interface PaperWorkspaceContentSource {
  libraryID: number;
  itemKey: string;
  attachmentKey: string;
  standaloneAttachment: boolean;
}

export interface PaperContentFingerprint {
  algorithm: "zotero-version-mtime-size-v1";
  value: string;
  fileSize?: number;
  modifiedTime?: number;
  zoteroVersion?: number;
}

export interface PDFReadTimeouts {
  javaMs: number;
  stageMs: number;
  runMs: number;
  cleanupMs: number;
  fallbackMs: number;
}

export const PDF_READ_TIMEOUTS: Readonly<PDFReadTimeouts> = {
  javaMs: 10_000,
  stageMs: 30_000,
  runMs: 120_000,
  cleanupMs: 30_000,
  fallbackMs: 30_000,
};

export interface PaperWorkspaceContentOptions {
  attachment?: any;
  source?: PaperWorkspaceContentSource;
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
  /** Internal test budgets; these are not user preferences. */
  timeouts?: Partial<PDFReadTimeouts>;
}

type PDFReadOptions = Pick<
  PaperWorkspaceContentOptions,
  "signal" | "onStatus" | "timeouts"
>;
const readTimeouts = (options: PDFReadOptions) => ({
  ...PDF_READ_TIMEOUTS,
  ...options.timeouts,
});
const interruptedPDFRead = (error: unknown) =>
  error instanceof PDFReadTimeoutError ||
  (error instanceof Error && error.name === "AbortError");

interface StructuredExtractionResult {
  markdownText: string;
  structuredContent: unknown;
}

export const OPEN_DATA_LOADER_EXTRACTOR_VERSION = `opendataloader-pdf@${openDataLoaderVersion}`;
export const ZOTERO_ATTACHMENT_TEXT_EXTRACTOR_VERSION =
  "zotero-attachment-text@1";
const EXTRACTOR_VERSION = `${OPEN_DATA_LOADER_EXTRACTOR_VERSION}|${ZOTERO_ATTACHMENT_TEXT_EXTRACTOR_VERSION}`;
const EXTRACTION_OPTIONS_VERSION = "reading-order-xycut-v1";
const MAX_CACHE_ENTRIES = 12;
export const STRUCTURED_EXTRACTION_TIMEOUT_MS = 2 * 60 * 1000;
const STRUCTURED_EXTRACTION_POLL_MS = 100;

export class PaperWorkspaceContentCache {
  private readonly entries = new Map<string, PaperWorkspaceContent>();

  async getPaperContent(
    item: any,
    options: PaperWorkspaceContentOptions = {},
  ): Promise<PaperWorkspaceContent> {
    throwIfPDFReadAborted(options.signal);
    const attachment =
      options.attachment ??
      (await waitForPDFRead(() => resolvePdfAttachment(item), {
        timeoutMs: readTimeouts(options).stageMs,
        signal: options.signal,
        stage: "Finding the selected PDF",
      }));
    if (!attachment) {
      throw new Error("No PDF attachment found for this item");
    }
    const source =
      options.source ?? buildPaperWorkspaceContentSource(item, attachment);
    assertAttachmentMatchesSource(attachment, source);
    options.onStatus?.("Locating the PDF on this computer…");
    const filePath = await waitForPDFRead<string | undefined>(
      () => attachment.getFilePathAsync(),
      {
        timeoutMs: readTimeouts(options).stageMs,
        signal: options.signal,
        stage: "Locating the PDF",
      },
    );
    const contentFingerprint = await buildPaperContentFingerprint(
      attachment,
      filePath,
      options,
    );
    throwIfPDFReadAborted(options.signal);
    const cacheKey = JSON.stringify([
      source.libraryID,
      source.itemKey,
      source.attachmentKey,
      contentFingerprint.value,
      EXTRACTOR_VERSION,
      EXTRACTION_OPTIONS_VERSION,
    ]);
    const cached = this.entries.get(cacheKey);
    if (cached) {
      this.entries.delete(cacheKey);
      this.entries.set(cacheKey, cached);
      return cached;
    }

    const content = await this.extractPaperContent(
      attachment,
      source,
      contentFingerprint,
      filePath,
      options,
    );
    throwIfPDFReadAborted(options.signal);
    this.entries.set(cacheKey, content);
    while (this.entries.size > MAX_CACHE_ENTRIES) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return content;
  }

  clearCache() {
    this.entries.clear();
  }

  private async extractPaperContent(
    attachment: any,
    source: PaperWorkspaceContentSource,
    contentFingerprint: PaperContentFingerprint,
    filePath: string | undefined,
    options: PDFReadOptions,
  ): Promise<PaperWorkspaceContent> {
    const extractionNotes: string[] = [];

    if (filePath) {
      try {
        const structured = await extractStructuredPdf(
          filePath,
          options.signal,
          options,
        );
        return {
          fullText: structured.markdownText,
          markdownText: structured.markdownText,
          structuredContent: structured.structuredContent,
          extractionMethod: "opendataloader-pdf",
          extractionNotes,
          source,
          contentFingerprint,
        };
      } catch (error) {
        throwIfPDFReadAborted(options.signal);
        if (error instanceof Error && error.name === "AbortError") throw error;
        const reason = classifyStructuredExtractionFailure(error);
        if (reason !== "java-missing") {
          Zotero.logError?.(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
        extractionNotes.push(
          `OpenDataLoader PDF extraction unavailable; fell back to Zotero attachment text (${reason}).`,
        );
      }
    } else {
      extractionNotes.push(
        "OpenDataLoader PDF extraction unavailable; fell back to Zotero attachment text (file-path-missing).",
      );
    }

    options.onStatus?.("Reading Zotero’s PDF text…");
    const fallbackText = await waitForPDFRead<string>(
      () => Promise.resolve(attachment.attachmentText || ""),
      {
        timeoutMs: readTimeouts(options).fallbackMs,
        signal: options.signal,
        stage: "Reading Zotero’s PDF text",
      },
    );
    return {
      fullText: fallbackText,
      extractionMethod: "zotero-attachment-text",
      extractionNotes,
      source,
      contentFingerprint,
    };
  }
}

export function classifyStructuredExtractionFailure(error: unknown) {
  const message = String(
    error instanceof Error ? error.message : error,
  ).toLowerCase();
  if (message.includes("java-missing") || message.includes("java runtime")) {
    return "java-missing";
  }
  if (message.includes("could not locate") && message.includes("runtime")) {
    return "jar-missing";
  }
  if (message.includes("timed out")) return "timeout";
  if (message.includes("invalid json")) return "invalid-json";
  if (message.includes("did not produce") || message.includes("empty")) {
    return "no-output";
  }
  return "extraction-failed";
}

function buildPaperWorkspaceContentSource(
  item: any,
  attachment: any,
): PaperWorkspaceContentSource {
  const libraryID = Number(attachment.libraryID ?? item.libraryID);
  const attachmentKey = String(attachment.key ?? attachment.id ?? "").trim();
  const itemKey = String(item.key ?? item.id ?? "").trim();
  if (!Number.isInteger(libraryID) || libraryID <= 0) {
    throw new Error("Could not resolve the Zotero library for this PDF.");
  }
  if (!itemKey || !attachmentKey) {
    throw new Error("Could not resolve stable Zotero keys for this PDF.");
  }
  return {
    libraryID,
    itemKey,
    attachmentKey,
    standaloneAttachment: Number(item.id) === Number(attachment.id),
  };
}

function assertAttachmentMatchesSource(
  attachment: any,
  source: PaperWorkspaceContentSource,
) {
  const actualLibraryID = Number(attachment.libraryID);
  const actualAttachmentKey = String(
    attachment.key ?? attachment.id ?? "",
  ).trim();
  if (
    actualLibraryID !== source.libraryID ||
    actualAttachmentKey !== source.attachmentKey
  ) {
    throw new Error(
      "Resolved PDF attachment does not match the requested source identity.",
    );
  }
}

export async function buildPaperContentFingerprint(
  attachment: any,
  filePath?: string,
  options: PDFReadOptions = {},
): Promise<PaperContentFingerprint> {
  const version = Number(attachment.version);
  let fileSize: number | undefined;
  let modifiedTime: number | undefined;
  const ioUtils = (
    globalThis as typeof globalThis & {
      IOUtils?: {
        stat?: (path: string) => Promise<Record<string, unknown>>;
      };
    }
  ).IOUtils;
  if (filePath && ioUtils?.stat) {
    try {
      const statFile = ioUtils.stat.bind(ioUtils);
      const stat = await waitForPDFRead(() => statFile(filePath), {
        timeoutMs: readTimeouts(options).stageMs,
        signal: options.signal,
        stage: "Checking the PDF file",
      });
      const size = Number(stat.size);
      const modified = Number(stat.lastModified);
      if (Number.isFinite(size) && size >= 0) fileSize = size;
      if (Number.isFinite(modified) && modified >= 0) modifiedTime = modified;
    } catch (error) {
      if (interruptedPDFRead(error)) throw error;
      // Zotero version and dateModified remain a conservative fallback.
    }
  }
  const dateModified = String(
    attachment.getField?.("dateModified") ?? attachment.dateModified ?? "",
  ).trim();
  const zoteroVersion =
    Number.isFinite(version) && version >= 0 ? version : undefined;
  return {
    algorithm: "zotero-version-mtime-size-v1",
    value: [
      zoteroVersion ?? "unknown",
      fileSize ?? "unknown",
      modifiedTime ?? "unknown",
      dateModified || "unknown",
    ].join(":"),
    ...(fileSize !== undefined ? { fileSize } : {}),
    ...(modifiedTime !== undefined ? { modifiedTime } : {}),
    ...(zoteroVersion !== undefined ? { zoteroVersion } : {}),
  };
}

export async function resolvePdfAttachment(item: any) {
  if (item.isAttachment()) {
    if (isPdfFileAttachment(item)) return item;
    throw new Error("Attachment is not a PDF");
  }

  const attachments = item.getAttachments();
  for (const attachmentID of attachments) {
    const attachment = Zotero.Items.get(attachmentID);
    if (isPdfFileAttachment(attachment)) return attachment;
  }

  return undefined;
}

function fileURLToPathString(fileUrl: string) {
  return decodeURIComponent(new URL(fileUrl).pathname);
}

async function pathExists(path: string) {
  try {
    return await IOUtils.exists(path);
  } catch {
    return false;
  }
}

interface JarCopy {
  promise: Promise<string>;
  controller: AbortController;
  readers: number;
}
const jarCopies = new Map<string, JarCopy>();

async function fetchBundledJarToProfile(
  rootUri: string,
  options: PDFReadOptions,
): Promise<string> {
  throwIfPDFReadAborted(options.signal);
  const profilePath = getZoteroProfilePath();
  if (!profilePath)
    throw new Error("Could not resolve the Zotero profile directory.");
  const cacheDir = PathUtils.join(profilePath, "paperpilot-tools");
  const cachePath = PathUtils.join(
    cacheDir,
    `opendataloader-pdf-cli-${openDataLoaderVersion}.jar`,
  );
  const key = `${rootUri}:${cachePath}`;
  const awaitCopy = async (entry: JarCopy) => {
    entry.readers++;
    try {
      return await waitForPDFRead(entry.promise, {
        timeoutMs: readTimeouts(options).stageMs,
        signal: options.signal,
        stage: "Preparing the PDF extractor",
      });
    } finally {
      if (--entry.readers === 0) entry.controller.abort();
    }
  };
  const pending = jarCopies.get(key);
  if (pending) {
    if (pending.controller.signal.aborted) {
      // A prior last reader canceled. Let that copy settle before retrying so
      // its writes cannot compete with a replacement copy.
      await waitForPDFRead(
        pending.promise.catch(() => {}),
        {
          timeoutMs: readTimeouts(options).stageMs,
          signal: options.signal,
          stage: "Waiting for the previous PDF extractor preparation",
        },
      );
      return fetchBundledJarToProfile(rootUri, options);
    }
    return awaitCopy(pending);
  }
  const controller = createPDFReadController();
  const stage = <T>(
    action: (() => T | PromiseLike<T>) | PromiseLike<T>,
    label: string,
  ) =>
    waitForPDFRead(action, {
      timeoutMs: readTimeouts(options).stageMs,
      signal: controller.signal,
      stage: label,
    });
  const copy = (async () => {
    // Packed XPIs use jar:file: roots, which WHATWG URL cannot use as a base.
    const bundledJarUrl = rootUri.startsWith("jar:")
      ? `chrome://${config.addonRef}/content/vendor/opendataloader/opendataloader-pdf-cli.jar`
      : `${rootUri.replace(/\/$/, "")}/chrome/content/vendor/opendataloader/opendataloader-pdf-cli.jar`;
    let bundled: Uint8Array<ArrayBuffer>;
    const http = (globalThis as any).Zotero?.HTTP;
    if (http?.request) {
      bundled = new Uint8Array(
        (
          await stage<any>(
            () =>
              http.request("GET", bundledJarUrl, {
                responseType: "arraybuffer",
                timeout: readTimeouts(options).stageMs,
              }),
            "Reading the bundled PDF extractor",
          )
        ).response,
      );
    } else {
      const response = await stage(
        () => fetch(bundledJarUrl, { signal: controller.signal }),
        "Reading the bundled PDF extractor",
      );
      if (!response.ok)
        throw new Error(
          `Could not read the bundled OpenDataLoader asset (${response.status}).`,
        );
      bundled = new Uint8Array(
        await stage(
          () => response.arrayBuffer(),
          "Reading the PDF extractor bytes",
        ),
      );
    }
    if (!bundled.length)
      throw new Error("The bundled OpenDataLoader asset is empty.");
    // Compare against the installed bundle, including same-version replacements.
    // A partial or old profile copy must never masquerade as the current extractor.
    if (
      await stage(
        () => pathExists(cachePath),
        "Checking the PDF extractor cache",
      )
    ) {
      const cached = new Uint8Array(
        await stage<ArrayBuffer>(
          () => IOUtils.read(cachePath),
          "Reading the PDF extractor cache",
        ),
      );
      if (
        cached.length === bundled.length &&
        cached.every((byte: number, index: number) => byte === bundled[index])
      )
        return cachePath;
    }
    await stage(
      () => IOUtils.makeDirectory(cacheDir, { ignoreExisting: true }),
      "Preparing the PDF extractor cache",
    );
    const tmpPath = `${cachePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      throwIfPDFReadAborted(controller.signal);
      // Native atomic writes cannot be canceled. Readers have their own bound,
      // but retain this shared entry and its temporary file until the actual
      // write settles, so a retry cannot race a late cache replacement.
      await IOUtils.write(cachePath, bundled, { tmpPath, flush: true });
      throwIfPDFReadAborted(controller.signal);
    } finally {
      await waitForPDFRead(
        () => IOUtils.remove?.(tmpPath, { ignoreAbsent: true }),
        {
          timeoutMs: readTimeouts(options).cleanupMs,
          stage: "Cleaning the PDF extractor cache temporary file",
        },
      );
    }
    return cachePath;
  })();
  const entry: JarCopy = { promise: copy, controller, readers: 0 };
  jarCopies.set(key, entry);
  const release = () => {
    if (jarCopies.get(key) === entry) jarCopies.delete(key);
  };
  void copy.then(release, release);
  return awaitCopy(entry);
}

export async function resolveOpenDataLoaderJarPath(
  options?: PDFReadOptions & {
    rootUri?: string;
    exists?: (path: string) => Promise<boolean>;
  },
) {
  const readOptions = options ?? {};
  const stage = <T>(action: () => T | PromiseLike<T>) =>
    waitForPDFRead(action, {
      timeoutMs: readTimeouts(readOptions).stageMs,
      signal: readOptions.signal,
      stage: "Locating the PDF extractor",
    });
  const exists = options?.exists ?? pathExists;
  const rootUri =
    options?.rootUri ??
    ((typeof _globalThis !== "undefined" && _globalThis.rootURI) ||
      (globalThis as typeof globalThis & { rootURI?: string }).rootURI ||
      "");
  const candidates: string[] = [];
  let bundleError: unknown;

  if (rootUri) {
    try {
      const bundledPath = await fetchBundledJarToProfile(rootUri, readOptions);
      if (await stage(() => exists(bundledPath))) {
        return bundledPath;
      }
    } catch (error) {
      if (interruptedPDFRead(error)) throw error;
      bundleError = error;
      // Fall back to the development-time node_modules lookup below.
    }
  }

  if (rootUri.startsWith("file:")) {
    const normalizedRootUri = rootUri.endsWith("/") ? rootUri : `${rootUri}/`;
    const searchRoots = [
      new URL(".", normalizedRootUri),
      new URL("../", normalizedRootUri),
      new URL("../../", normalizedRootUri),
      new URL("../../../", normalizedRootUri),
    ];

    for (const base of searchRoots) {
      candidates.push(
        fileURLToPathString(
          new URL(
            "node_modules/@opendataloader/pdf/lib/opendataloader-pdf-cli.jar",
            base,
          ).href,
        ),
      );
    }
  }

  for (const candidate of candidates) {
    if (await stage(() => exists(candidate))) {
      return candidate;
    }
  }

  throw new Error(
    `Could not locate the OpenDataLoader PDF runtime assets in the bundled addon or node_modules.${bundleError ? ` Bundled asset: ${String(bundleError)}` : !rootUri ? " The addon resource URI is unavailable." : ""}`,
  );
}

export function buildOpenDataLoaderScript(params: {
  jarPath: string;
  inputPath: string;
  outputDir: string;
  exitCodePath: string;
  pidPath: string;
  stderrPath: string;
}) {
  const environment = buildCodexCommandEnvironment("java");
  const exports = Object.entries(environment)
    .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1]))
    .map(([key, value]) => shellExportLine(key, value));
  const command = [
    "java",
    "-jar",
    params.jarPath,
    params.inputPath,
    "--output-dir",
    params.outputDir,
    "--format",
    "markdown,json",
    "--quiet",
    "--use-struct-tree",
    "--reading-order",
    "xycut",
    "--table-method",
    "cluster",
    "--markdown-page-separator",
    "\n\n<!-- page %page-number% -->\n\n",
  ]
    .map(shellEscape)
    .join(" ");

  return [
    ...exports,
    `rm -f ${shellEscape(params.exitCodePath)} ${shellEscape(params.pidPath)} ${shellEscape(params.stderrPath)}`,
    `(${command} > /dev/null 2> ${shellEscape(params.stderrPath)}; printf '%s' $? > ${shellEscape(params.exitCodePath)}) & echo $! > ${shellEscape(params.pidPath)}`,
  ].join(" && ");
}

async function listDirectoryFiles(path: string) {
  const files: string[] = [];
  await Zotero.File.iterateDirectory(
    path,
    async (entry: { isDir?: boolean; path: string }) => {
      if (!entry.isDir) {
        files.push(entry.path);
      }
    },
  );
  return files;
}

async function readTextFile(path: string) {
  return String(
    (await Promise.resolve(Zotero.File.getContentsAsync(path, "utf-8"))) || "",
  );
}

let javaRuntimeAvailable: boolean | undefined;
let javaFailureLogged = false;

async function probeJavaWithExitStatus() {
  // subprocess() resolves even when the script fails, so read the status.
  const result = parseExitStatusMarker(
    await Zotero.Utilities.Internal.subprocess("/bin/zsh", [
      "-lc",
      withExitStatusMarker(
        "command -v java >/dev/null 2>&1 && java -version >/dev/null 2>&1",
      ),
    ]),
  );
  if (result.exitCode !== 0)
    throw new Error(
      `Java runtime probe exited with status ${result.exitCode ?? "unknown"}.`,
    );
}

export async function probeJavaRuntime(
  probe: () => Promise<unknown> = probeJavaWithExitStatus,
  options: PDFReadOptions = {},
) {
  throwIfPDFReadAborted(options.signal);
  if (javaRuntimeAvailable !== undefined) return javaRuntimeAvailable;
  try {
    await waitForPDFRead(probe, {
      timeoutMs: readTimeouts(options).javaMs,
      signal: options.signal,
      stage: "Checking Java for PDF extraction",
    });
    javaRuntimeAvailable = true;
  } catch (error) {
    if (interruptedPDFRead(error)) throw error;
    javaRuntimeAvailable = false;
    if (!javaFailureLogged) {
      javaFailureLogged = true;
      (globalThis as any).Zotero?.logError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
  return javaRuntimeAvailable;
}

export function resetJavaRuntimeProbeForTests() {
  javaRuntimeAvailable = undefined;
  javaFailureLogged = false;
}

export class ExtractorCleanupUnconfirmedError extends Error {
  constructor(
    readonly outputDirectory: string,
    failure: unknown,
  ) {
    super(
      `PDF extractor cleanup is unconfirmed. Preserved ${outputDirectory}: ${String(failure)}`,
    );
    this.name = "ExtractorCleanupUnconfirmedError";
  }
}

export async function withOpenDataLoaderOutputCleanup<T>(
  outputDir: string,
  action: () => Promise<T>,
  remove: (path: string) => Promise<unknown> = (path) =>
    IOUtils.remove(path, { recursive: true, ignoreAbsent: true }),
  cleanupTimeoutMs = PDF_READ_TIMEOUTS.cleanupMs,
): Promise<T> {
  let retain = false;
  try {
    return await action();
  } catch (error) {
    retain = error instanceof ExtractorCleanupUnconfirmedError;
    throw error;
  } finally {
    if (!retain)
      await waitForPDFRead(() => remove(outputDir), {
        timeoutMs: cleanupTimeoutMs,
        stage: "Cleaning PDF extraction temporary files",
      });
  }
}

function confirmedExitStatus(value: string) {
  return /^\d{1,3}$/.test(value.trim()) && Number(value.trim()) <= 255;
}

type ExtractorStop = (
  processId: string | undefined,
  options: { requireProcessId?: boolean },
  deadline: number,
) => Promise<void>;

async function confirmExtractorStopped(params: {
  exitCodePath: string;
  pidPath: string;
  read: (path: string) => Promise<string>;
  stop: ExtractorStop;
  cleanupTimeoutMs: number;
}) {
  const directory = params.pidPath.replace(/[\\/][^\\/]+$/, "");
  const deadline = Date.now() + params.cleanupTimeoutMs;
  const cleanup = <T>(action: () => T | PromiseLike<T>, stage: string) =>
    waitForPDFRead(action, {
      timeoutMs: Math.max(0, deadline - Date.now()),
      stage,
    });
  const read = async (path: string) => {
    try {
      return await cleanup(
        () => params.read(path),
        "Checking PDF extractor shutdown",
      );
    } catch (error) {
      if (interruptedPDFRead(error)) throw error;
      return "";
    }
  };
  try {
    if (confirmedExitStatus(await read(params.exitCodePath))) return;
    const pid = (await read(params.pidPath)).trim();
    await cleanup(
      () => params.stop(pid, { requireProcessId: true }, deadline),
      "Stopping the PDF extractor",
    );
  } catch (error) {
    throw new ExtractorCleanupUnconfirmedError(directory, error);
  }
}

export async function waitForExtractorCompletion(params: {
  exitCodePath: string;
  pidPath: string;
  stderrPath: string;
  timeoutMs?: number;
  stageTimeoutMs?: number;
  cleanupTimeoutMs?: number;
  read?: (path: string) => Promise<string>;
  stop?: ExtractorStop;
  delay?: (milliseconds: number) => Promise<void>;
  signal?: AbortSignal;
}) {
  const read = params.read ?? readTextFile;
  const stop = params.stop ?? stopDetachedRunProcess;
  const delay =
    params.delay ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = params.timeoutMs ?? STRUCTURED_EXTRACTION_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const stage = <T>(action: () => T | PromiseLike<T>, name: string) =>
    waitForPDFRead(action, {
      timeoutMs: Math.max(
        0,
        Math.min(
          params.stageTimeoutMs ?? PDF_READ_TIMEOUTS.stageMs,
          deadline - Date.now(),
        ),
      ),
      signal: params.signal,
      stage: name,
    });
  let exited = false;
  try {
    while (Date.now() < deadline) {
      throwIfPDFReadAborted(params.signal);
      let exitCode = "";
      try {
        exitCode = (
          await stage(
            () => read(params.exitCodePath),
            "Reading PDF extraction status",
          )
        ).trim();
      } catch (error) {
        if (interruptedPDFRead(error)) throw error;
      }
      if (exitCode) {
        exited = confirmedExitStatus(exitCode);
        if (!exited)
          throw new Error("The PDF extractor returned an invalid exit status.");
        if (exitCode !== "0") {
          let stderr = "";
          try {
            stderr = await stage(
              () => read(params.stderrPath),
              "Reading PDF extraction diagnostics",
            );
          } catch (error) {
            if (interruptedPDFRead(error)) throw error;
          }
          throw new Error(
            `OpenDataLoader PDF exited with code ${exitCode}.${stderr ? ` ${stderr.trim()}` : ""}`,
          );
        }
        return;
      }
      await stage(
        () => delay(STRUCTURED_EXTRACTION_POLL_MS),
        "Waiting for PDF extraction",
      );
    }
    throw new PDFReadTimeoutError("OpenDataLoader PDF extraction", timeoutMs);
  } catch (error) {
    if (!exited)
      await confirmExtractorStopped({
        exitCodePath: params.exitCodePath,
        pidPath: params.pidPath,
        read,
        stop,
        cleanupTimeoutMs:
          params.cleanupTimeoutMs ?? PDF_READ_TIMEOUTS.cleanupMs,
      });
    throw error;
  }
}

/** Verify a late saved PID still belongs to this extractor before signaling it. */
async function stopOwnedExtractor(
  pid: string | undefined,
  directory: string,
  deadline: number,
) {
  if (
    !pid ||
    !/^[1-9]\d*$/.test(pid) ||
    !Number.isSafeInteger(Number(pid)) ||
    Number(pid) <= 1
  )
    throw new Error("The PDF extractor did not provide a valid pid.");
  const result = parseExitStatusMarker(
    await waitForPDFRead(
      () =>
        Zotero.Utilities.Internal.subprocess("/bin/zsh", [
          "-lc",
          withExitStatusMarker(`/bin/ps -ww -o command= -p ${pid}`),
        ]),
      {
        timeoutMs: Math.max(0, deadline - Date.now()),
        stage: "Checking PDF extractor process ownership",
      },
    ),
  );
  if (result.exitCode === 1 && !result.output.trim()) return;
  const prefix = `${directory}/`;
  if (
    result.exitCode !== 0 ||
    (!result.output.includes(prefix) &&
      !result.output.includes(shellEscape(prefix).slice(1, -1)))
  )
    throw new Error(
      "The saved PID no longer identifies the PDF extractor; no process was stopped.",
    );
  await waitForPDFRead(
    () => stopDetachedRunProcess(pid, { requireProcessId: true }),
    {
      timeoutMs: Math.max(0, deadline - Date.now()),
      stage: "Stopping the PDF extractor",
    },
  );
}

export async function extractStructuredPdf(
  filePath: string,
  signal?: AbortSignal,
  options: PDFReadOptions & { outputRoot?: string } = {},
): Promise<StructuredExtractionResult> {
  const readOptions = { ...options, signal };
  const budgets = readTimeouts(readOptions);
  const stage = <T>(
    action: (() => T | PromiseLike<T>) | PromiseLike<T>,
    name: string,
  ) =>
    waitForPDFRead(action, {
      timeoutMs: budgets.stageMs,
      signal,
      stage: name,
    });
  throwIfPDFReadAborted(signal);
  options.onStatus?.("Checking Java for structured PDF extraction…");
  if (!(await probeJavaRuntime(undefined, readOptions)))
    throw new Error("java-missing");
  options.onStatus?.("Preparing the PDF extractor…");
  const jarPath = await resolveOpenDataLoaderJarPath(readOptions);
  throwIfPDFReadAborted(signal);
  const creating = Promise.resolve().then(() => {
    throwIfPDFReadAborted(signal);
    return IOUtils.createUniqueDirectory(
      options.outputRoot ??
        `${Zotero.getTempDirectory().path}/paper-pilot-opendataloader`,
      "run",
    ) as Promise<string>;
  });
  const remove = (path: string) =>
    waitForPDFRead(
      () => IOUtils.remove(path, { recursive: true, ignoreAbsent: true }),
      {
        timeoutMs: budgets.cleanupMs,
        stage: "Cleaning PDF extraction temporary files",
      },
    );
  const logCleanupFailure = (error: unknown) =>
    Zotero.logError?.(
      error instanceof Error ? error : new Error(String(error)),
    );
  let outputDir: string;
  try {
    outputDir = await stage(
      creating,
      "Preparing PDF extraction temporary files",
    );
  } catch (error) {
    // A filesystem request can finish after cancellation. It has not launched
    // anything, so remove only the unique directory that request allocated.
    void creating.then(remove).catch(logCleanupFailure);
    throw error;
  }
  const exitCodePath = `${outputDir}/extractor-exit.txt`;
  const pidPath = `${outputDir}/extractor-pid.txt`;
  const stderrPath = `${outputDir}/extractor-stderr.log`;
  const stop = () =>
    confirmExtractorStopped({
      exitCodePath,
      pidPath,
      read: readTextFile,
      stop: (pid, _options, deadline) =>
        stopOwnedExtractor(pid, outputDir, deadline),
      cleanupTimeoutMs: budgets.cleanupMs,
    });
  return withOpenDataLoaderOutputCleanup(
    outputDir,
    async () => {
      let stopped = false;
      let launched = false;
      let launchSettled = false;
      let launchTask: ReturnType<typeof launchDetachedShellScript> | undefined;
      try {
        await stage(
          () =>
            IOUtils.writeUTF8(`${outputDir}/launch-intent`, "opendataloader"),
          "Preparing PDF extractor launch",
        );
        throwIfPDFReadAborted(signal);
        options.onStatus?.("Extracting structured PDF text…");
        launched = true;
        launchTask = launchDetachedShellScript(
          buildOpenDataLoaderScript({
            jarPath,
            inputPath: filePath,
            outputDir,
            exitCodePath,
            pidPath,
            stderrPath,
          }),
          (executable, args) =>
            Zotero.Utilities.Internal.exec(executable, args),
        ).then((result) => {
          launchSettled = true;
          return result;
        });
        const launch = await stage(launchTask, "Starting the PDF extractor");
        if (!launch.ok) throw new Error(launch.error);
        await waitForExtractorCompletion({
          exitCodePath,
          pidPath,
          stderrPath,
          signal,
          timeoutMs: budgets.runMs,
          stageTimeoutMs: budgets.stageMs,
          cleanupTimeoutMs: budgets.cleanupMs,
          stop: async (pid, _options, deadline) => {
            await stopOwnedExtractor(pid, outputDir, deadline);
            stopped = true;
          },
        });
        stopped = true;
      } catch (error) {
        if (error instanceof ExtractorCleanupUnconfirmedError) throw error;
        if (launched && !stopped) {
          if (!launchSettled && launchTask) {
            // A timed-out launch can still create a process later. Keep its
            // evidence, observe the late result, and only remove after its stop.
            void launchTask
              .then(async () => {
                await stop();
                await remove(outputDir);
              })
              .catch(logCleanupFailure);
            throw new ExtractorCleanupUnconfirmedError(outputDir, error);
          }
          await stop();
        }
        throw error;
      }
      options.onStatus?.("Reading the extracted PDF text…");
      const files = await stage(
        () => listDirectoryFiles(outputDir),
        "Listing extracted PDF files",
      );
      const markdownPath = files.find((path) => path.endsWith(".md"));
      const jsonPath = files.find((path) => path.endsWith(".json"));
      if (!markdownPath || !jsonPath)
        throw new Error(
          "OpenDataLoader PDF did not produce both Markdown and JSON outputs.",
        );
      const markdownText = await stage(
        () => readTextFile(markdownPath),
        "Reading extracted PDF text",
      );
      const jsonText = await stage(
        () => readTextFile(jsonPath),
        "Reading extracted PDF structure",
      );
      if (!markdownText.trim() || !jsonText.trim())
        throw new Error(
          "OpenDataLoader PDF produced empty Markdown or JSON output.",
        );
      throwIfPDFReadAborted(signal);
      try {
        return { markdownText, structuredContent: JSON.parse(jsonText) };
      } catch (error) {
        throw new Error(
          `OpenDataLoader PDF returned invalid JSON output. ${String(error instanceof Error ? error.message : error)}`,
        );
      }
    },
    remove,
    budgets.cleanupMs,
  );
}

export const paperWorkspaceContentCache = new PaperWorkspaceContentCache();
