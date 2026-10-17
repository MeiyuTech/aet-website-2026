const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "../../..");
// Isolated CommonJS loader lets tests substitute the provider without a network call.
function createLoader(overrides = {}) {
  const cache = new Map();
  function load(relative) {
    const base = path.resolve(root, relative);
    const file = [
      base,
      base + ".ts",
      base + ".tsx",
      path.join(base, "index.ts"),
    ].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!file) throw new Error(`Missing test module: ${relative}`);
    const key = path.relative(root, file);
    if (overrides[key]) return overrides[key];
    if (cache.has(file)) return cache.get(file).exports;
    if (file.endsWith(".json"))
      return JSON.parse(fs.readFileSync(file, "utf8"));
    const module = { exports: {} };
    cache.set(file, module);
    const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    const localRequire = (name) =>
      name === "server-only"
        ? {}
        : name.startsWith("@/")
          ? load(name.slice(2))
          : name.startsWith(".")
            ? load(path.relative(root, path.resolve(path.dirname(file), name)))
            : require(name);
    vm.runInThisContext(`(function(require,module,exports){${js}\n})`, {
      filename: file,
    })(localRequire, module, module.exports);
    return module.exports;
  }
  return load;
}
module.exports = { createLoader, root };
