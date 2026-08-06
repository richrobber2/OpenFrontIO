import { spawnSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = "wasm32-unknown-unknown";
const profile = process.argv.includes("--debug") ? "debug" : "release";
const cargoArgs = [
  "build",
  "--package",
  "openfront-wasm",
  "--target",
  target,
];
if (profile === "release") cargoArgs.push("--release");

const result = spawnSync("cargo", cargoArgs, {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(`Failed to launch cargo: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

const source = path.join(
  root,
  "target",
  target,
  profile,
  "openfront_wasm.wasm",
);
const destinationDir = path.join(root, "resources", "wasm");
const destination = path.join(destinationDir, "openfront_wasm.wasm");

await mkdir(destinationDir, { recursive: true });
await copyFile(source, destination);
console.log(`Copied ${path.relative(root, source)} to ${path.relative(root, destination)}`);
