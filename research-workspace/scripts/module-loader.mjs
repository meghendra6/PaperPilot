import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, "..");

export function readModuleOrder() {
  return JSON.parse(
    fs.readFileSync(
      path.join(projectRoot, "build-support", "module-order.json"),
      "utf8",
    ),
  );
}

export function createRuntimeLoader(root = projectRoot) {
  const cache = new Map();

  function requireRuntimeModule(id) {
    if (cache.has(id)) return cache.get(id).exports;

    const sourcePath = path.join(root, id);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Runtime source module does not exist: ${id}`);
    }

    const source = fs.readFileSync(sourcePath, "utf8");
    const module = { exports: {} };
    cache.set(id, module);

    const factory = new Function(
      "module",
      "exports",
      "__require",
      `${source}\n//# sourceURL=${sourcePath.replaceAll("\\", "/")}`,
    );
    factory(module, module.exports, requireRuntimeModule);
    return module.exports;
  }

  return requireRuntimeModule;
}
