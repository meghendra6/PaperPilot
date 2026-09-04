import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as ts from "typescript";

function collectTypeScript(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScript(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

function isRuntimeImport(statement: ts.ImportDeclaration) {
  const clause = statement.importClause;
  if (!clause || clause.isTypeOnly) return false;
  if (clause.name) return true;
  return !(
    clause.namedBindings &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

test("source modules have no static runtime import cycle", () => {
  const sourceRoot = resolve(process.cwd(), "src");
  const files = collectTypeScript(sourceRoot).map(normalize);
  const known = new Set(files);
  const graph = new Map(files.map((file) => [file, [] as string[]]));

  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !statement.moduleSpecifier.text.startsWith(".") ||
        !isRuntimeImport(statement)
      ) {
        continue;
      }
      const base = resolve(dirname(file), statement.moduleSpecifier.text);
      const target = [
        normalize(`${base}.ts`),
        normalize(join(base, "index.ts")),
      ].find((candidate) => known.has(candidate));
      if (target) graph.get(file)?.push(target);
    }
  }

  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const visit = (file: string) => {
    visited.add(file);
    active.add(file);
    stack.push(file);
    for (const dependency of graph.get(file) ?? []) {
      if (!visited.has(dependency)) visit(dependency);
      else if (active.has(dependency)) {
        cycles.push([...stack.slice(stack.indexOf(dependency)), dependency]);
      }
    }
    stack.pop();
    active.delete(file);
  };
  for (const file of files) if (!visited.has(file)) visit(file);

  assert.deepEqual(
    cycles.map((cycle) => cycle.map((file) => relative(sourceRoot, file))),
    [],
  );
});
