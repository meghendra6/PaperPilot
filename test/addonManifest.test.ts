import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";

type ZoteroManifest = {
  applications?: {
    zotero?: {
      strict_min_version?: string;
      strict_max_version?: string;
    };
  };
};

function readAddonManifest(): ZoteroManifest {
  return JSON.parse(
    readFileSync(join(process.cwd(), "addon", "manifest.json"), "utf8"),
  ) as ZoteroManifest;
}

function matchesZoteroVersion(range: string, version: string): boolean {
  if (range === "*") {
    return true;
  }

  const wildcardMatch = range.match(/^(\d+)\.\*$/);
  if (wildcardMatch) {
    return version.startsWith(`${wildcardMatch[1]}.`);
  }

  return range === version;
}

test("addon manifest declares compatibility with Zotero 9.0.3", () => {
  const manifest = readAddonManifest();
  const zotero = manifest.applications?.zotero;

  assert.equal(zotero?.strict_min_version, "7.0");
  assert.equal(
    matchesZoteroVersion(zotero?.strict_max_version ?? "", "9.0.3"),
    true,
  );
  assert.equal(
    matchesZoteroVersion(zotero?.strict_max_version ?? "", "10.0.0"),
    false,
  );
});
