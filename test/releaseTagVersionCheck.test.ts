import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const scriptPath = join(
  process.cwd(),
  "scripts",
  "check-release-tag-version.mjs",
);

async function loadReleaseTagGuard() {
  assert.equal(
    existsSync(scriptPath),
    true,
    "release tag guard script should exist",
  );

  const dynamicImport = new Function(
    "specifier",
    "return import(specifier)",
  ) as (specifier: string) => Promise<unknown>;

  return (await dynamicImport(pathToFileURL(scriptPath).href)) as {
    expectedReleaseTag: (version: string) => string;
    assertReleaseTagMatchesVersion: (params: {
      tagName: string;
      version: string;
    }) => void;
  };
}

test("release tag guard derives the expected tag from the package version", async () => {
  const { expectedReleaseTag } = await loadReleaseTagGuard();

  assert.equal(expectedReleaseTag("0.0.3"), "v0.0.3");
});

test("release tag guard rejects mismatched tag and package versions", async () => {
  const { assertReleaseTagMatchesVersion } = await loadReleaseTagGuard();

  assert.throws(
    () =>
      assertReleaseTagMatchesVersion({
        tagName: "v0.0.2",
        version: "0.0.3",
      }),
    /expected v0\.0\.3.*got v0\.0\.2/i,
  );
});

test("release workflow runs the release tag guard before publishing", () => {
  const workflowPath = join(process.cwd(), ".github", "workflows", "release.yml");
  const workflow = readFileSync(workflowPath, "utf8");

  assert.match(workflow, /check-release-tag-version\.mjs/);
});
