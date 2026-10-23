import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  PENDING_READER_ACTION_TTL_MS,
  isPendingReaderActionFresh,
  isStandaloneReaderWindow,
} from "../src/modules/ui/pendingReaderAction";

test("a queued reader action stays fresh only for a short time", () => {
  const queuedAt = Date.parse("2026-10-24T10:00:00.000Z");
  const updatedAt = new Date(queuedAt).toISOString();
  assert.equal(isPendingReaderActionFresh(updatedAt, queuedAt + 1_000), true);
  assert.equal(
    isPendingReaderActionFresh(
      updatedAt,
      queuedAt + PENDING_READER_ACTION_TTL_MS + 1,
    ),
    false,
  );
  assert.equal(isPendingReaderActionFresh(undefined, queuedAt), false);
  assert.equal(isPendingReaderActionFresh("not a date", queuedAt), false);
});

test("only Zotero's standalone reader window counts as having no item pane", () => {
  const readerWindow = {
    _window: { location: { href: "chrome://zotero/content/reader.xhtml" } },
  };
  const readerTab = {
    tabID: "tab-1",
    _window: { location: { href: "chrome://zotero/content/zoteroPane.xhtml" } },
  };
  assert.equal(isStandaloneReaderWindow(readerWindow), true);
  assert.equal(isStandaloneReaderWindow(readerTab), false);
  assert.equal(isStandaloneReaderWindow({ itemID: 3 }), false);
  assert.equal(isStandaloneReaderWindow(undefined), false);
});
