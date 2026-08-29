import { buildCodexCommandEnvironment } from "../codex/environment";
import { shellEscape } from "../codex/shell";
import { getZoteroProfilePath } from "../../utils/zoteroProfile";

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

const EXTRACTOR_VERSION = "opendataloader-pdf@2.2.0|zotero-attachment-text@1";
const EXTRACTION_OPTIONS_VERSION = "reading-order-xycut-v1";
const MAX_CACHE_ENTRIES = 12;

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
    const fallbackText = await Promise.resolve(attachment.attachmentText || "");
    const extractionNotes: string[] = [];

    if (filePath) {
      try {
        const structured = await extractStructuredPdf(filePath);
        return {
          fullText: structured.markdownText || fallbackText,
          markdownText: structured.markdownText,
          structuredContent: structured.structuredContent,
          extractionMethod: "opendataloader-pdf",
          extractionNotes,
          source,
          contentFingerprint,
        };
      } catch (error) {
        extractionNotes.push(
          `OpenDataLoader PDF extraction unavailable; fell back to Zotero attachment text. ${String(
            error instanceof Error ? error.message : error,
          )}`,
        );
      }
    } else {
      extractionNotes.push(
        "OpenDataLoader PDF extraction unavailable because the local PDF file path could not be resolved.",
      );
    }

    return {
      fullText: fallbackText,
      extractionMethod: "zotero-attachment-text",
      extractionNotes,
      source,
      contentFingerprint,
    };
  }
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

async function fetchBundledJarToProfile(rootUri: string) {
  const profilePath = getZoteroProfilePath();
  if (!profilePath) {
    throw new Error("Could not resolve the Zotero profile directory.");
  }

  const cacheDir = PathUtils.join(profilePath, "paperpilot-tools");
  const cachePath = PathUtils.join(cacheDir, "opendataloader-pdf-cli.jar");

  if (await pathExists(cachePath)) {
    return cachePath;
  }

  const normalizedRootUri = rootUri.endsWith("/") ? rootUri : `${rootUri}/`;
  const bundledJarUrl = new URL(
    "chrome/content/vendor/opendataloader/opendataloader-pdf-cli.jar",
    normalizedRootUri,
  ).href;
  const response = await fetch(bundledJarUrl);
  if (!response.ok) {
    throw new Error(
      `Could not read the bundled OpenDataLoader asset (${response.status}).`,
    );
  }

  await IOUtils.makeDirectory(cacheDir, { ignoreExisting: true });
  await IOUtils.write(cachePath, new Uint8Array(await response.arrayBuffer()));
  return cachePath;
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

function buildOpenDataLoaderScript(params: {
  jarPath: string;
  inputPath: string;
  outputDir: string;
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

  return [...exports, command].join(" && ");
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

async function extractStructuredPdf(
  filePath: string,
): Promise<StructuredExtractionResult> {
  const jarPath = await resolveOpenDataLoaderJarPath();
  const outputDir = await IOUtils.createUniqueDirectory(
    `${Zotero.getTempDirectory().path}/paper-pilot-opendataloader`,
    "run",
  );

  try {
    const result = await Zotero.Utilities.Internal.exec("/bin/zsh", [
      "-lc",
      buildOpenDataLoaderScript({
        jarPath,
        inputPath: filePath,
        outputDir,
      }),
    ]);
    if (result instanceof Error) {
      throw result;
    }
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
}

export const paperWorkspaceContentCache = new PaperWorkspaceContentCache();
