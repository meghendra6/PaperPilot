import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";
import { writeStudioLicenseNotices } from "./scripts/studio-license-notices.mjs";
import {
  patchStudioEditor,
  patchStudioToolbar,
} from "./scripts/studio-editor-compat.mjs";
import { readFile } from "node:fs/promises";

export default defineConfig({
  source: ["src", "addon"],
  dist: "build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/release/${
    pkg.version.includes("-") ? "update-beta.json" : "update.json"
  }`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["packages/studio-editor/pdf-worker.ts"],
        bundle: true,
        format: "iife",
        define: { "import.meta.url": "self.location.href" },
        platform: "browser",
        target: "firefox115",
        legalComments: "linked",
        outfile: "build/addon/chrome/content/studio/pdf-worker.js",
      },
      {
        entryPoints: ["src/modules/studio/client.ts"],
        define: { "process.env.NODE_ENV": '"production"' },
        bundle: true,
        format: "iife",
        platform: "browser",
        legalComments: "linked",
        plugins: [
          {
            name: "studio-editor-compatibility",
            setup(build) {
              let patched = 0;
              let toolbarPatched = 0;
              build.onStart(() => {
                patched = 0;
                toolbarPatched = 0;
              });
              build.onLoad(
                {
                  filter:
                    /superdoc[\\/]dist[\\/](?:superdoc\.min|chunks[\\/]SuperConverter-[^/\\]+\.es)\.js$/,
                },
                async ({ path }) => {
                  let contents = patchStudioEditor(
                    await readFile(path, "utf8"),
                  );
                  patched++;
                  if (/superdoc\.min\.js$/.test(path)) {
                    contents = patchStudioToolbar(contents);
                    toolbarPatched++;
                  }
                  return { contents, loader: "js" };
                },
              );
              build.onLoad(
                {
                  filter:
                    /superdoc[\\/]dist[\\/]chunks[\\/]src-[^/\\]+\.es\.js$/,
                },
                async ({ path }) => {
                  const source = await readFile(path, "utf8");
                  if (!source.includes('ariaLabel: "Link dropdown"')) return;
                  toolbarPatched++;
                  return { contents: patchStudioToolbar(source), loader: "js" };
                },
              );
              build.onEnd(() =>
                patched === 1 && toolbarPatched === 1
                  ? undefined
                  : {
                      errors: [
                        {
                          text: "The Studio editor compatibility patches were not applied exactly once.",
                        },
                      ],
                    },
              );
            },
          },
          {
            name: "studio-license-notices",
            setup(build) {
              build.onEnd(async (result) => {
                if (!result.errors.length)
                  await writeStudioLicenseNotices(
                    "build/addon/chrome/content/studio/licenses",
                  );
              });
            },
          },
        ],
        inject: ["src/modules/studio/browserStorage.ts"],
        target: "firefox115",
        outfile: "build/addon/chrome/content/studio/client.js",
        loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" },
      },
      {
        entryPoints: ["src/index.ts"],
        metafile: true,
        plugins: [
          {
            name: "studio-host-boundary",
            setup(build) {
              build.onEnd((result) => {
                const browserOnly = Object.keys(
                  result.metafile?.inputs ?? {},
                ).filter((path) =>
                  /node_modules\/(?:@citation-js\/|superdoc\/|@codemirror\/|codemirror\/)/.test(
                    path,
                  ),
                );
                if (browserOnly.length)
                  return {
                    errors: [
                      {
                        text: `Browser-only editor libraries entered the Zotero bootstrap bundle: ${browserOnly.join(", ")}`,
                      },
                    ],
                  };
                return undefined;
              });
            },
          },
        ],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `build/addon/chrome/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },

  // If you need to see a more detailed log, uncomment the following line:
  // logLevel: "trace",
});
