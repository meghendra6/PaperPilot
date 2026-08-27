import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const buildDir = path.join(root, "build");
const distDir = path.join(root, "dist");
const xpiPath = path.join(
  distDir,
  "paperpilot-research-workspace-0.3.0-rebuilt.xpi",
);

if (!fs.existsSync(path.join(buildDir, "manifest.json"))) {
  const build = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "build.mjs")],
    {
      stdio: "inherit",
    },
  );
  if (build.status !== 0) process.exit(build.status ?? 1);
}

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(xpiPath, { force: true });
const result = spawnSync("zip", ["-X", "-q", "-r", xpiPath, "."], {
  cwd: buildDir,
  stdio: "inherit",
});
if (result.status !== 0) {
  throw new Error("The system 'zip' command failed while packaging the XPI.");
}
console.log(xpiPath);
