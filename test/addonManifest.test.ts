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

type PackageConfig = {
  config?: {
    addonInstance?: string;
  };
};

function readAddonManifest(): ZoteroManifest {
  return JSON.parse(
    readFileSync(join(process.cwd(), "addon", "manifest.json"), "utf8"),
  ) as ZoteroManifest;
}

test("addon manifest declares compatibility with Zotero 7 through 10", () => {
  const manifest = readAddonManifest();
  const zotero = manifest.applications?.zotero;

  assert.equal(zotero?.strict_min_version, "7.0");
  assert.equal(zotero?.strict_max_version, "10.0.*");
});

test("addon singleton uses a Paper Pilot-specific global name", () => {
  const packageConfig = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8"),
  ) as PackageConfig;

  assert.equal(packageConfig.config?.addonInstance, "PaperPilot");
});
