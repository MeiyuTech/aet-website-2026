/* Compatibility entry point. All fixtures are synthetic and network-free. */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
for (const suite of [
  "domain.cjs",
  "server.cjs",
  "generation.cjs",
  "boundaries.cjs",
]) {
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, "../tests/eval", suite)],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
