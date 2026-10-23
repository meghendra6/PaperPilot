import { strict as assert } from "node:assert";
import { test } from "node:test";
import { moveCard, newBoard, parseBoard } from "../src/modules/studio/board";

test("board edits preserve unknown metadata and keep planning state independent", () => {
  const board = newBoard();
  board.custom = { future: true };
  board.cards.push({
    id: "card-a",
    title: "Review",
    description: "Check evidence",
    columnID: "planned",
    labels: ["methods"],
    documentIDs: ["doc-a"],
    archived: false,
    custom: 42,
  });
  const parsed = parseBoard(JSON.stringify(board));
  moveCard(parsed, "card-a", "done");
  assert.equal(parsed.cards[0].columnID, "done");
  assert.equal(parsed.cards[0].custom, 42);
  assert.deepEqual(parsed.custom, { future: true });
  assert.ok(!("screening" in parsed.cards[0]));
  assert.deepEqual(parsed.cards[0].documentIDs, ["doc-a"]);
});

test("moving cards checks both targets before mutating order", () => {
  const board = newBoard();
  for (const id of ["a", "b", "c"])
    board.cards.push({
      id,
      title: id,
      description: "",
      columnID: "planned",
      labels: [],
      documentIDs: [],
      archived: false,
    });
  moveCard(board, "c", "planned", "a");
  assert.deepEqual(
    board.cards.map((card) => card.id),
    ["c", "a", "b"],
  );
  const before = JSON.stringify(board);
  assert.throws(() => moveCard(board, "a", "done", "b"));
  assert.equal(JSON.stringify(board), before);
  assert.throws(() =>
    parseBoard(before.replace('"schemaVersion":1', '"schemaVersion":9')),
  );
  board.cards[0].columnID = "missing";
  assert.throws(() => parseBoard(JSON.stringify(board)));
});
