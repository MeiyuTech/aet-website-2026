const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { root } = require("./support/loader.cjs");
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? files(file)
      : /\.tsx?$/.test(file)
        ? [file]
        : [];
  });
}
function resolve(from, spec) {
  const base = spec.startsWith("@/")
    ? path.join(root, spec.slice(2))
    : path.resolve(path.dirname(from), spec);
  return [base, base + ".ts", base + ".tsx", path.join(base, "index.ts")].find(
    (p) => fs.existsSync(p) && fs.statSync(p).isFile(),
  );
}
function walk(file, seen = new Set()) {
  if (seen.has(file)) return;
  seen.add(file);
  const source = fs.readFileSync(file, "utf8");
  assert.ok(
    !file.includes("/lib/eval/server/"),
    `Server code in browser/domain graph: ${file}`,
  );
  assert.doesNotMatch(source, /import ["']server-only["']/);
  assert.doesNotMatch(
    source,
    /EVAL_SUPABASE_SERVICE_ROLE_KEY|EVAL_GEMINI_API_KEY|EVAL_OPENAI_API_KEY/,
  );
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = match[1];
    assert.ok(
      !["@google/genai", "docx"].includes(spec),
      `Server dependency ${spec} in ${file}`,
    );
    if (spec.startsWith("@/") || spec.startsWith(".")) {
      const next = resolve(file, spec);
      if (next) walk(next, seen);
    }
  }
}
for (const file of [
  ...files(path.join(root, "components/eval")),
  ...files(path.join(root, "lib/eval/domain")),
  ...files(path.join(root, "lib/eval/client")),
])
  walk(file);
for (const file of files(path.join(root, "lib/eval/domain"))) {
  const source = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(
    source,
    /from ["'](?:react|next|node:|@\/components|.*\/server\/)/,
  );
}
for (const folder of [
  "services",
  "repositories",
  "models",
  "renderers",
  "agent",
]) {
  for (const file of files(path.join(root, "lib/eval/server", folder))) {
    assert.doesNotMatch(
      fs.readFileSync(file, "utf8"),
      /from ["'].*\/http\//,
      `HTTP dependency in reusable module: ${file}`,
    );
  }
}
console.log(
  "PASS browser/domain dependency graph excludes secrets, provider SDK, storage and renderers; services do not depend on HTTP",
);
