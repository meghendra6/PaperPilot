import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isCommentMutation } from "../src/modules/studio/docxEvents";

test("opening or selecting imported comments does not create document versions", () => {
  for (const type of ["selected", "comments-list", "pending", undefined])
    assert.equal(isCommentMutation({ type }), false);
  assert.equal(
    isCommentMutation({ type: "update", comment: { trackedChange: true } }),
    false,
  );
  for (const type of ["new", "add", "update", "resolved", "deleted"])
    assert.equal(
      isCommentMutation({ type, comment: { commentText: "Review" } }),
      true,
    );
});
