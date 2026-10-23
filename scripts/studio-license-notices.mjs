import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

/** Include installed production dependency notices in the packaged add-on. */
export async function writeStudioLicenseNotices(outputDirectory) {
  const root = resolve(import.meta.dirname, "..");
  const lock = JSON.parse(
    await readFile(join(root, "package-lock.json"), "utf8"),
  );
  const seen = new Set();
  const notices = [
    "Paper Pilot production dependency license notices\nVersions and integrity hashes are pinned in package-lock.json.\n",
  ];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path.includes("node_modules/") || entry.dev || entry.link) continue;
    const directory = join(root, path);
    let pkg;
    try {
      pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    } catch (error) {
      if (entry.optional && error.code === "ENOENT") continue;
      throw error;
    }
    const identity = `${pkg.name}@${pkg.version}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const names = (await readdir(directory)).filter((name) =>
      /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(name),
    );
    const repository =
      typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    notices.push(
      `\n${"=".repeat(72)}\n${identity}\nLicense: ${pkg.license || "See upstream notice"}\nSource: ${repository || pkg.homepage || entry.resolved || "npm registry"}\n`,
    );
    for (const name of names) {
      try {
        notices.push(
          `\n--- ${name} ---\n${await readFile(join(directory, name), "utf8")}\n`,
        );
      } catch (error) {
        if (error.code !== "EISDIR") throw error;
      }
    }
  }
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, "THIRD-PARTY.txt"), notices.join("\n"));
  await writeFile(
    join(outputDirectory, "SOURCE-NOTICE.txt"),
    [
      "Paper Pilot source: https://github.com/meghendra6/PaperPilot",
      "License: GNU AGPL version 3 or later; see the repository LICENSE.",
      "",
      "Bundled editor: superdoc 1.47.2, GNU AGPL version 3.",
      "Exact npm artifact (includes original sources in dist/superdoc.min.js.map sourcesContent):",
      "https://registry.npmjs.org/superdoc/-/superdoc-1.47.2.tgz",
      "npm integrity: sha512-ueTZHIvtglJMIKomBrjhz/aXFSabXvSmDdKGt7ZIj04+U2yCD/XhopvtclQMvxgMipIU7FY7XyU29wCwvtVSlA==",
      "Upstream v1 source and build instructions: https://github.com/superdoc/docx-editor/tree/v1",
      "The v1 branch is mutable; package-lock.json and the npm integrity identify the bundled artifact.",
      "SuperDoc v2's separately licensed docx-engine is not included.",
      "Paper Pilot modifies the v1 endnote export router at build time; the patch source is scripts/studio-editor-compat.mjs in the Paper Pilot source repository.",
      "Bundled-code notices also appear in client.js.LEGAL.txt.",
      "",
    ].join("\n"),
  );
}
