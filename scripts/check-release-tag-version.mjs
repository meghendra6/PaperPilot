import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function expectedReleaseTag(version) {
  return `v${version}`;
}

export function assertReleaseTagMatchesVersion({ tagName, version }) {
  const expectedTag = expectedReleaseTag(version);
  if (tagName !== expectedTag) {
    throw new Error(
      `Release tag mismatch: expected ${expectedTag} for package.json version ${version}, got ${tagName}. Bump package.json and package-lock.json before pushing the release tag.`,
    );
  }

  return expectedTag;
}

async function readPackageVersion(packageJsonPath = new URL("../package.json", import.meta.url)) {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
    throw new Error("package.json version is missing or invalid.");
  }

  return packageJson.version.trim();
}

export async function validateReleaseTag(options = {}) {
  const tagName = options.tagName ?? process.env.GITHUB_REF_NAME ?? "";
  if (!tagName) {
    throw new Error(
      "Release tag name is required. Run this script with the tag name or set GITHUB_REF_NAME.",
    );
  }

  const version = await readPackageVersion(options.packageJsonPath);
  const expectedTag = assertReleaseTagMatchesVersion({ tagName, version });

  return { expectedTag, tagName, version };
}

async function main() {
  const result = await validateReleaseTag({ tagName: process.argv[2] });
  console.log(
    `Release tag ${result.tagName} matches package.json version ${result.version}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
