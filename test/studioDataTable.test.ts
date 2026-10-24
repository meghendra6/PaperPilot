import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  parseDataTable,
  serializeDataTable,
  setDataCell,
  addDataColumn,
  addDataRow,
  removeDataRow,
  removeDataColumn,
} from "../src/modules/studio/dataTable";

test("single-column empty CSV and TSV rows survive saving and reopening", () => {
  for (const name of ["data.csv", "data.tsv"]) {
    for (const suffix of ["", "\n", "\r\n"]) {
      const newline = suffix === "\r\n" ? suffix : "\n";
      const table = parseDataTable(name, `name${newline}""${suffix}`);
      assert.equal(table.rows.length, 1);
      assert.deepEqual(parseDataTable(name, serializeDataTable(table)).rows, [
        [""],
      ]);
    }
  }
});

test("empty tables require a CSV column but preserve empty JSONL objects", () => {
  const csv = parseDataTable("data.csv", "");
  assert.throws(() => addDataRow(csv), /Add a column/);
  addDataColumn(csv, "name");
  addDataRow(csv);
  assert.deepEqual(parseDataTable("data.csv", serializeDataTable(csv)).rows, [
    [""],
  ]);
  const jsonl = parseDataTable("data.jsonl", "{}\n");
  addDataRow(jsonl);
  assert.equal(serializeDataTable(jsonl), "{}\n{}\n");
});

test("removing the final CSV column cannot silently discard rows", () => {
  const table = parseDataTable("data.csv", "name\n001\n");
  assert.throws(() => removeDataColumn(table, 0), /last column/);
  assert.deepEqual(table.headers, ["name"]);
  assert.deepEqual(table.rows, [["001"]]);
});

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
