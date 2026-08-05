import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import ts from "typescript";

const auditStart = performance.now();
const args = new Set(process.argv.slice(2));
const staged = args.has("--staged");
const allFiles = args.has("--all");
const reportOnly = args.has("--report-only");
const jsonOutput = args.has("--json");
const baseIndex = process.argv.indexOf("--base");
const base = baseIndex === -1 ? undefined : process.argv[baseIndex + 1];
const runtimeFile = /\.(?:[cm]?[jt]sx?|glsl|css|html|json)$/;
const parseableFile = /\.[cm]?[jt]sx?$/;
const registry = JSON.parse(
  readFileSync(
    new URL("../tests/perf/function-coverage.json", import.meta.url),
  ),
);
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url)),
);

function runtimeFiles() {
  return execFileSync("rg", ["--files", "src"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((file) => runtimeFile.test(file))
    .sort();
}

function changedFiles() {
  const diffArgs = ["diff", "--unified=0", "--no-color"];
  if (staged) diffArgs.push("--cached");
  else if (base) diffArgs.push(base);
  diffArgs.push("--", "src");
  let diff = execFileSync("git", diffArgs, { encoding: "utf8" });
  if (!staged && !base && diff.length === 0) {
    diff = execFileSync(
      "git",
      ["diff", "--cached", "--unified=0", "--no-color", "--", "src"],
      { encoding: "utf8" },
    );
  }

  const changed = new Map();
  let currentFile;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) currentFile = undefined;
    if (line.startsWith("+++ b/")) {
      const candidate = line.slice(6);
      currentFile = runtimeFile.test(candidate) ? candidate : undefined;
      continue;
    }
    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!match || !currentFile) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count > 0) {
      changed.set(currentFile, [
        ...(changed.get(currentFile) ?? []),
        [start, start + count - 1],
      ]);
    }
  }
  return changed;
}

function functionName(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (
    (ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    node.name
  ) {
    const owner = node.parent?.name?.text;
    return owner ? `${owner}.${node.name.getText()}` : node.name.getText();
  }
  if (
    ts.isVariableDeclaration(node) &&
    node.name &&
    node.initializer &&
    (ts.isArrowFunction(node.initializer) ||
      ts.isFunctionExpression(node.initializer))
  ) {
    return node.name.getText();
  }
  return undefined;
}

const files = allFiles
  ? new Map(
      runtimeFiles().map((file) => [file, [[1, Number.MAX_SAFE_INTEGER]]]),
    )
  : changedFiles();
const missing = [];
const covered = [];
let functionCount = 0;

for (const [file, ranges] of files) {
  const entry = registry[file];
  if (!entry?.module) missing.push(`${file}#<module>`);
  else covered.push([`${file}#<module>`, entry.module]);
  if (!parseableFile.test(file)) continue;

  const sourceText = readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const touchedFunctions = new Set();
  const visit = (node) => {
    const name = functionName(node);
    if (name) {
      const start =
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const end = source.getLineAndCharacterOfPosition(node.end).line + 1;
      if (ranges.some(([from, to]) => from <= end && to >= start)) {
        touchedFunctions.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  functionCount += touchedFunctions.size;

  for (const name of touchedFunctions) {
    const command = entry?.functions?.[name];
    if (!command) missing.push(`${file}#${name}`);
    else covered.push([`${file}#${name}`, command]);
  }
}

for (const [, command] of covered) {
  const match = command.match(/^npm run ([^ ]+)/);
  if (!match || !packageJson.scripts[match[1]]) {
    missing.push(`invalid benchmark command: ${command}`);
  }
}

const totalTargets = files.size + functionCount;
const coveragePercent =
  totalTargets === 0 ? 100 : (covered.length / totalTargets) * 100;
const auditMs = performance.now() - auditStart;
const result = {
  scope: allFiles
    ? "all-runtime-files"
    : staged
      ? "staged"
      : (base ?? "working-tree"),
  files: files.size,
  functions: functionCount,
  targets: totalTargets,
  covered: covered.length,
  missing: missing.length,
  coveragePercent,
  auditMs,
  filesPerSecond: files.size / (auditMs / 1000),
  missingTargets: missing,
};

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else if (files.size === 0) {
  console.log("Performance coverage: no changed runtime files.");
} else {
  console.log(
    `Performance coverage (${result.scope}): ${covered.length}/${totalTargets} targets (${coveragePercent.toFixed(2)}%) across ${files.size} files and ${functionCount} functions.`,
  );
  console.log(
    `Audit runtime: ${auditMs.toFixed(2)}ms (${result.filesPerSecond.toFixed(1)} files/s).`,
  );
  if (missing.length > 0) {
    console.error("Missing performance coverage:");
    for (const target of missing.slice(0, 25)) console.error(`  - ${target}`);
    if (missing.length > 25) {
      console.error(
        `  ... and ${missing.length - 25} more (use --json for the full inventory)`,
      );
    }
    console.error(
      "Add targets and benchmark commands to tests/perf/function-coverage.json.",
    );
  }
}

if (missing.length > 0 && !reportOnly) process.exit(1);
