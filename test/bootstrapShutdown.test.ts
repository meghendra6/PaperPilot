import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

test("bootstrap registers an awaited Zotero shutdown listener and stops runs on application exit", async () => {
  let release: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    release = resolve;
  });
  const listeners: (() => Promise<void>)[] = [];
  let calls = 0;
  const context = {
    APP_SHUTDOWN: 2,
    Components: {
      classes: {
        "@mozilla.org/addons/addon-manager-startup;1": {
          getService: () => ({ registerChrome() {} }),
        },
      },
      interfaces: {},
    },
    Services: {
      io: { newURI: (uri: string) => uri },
      scriptloader: { loadSubScript() {} },
    },
    Zotero: {
      getMainWindow: () => undefined,
      addShutdownListener: (listener: () => Promise<void>) =>
        listeners.push(listener),
      __addonInstance__: {
        hooks: {
          onStartup: async () => undefined,
          onApplicationShutdown: () => {
            calls += 1;
            return stopped;
          },
        },
      },
    },
  };
  const bootstrap = runInNewContext(
    readFileSync("addon/bootstrap.js", "utf8") + "\n({ startup, shutdown })",
    context,
  );
  await bootstrap.startup({ rootURI: "file:///temporary-addon/" }, 1);
  assert.equal(listeners.length, 1);
  const listenerResult = listeners[0]();
  assert.equal(listenerResult, stopped);
  let finished = false;
  const shutdown = bootstrap.shutdown({}, context.APP_SHUTDOWN).then(() => {
    finished = true;
  });
  await Promise.resolve();
  assert.equal(calls, 2);
  assert.equal(finished, false);
  release();
  await shutdown;
  assert.equal(finished, true);
});
