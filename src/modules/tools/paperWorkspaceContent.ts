import { version as openDataLoaderVersion } from "../../../node_modules/@opendataloader/pdf/package.json";
import { getZoteroProfilePath } from "../../utils/zoteroProfile";
import { launchDetachedShellScript } from "../ai/launchScript";
import { stopDetachedRunProcess } from "../ai/runCompletion";
import { buildCodexCommandEnvironment } from "../codex/environment";
import { shellEscape } from "../codex/shell";

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

export interface PaperWorkspaceContentOptions {
  attachment?: any;
  source?: PaperWorkspaceContentSource;
}

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
    const attachment = options.attachment ?? (await resolvePdfAttachment(item));
    if (!attachment) {
      throw new Error("No PDF attachment found for this item");
    }
    const source =
      options.source ?? buildPaperWorkspaceContentSource(item, attachment);
    assertAttachmentMatchesSource(attachment, source);
    const filePath = await attachment.getFilePathAsync();
    const contentFingerprint = await buildPaperContentFingerprint(
      attachment,
      filePath,
    );
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
    );
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
  ): Promise<PaperWorkspaceContent> {
    const extractionNotes: string[] = [];

    if (filePath) {
      try {
        const structured = await extractStructuredPdf(filePath);
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

    const fallbackText = await Promise.resolve(attachment.attachmentText || "");
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
      const stat = await ioUtils.stat(filePath);
      const size = Number(stat.size);
      const modified = Number(stat.lastModified);
      if (Number.isFinite(size) && size >= 0) fileSize = size;
      if (Number.isFinite(modified) && modified >= 0) modifiedTime = modified;
    } catch {
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
    if (
      item.attachmentContentType === "application/pdf" ||
      item.attachmentContentType === ""
    ) {
      return item;
    }
    throw new Error("Attachment is not a PDF");
  }

  const attachments = item.getAttachments();
  for (const attachmentID of attachments) {
    const attachment = Zotero.Items.get(attachmentID);
    if (
      attachment &&
      (attachment.attachmentContentType === "application/pdf" ||
        attachment.attachmentContentType === "")
    ) {
      return attachment;
    }
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

const jarCopies = new Map<string, Promise<string>>();

async function fetchBundledJarToProfile(rootUri: string): Promise<string> {
  const profilePath = getZoteroProfilePath();
  if (!profilePath)
    throw new Error("Could not resolve the Zotero profile directory.");
  const cacheDir = PathUtils.join(profilePath, "paperpilot-tools");
  const cachePath = PathUtils.join(
    cacheDir,
    `opendataloader-pdf-cli-${openDataLoaderVersion}.jar`,
  );
  const key = `${rootUri}:${cachePath}`;
  const pending = jarCopies.get(key);
  if (pending) return pending;
  const copy = (async () => {
    const bundledJarUrl = new URL(
      "chrome/content/vendor/opendataloader/opendataloader-pdf-cli.jar",
      rootUri.endsWith("/") ? rootUri : `${rootUri}/`,
    ).href;
    const response = await fetch(bundledJarUrl);
    if (!response.ok)
      throw new Error(
        `Could not read the bundled OpenDataLoader asset (${response.status}).`,
      );
    const bundled = new Uint8Array(await response.arrayBuffer());
    if (!bundled.length)
      throw new Error("The bundled OpenDataLoader asset is empty.");
    // Compare against the installed bundle, including same-version replacements.
    // A partial or old profile copy must never masquerade as the current extractor.
    if (await pathExists(cachePath)) {
      const cached = new Uint8Array(await IOUtils.read(cachePath));
      if (
        cached.length === bundled.length &&
        cached.every((byte: number, index: number) => byte === bundled[index])
      )
        return cachePath;
    }
    await IOUtils.makeDirectory(cacheDir, { ignoreExisting: true });
    const tmpPath = `${cachePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await IOUtils.write(cachePath, bundled, { tmpPath, flush: true });
    } finally {
      await IOUtils.remove?.(tmpPath, { ignoreAbsent: true });
    }
    return cachePath;
  })();
  jarCopies.set(key, copy);
  try {
    return await copy;
  } finally {
    jarCopies.delete(key);
  }
}

export async function resolveOpenDataLoaderJarPath(options?: {
  rootUri?: string;
  exists?: (path: string) => Promise<boolean>;
}) {
  const exists = options?.exists ?? pathExists;
  const rootUri =
    options?.rootUri ??
    ((globalThis as typeof globalThis & { rootURI?: string }).rootURI || "");
  const candidates: string[] = [];

  if (rootUri) {
    try {
      const bundledPath = await fetchBundledJarToProfile(rootUri);
      if (await exists(bundledPath)) {
        return bundledPath;
      }
    } catch {
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
    if (await exists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Could not locate the OpenDataLoader PDF runtime assets in the bundled addon or node_modules.",
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
    .map(([key, value]) => `export ${key}=${shellEscape(value)}`);
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

export async function probeJavaRuntime(
  probe: () => Promise<unknown> = () =>
    Zotero.Utilities.Internal.subprocess("/bin/zsh", [
      "-lc",
      "command -v java >/dev/null 2>&1 && java -version >/dev/null 2>&1",
    ]),
) {
  if (javaRuntimeAvailable !== undefined) return javaRuntimeAvailable;
  try {
    await probe();
    javaRuntimeAvailable = true;
  } catch (error) {
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

export async function withOpenDataLoaderOutputCleanup<T>(
  outputDir: string,
  action: () => Promise<T>,
  remove: (path: string) => Promise<unknown> = (path) =>
    IOUtils.remove(path, { recursive: true, ignoreAbsent: true }),
): Promise<T> {
  try {
    return await action();
  } finally {
    await remove(outputDir);
  }
}

export async function waitForExtractorCompletion(params: {
  exitCodePath: string;
  pidPath: string;
  stderrPath: string;
  timeoutMs?: number;
  read?: (path: string) => Promise<string>;
  stop?: typeof stopDetachedRunProcess;
  delay?: (milliseconds: number) => Promise<void>;
}) {
  const read = params.read ?? readTextFile;
  const stop = params.stop ?? stopDetachedRunProcess;
  const delay =
    params.delay ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const deadline =
    Date.now() + (params.timeoutMs ?? STRUCTURED_EXTRACTION_TIMEOUT_MS);
  while (Date.now() < deadline) {
    let exitCode = "";
    try {
      exitCode = (await read(params.exitCodePath)).trim();
    } catch {
      // The detached process may not have created its result file yet.
    }
    if (exitCode) {
      if (exitCode !== "0") {
        const stderr = await read(params.stderrPath).catch(() => "");
        throw new Error(
          `OpenDataLoader PDF exited with code ${exitCode}.${stderr ? ` ${stderr.trim()}` : ""}`,
        );
      }
      return;
    }
    await delay(STRUCTURED_EXTRACTION_POLL_MS);
  }

  const processId = await read(params.pidPath).catch(() => "");
  await stop(processId.trim(), { requireProcessId: true });
  throw new Error(
    `OpenDataLoader PDF extraction timed out after ${Math.round(
      (params.timeoutMs ?? STRUCTURED_EXTRACTION_TIMEOUT_MS) / 1000,
    )} seconds.`,
  );
}

async function extractStructuredPdf(
  filePath: string,
): Promise<StructuredExtractionResult> {
  if (!(await probeJavaRuntime())) throw new Error("java-missing");
  const jarPath = await resolveOpenDataLoaderJarPath();
  const outputDir = await IOUtils.createUniqueDirectory(
    `${Zotero.getTempDirectory().path}/paper-pilot-opendataloader`,
    "run",
  );
  const exitCodePath = `${outputDir}/extractor-exit.txt`;
  const pidPath = `${outputDir}/extractor-pid.txt`;
  const stderrPath = `${outputDir}/extractor-stderr.log`;

  return withOpenDataLoaderOutputCleanup(outputDir, async () => {
    try {
      const launch = await launchDetachedShellScript(
        buildOpenDataLoaderScript({
          jarPath,
          inputPath: filePath,
          outputDir,
          exitCodePath,
          pidPath,
          stderrPath,
        }),
        (executable, args) => Zotero.Utilities.Internal.exec(executable, args),
      );
      if (!launch.ok) {
        throw new Error(launch.error);
      }
      await waitForExtractorCompletion({ exitCodePath, pidPath, stderrPath });
    } catch (error) {
      throw new Error(String(error));
    }

    const files = await listDirectoryFiles(outputDir);
    const markdownPath = files.find((path) => path.endsWith(".md"));
    const jsonPath = files.find((path) => path.endsWith(".json"));

    if (!markdownPath || !jsonPath) {
      throw new Error(
        "OpenDataLoader PDF did not produce both Markdown and JSON outputs.",
      );
    }

    const markdownText = await readTextFile(markdownPath);
    const jsonText = await readTextFile(jsonPath);

    if (!markdownText.trim() || !jsonText.trim()) {
      throw new Error(
        "OpenDataLoader PDF produced empty Markdown or JSON output.",
      );
    }

    try {
      return {
        markdownText,
        structuredContent: JSON.parse(jsonText),
      };
    } catch (error) {
      throw new Error(
        `OpenDataLoader PDF returned invalid JSON output. ${String(
          error instanceof Error ? error.message : error,
        )}`,
      );
    }
  });
}

export const paperWorkspaceContentCache = new PaperWorkspaceContentCache();
