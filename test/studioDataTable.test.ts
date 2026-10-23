import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  parseDataTable,
  serializeDataTable,
  setDataCell,
  addDataColumn,
  removeDataRow,
  removeDataColumn,
} from "../src/modules/studio/dataTable";

test("CSV preserves multiline quoted cells, Unicode, leading zeros, BOM and CRLF", () => {
  const source = '\uFEFFid,note\r\n001,"첫째, 둘째\r\n""quoted"""\r\n';
  const table = parseDataTable("data.csv", source);
  assert.deepEqual(table.rows, [["001", '첫째, 둘째\r\n"quoted"']]);
  setDataCell(table, 0, 1, 'changed, "value"');
  const output = serializeDataTable(table);
  assert.ok(output.startsWith("\uFEFF"));
  assert.ok(output.endsWith("\r\n"));
  assert.deepEqual(parseDataTable("data.csv", output).rows, [
    ["001", 'changed, "value"'],
  ]);
});

test("row and column changes preserve positional CSV values and JSONL object types", () => {
  const table = parseDataTable(
    "data.jsonl",
    '{"id":"001","nested":{"a":true}}\n{"id":"002"}\n',
  );
  addDataColumn(table, "__proto__");
  setDataCell(table, 1, 2, '{"safe":true}');
  removeDataRow(table, 0);
  removeDataColumn(table, 1);
  assert.equal(
    serializeDataTable(table),
    '{"id":"002","__proto__":{"safe":true}}\n',
  );
  assert.throws(() => addDataColumn(table, "id"), /unique/);
  assert.throws(() => removeDataRow(table, -1), /outside/);
  const csv = parseDataTable("data.csv", "x,x\n001,002\n");
  removeDataColumn(csv, 0);
  assert.equal(serializeDataTable(csv), "x\n002\n");
});

test("TSV formulas remain inert strings and ragged or malformed input is rejected for source view", () => {
  const table = parseDataTable("data.tsv", "name\tvalue\na\t=1+1\n");
  assert.equal(table.rows[0][1], "=1+1");
  assert.deepEqual(
    parseDataTable("data.tsv", serializeDataTable(table)).rows,
    table.rows,
  );
  assert.throws(() => parseDataTable("x.csv", 'a,b\n"unclosed'));
  assert.throws(() => parseDataTable("x.csv", "a,b\n1,2,3"), /column counts/);
});

test("JSONL editing preserves scalar types, nested values, missing keys and own __proto__ properties", () => {
  const table = parseDataTable(
    "data.jsonl",
    '{"id":1,"nested":{"x":true},"__proto__":7}\n{"id":2}\n',
  );
  setDataCell(table, 1, 0, "42");
  assert.deepEqual(
    serializeDataTable(table)
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
    [JSON.parse('{"id":1,"nested":{"x":true},"__proto__":7}'), { id: 42 }],
  );
  assert.throws(() => setDataCell(table, 0, 0, "not JSON"));
  assert.equal(table.jsonRows![0].id, 1);
  assert.throws(
    () => setDataCell(table, 0, 0, "9007199254740993"),
    /precision/,
  );
  assert.equal(table.jsonRows![0].id, 1);
  assert.throws(() => setDataCell(table, 0, 0.5, "42"), /outside/);
  assert.throws(
    () => parseDataTable("x.jsonl", '{"id":9007199254740993}'),
    /precision/,
  );
});
