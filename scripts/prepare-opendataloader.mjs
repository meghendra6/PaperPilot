import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const source = path.join(
  root,
  "node_modules",
  "@opendataloader",
  "pdf",
  "lib",
  "opendataloader-pdf-cli.jar",
);
const target = path.join(
  root,
  "addon",
  "chrome",
  "content",
  "vendor",
  "opendataloader",
  "opendataloader-pdf-cli.jar",
);

try {
  await fs.access(source);
} catch {
  throw new Error(
    [
      "Missing OpenDataLoader runtime asset.",
      `Expected: ${source}`,
      "Run `npm install` before `npm run build`, `npm start`, or `npm run release`.",
    ].join("\n"),
  );
}

await fs.mkdir(path.dirname(target), { recursive: true });
await fs.copyFile(source, target);
const digest = createHash("sha256")
  .update(await fs.readFile(target))
  .digest("hex");
console.log(`OpenDataLoader runtime SHA-256: ${digest}`);
