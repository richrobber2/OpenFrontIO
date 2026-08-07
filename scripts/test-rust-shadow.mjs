import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(process.execPath, ["scripts/build-rust-wasm.mjs"]);

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
run(npm, [
  "exec",
  "--",
  "vitest",
  "run",
  "tests/rust/AirPathParity.test.ts",
  "tests/rust/TerritoryAnalysisParity.test.ts",
  "tests/rust/RailPathParity.test.ts",
  "tests/rust/WaterPathParity.test.ts",
  "tests/rust/BoundedWaterPathParity.test.ts",
  "tests/rust/ConnectedComponentsParity.test.ts",
  "tests/rust/AbstractGraphParity.test.ts",
  "tests/rust/HierarchicalWaterPathParity.test.ts",
  "tests/rust/LiveRailIntegration.test.ts",
  "tests/rust/LiveWaterIntegration.test.ts",
  "tests/rust/LiveHierarchicalWaterIntegration.test.ts",
  "tests/rust/UnitClassificationBuildingStress.test.ts",
  "tests/rust/PathfindingBenchmark.test.ts",
  "tests/rust/FullWorldPathfindingBenchmark.test.ts",
]);
run(npm, [
  "exec",
  "--",
  "tsx",
  "tests/rust/HeadlessShadowGame.ts",
  ...process.argv.slice(2),
]);
