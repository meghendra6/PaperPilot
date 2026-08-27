import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const buildDir = path.join(root, "build");
const addonDir = path.join(root, "addon");
const bundleDir = path.join(buildDir, "content", "scripts");
const bundlePath = path.join(bundleDir, "paperpilot-research-workspace.js");

const order = JSON.parse(
  fs.readFileSync(
    path.join(root, "build-support", "module-order.json"),
    "utf8",
  ),
);
const prefix = fs.readFileSync(
  path.join(root, "build-support", "bundle-prefix.js"),
  "utf8",
);
const suffix = fs.readFileSync(
  path.join(root, "build-support", "bundle-suffix.js"),
  "utf8",
);

fs.rmSync(buildDir, { recursive: true, force: true });
fs.cpSync(addonDir, buildDir, { recursive: true });
fs.mkdirSync(bundleDir, { recursive: true });

let bundle = prefix;
for (let index = 0; index < order.length; index += 1) {
  const id = order[index];
  const sourcePath = path.join(root, id);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing source module: ${id}`);
  }
  const source = fs.readFileSync(sourcePath, "utf8");
  bundle += `${JSON.stringify(id)}: function(module, exports, __require) {\n`;
  bundle += source;
  if (index !== order.length - 1) bundle += "\n\n},\n";
}
bundle += suffix;
fs.writeFileSync(bundlePath, bundle, "utf8");

console.log(`Bundled ${order.length} modules.`);
console.log(bundlePath);
