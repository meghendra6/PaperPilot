import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const target = path.resolve(process.argv[2] || ".");
const profile = process.argv[3];
let errors = 0;
const ok = (message) => console.log(`OK: ${message}`);
const warn = (message) => console.log(`WARN: ${message}`);
const error = (message) => {
  errors += 1;
  console.log(`ERROR: ${message}`);
};
const probe = (file, args) =>
  spawnSync(file, args, {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

if (process.platform !== "darwin" && process.platform !== "linux")
  error(
    `Local runners require a Unix environment with /bin/zsh; found ${process.platform}.`,
  );
const shell = probe("/bin/zsh", ["--version"]);
if (shell.status !== 0)
  error("/bin/zsh is unavailable; local CLI runners cannot launch.");
else {
  ok(shell.stdout.trim().split("\n")[0]);
  for (const engine of ["codex", "claude", "gemini"]) {
    const lookup = probe("/bin/zsh", ["-lc", `command -v ${engine}`]);
    const executable = lookup.stdout?.trim().split("\n").at(-1);
    if (lookup.status !== 0 || !executable || !path.isAbsolute(executable)) {
      warn(
        `${engine} is not available in the login shell. Check the plugin executable-path setting if using a custom location.`,
      );
      continue;
    }
    const version = probe(executable, ["--version"]);
    if (version.status !== 0) {
      warn(`${engine} version probe failed or timed out.`);
      continue;
    }
    ok(`${engine}: ${version.stdout.trim().split("\n")[0]}`);
    if (engine === "gemini") {
      warn(
        "Gemini authentication is unverified: its CLI has no read-only auth-status command. Check it with an explicit analysis in Zotero.",
      );
      continue;
    }
    const auth = probe(
      executable,
      engine === "codex" ? ["login", "status"] : ["auth", "status", "--json"],
    );
    let authenticated = auth.status === 0;
    if (engine === "claude" && authenticated) {
      try {
        authenticated = JSON.parse(auth.stdout).loggedIn === true;
      } catch {
        authenticated = false;
      }
    }
    // Never print auth output: it can contain account identifiers or API-key hints.
    if (authenticated)
      ok(`${engine} reports authenticated (model access is not tested).`);
    else
      warn(
        `${engine} authentication is unavailable or unverified. Run its login command manually.`,
      );
  }
}

if (!profile)
  warn(
    "Profile runtime not checked. Pass the Zotero profile directory as the second doctor.sh argument to inspect its cached JAR.",
  );
else {
  const packagePath = path.join(
    target,
    "node_modules/@opendataloader/pdf/package.json",
  );
  try {
    const { version } = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    const bundle = path.join(
      target,
      "addon/chrome/content/vendor/opendataloader/opendataloader-pdf-cli.jar",
    );
    const cache = path.join(
      profile,
      "paperpilot-tools",
      `opendataloader-pdf-cli-${version}.jar`,
    );
    if (!fs.existsSync(cache))
      warn(
        `Profile has no cache for OpenDataLoader ${version}; the next extraction will copy the current bundle.`,
      );
    else if (fs.readFileSync(cache).equals(fs.readFileSync(bundle)))
      ok(`Profile OpenDataLoader ${version} matches the bundled runtime.`);
    else
      warn(
        `Profile OpenDataLoader ${version} differs from the bundle; the next extraction will repair it.`,
      );
    if (
      fs.existsSync(
        path.join(profile, "paperpilot-tools/opendataloader-pdf-cli.jar"),
      )
    )
      warn(
        "An older unversioned JAR remains in the profile. It is ignored and preserved.",
      );
  } catch {
    error(
      "Could not inspect the bundled/profile OpenDataLoader runtime. Check dependencies, paths, and read permissions.",
    );
  }
}
process.exitCode = errors ? 1 : 0;
