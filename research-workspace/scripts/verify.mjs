import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createRuntimeLoader,
  projectRoot,
  readModuleOrder,
} from "./module-loader.mjs";

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function runNode(script) {
  const result = spawnSync(process.execPath, [script], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const order = readModuleOrder();
const load = createRuntimeLoader();
for (const id of order) load(id);
console.log(
  `Loaded ${order.length} runtime modules without syntax/link errors.`,
);

runNode(path.join(projectRoot, "tests", "run.mjs"));
runNode(path.join(projectRoot, "scripts", "build.mjs"));

const builtBundle = path.join(
  projectRoot,
  "build",
  "content",
  "scripts",
  "paperpilot-research-workspace.js",
);
const expectedHashPath = path.join(
  projectRoot,
  "build-support",
  "runtime.sha256",
);
const builtHash = sha256(builtBundle);
const expectedHash = fs.readFileSync(expectedHashPath, "utf8").trim();
if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
  throw new Error(`Invalid expected runtime SHA-256 in ${expectedHashPath}`);
}
if (builtHash !== expectedHash) {
  throw new Error(
    `Runtime bundle does not match the reviewed source hash.\n` +
      `built:     ${builtHash}\nexpected:  ${expectedHash}`,
  );
}
console.log(`Runtime bundle matches reviewed source hash: ${builtHash}`);

runNode(path.join(projectRoot, "scripts", "package-xpi.mjs"));
const rebuiltXpi = path.join(
  projectRoot,
  "dist",
  "paperpilot-research-workspace-0.3.0-rebuilt.xpi",
);
const listing = spawnSync("unzip", ["-Z1", rebuiltXpi], { encoding: "utf8" });
if (listing.status !== 0) throw new Error("Unable to inspect rebuilt XPI.");
const integrity = spawnSync("unzip", ["-t", rebuiltXpi], { encoding: "utf8" });
if (integrity.status !== 0)
  throw new Error("Rebuilt XPI failed integrity check.");
const entries = listing.stdout.trim().split(/\r?\n/).filter(Boolean);
const required = [
  "bootstrap.js",
  "manifest.json",
  "content/scripts/paperpilot-research-workspace.js",
  "content/research-workspace.css",
  "content/icon.svg",
  "locale/en-US/main.ftl",
  "locale/ko-KR/main.ftl",
];
for (const entry of required) {
  if (!entries.includes(entry))
    throw new Error(`Rebuilt XPI is missing ${entry}`);
}
const packedManifestResult = spawnSync(
  "unzip",
  ["-p", rebuiltXpi, "manifest.json"],
  { encoding: "utf8" },
);
if (packedManifestResult.status !== 0) {
  throw new Error("Unable to read the rebuilt XPI manifest.");
}
const packedManifest = JSON.parse(packedManifestResult.stdout);
const zoteroManifest = packedManifest.applications?.zotero;
if (
  zoteroManifest?.id !== "paperpilot-research-workspace@meghendra6" ||
  !/^https:\/\//.test(zoteroManifest.update_url ?? "") ||
  zoteroManifest.strict_max_version !== "10.0.*"
) {
  throw new Error("Rebuilt XPI has invalid Zotero install metadata.");
}
console.log(
  `Rebuilt XPI verified: ${entries.length} entries, ${fs.statSync(rebuiltXpi).size} bytes.`,
);
