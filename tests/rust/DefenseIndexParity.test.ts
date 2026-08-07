// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assessStrategicRoute } from "../../src/client/ai/StrategicWeaponsPolicy";
import { OpenFrontWasmModule } from "../../src/client/rust/OpenFrontWasmModule";

async function loadModule(): Promise<OpenFrontWasmModule> {
  const wasmPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../resources/wasm/openfront_wasm.wasm",
  );
  return OpenFrontWasmModule.fromBytes(
    new Uint8Array(await readFile(wasmPath)),
  );
}

const source = { x: 0, y: 0 };
const destination = { x: 20, y: 0 };
const targetableRange = 8;
const pathPoints = Array.from({ length: 21 }, (_, x) => ({
  x,
  y: 0,
  blocked: false,
}));
const defenses = [
  { id: 10, x: 4, y: 1, range: 2, availableInterceptions: 1 },
  { id: 20, x: 16, y: 0, range: 2, availableInterceptions: 3 },
  // This defense covers only the untargetable middle of the trajectory.
  { id: 30, x: 10, y: 0, range: 2, availableInterceptions: 9 },
];

describe("defense index TypeScript/WebAssembly parity", () => {
  it("matches strategic route SAM capacity including upgraded launchers", async () => {
    const module = await loadModule();
    const handle = module.createDefenseIndex(4);
    try {
      module.replaceDefenseIndex(handle, defenses);
      const rust = module.assessDefensePath(
        handle,
        pathPoints,
        source,
        destination,
        targetableRange,
      );
      const typescript = assessStrategicRoute({
        path: pathPoints,
        source,
        destination,
        targetableRange,
        sams: defenses,
      });

      expect(rust).toEqual({
        blocked: typescript.blocked,
        interceptingDefenses: typescript.interceptingSams,
        interceptionCapacity: typescript.interceptionCapacity,
      });
      expect(rust.interceptingDefenses).toBe(2);
      expect(rust.interceptionCapacity).toBe(4);
    } finally {
      module.destroyDefenseIndex(handle);
    }
  });

  it("preserves fractional upgraded SAM coverage at the range edge", async () => {
    const module = await loadModule();
    const handle = module.createDefenseIndex(4);
    const fractionalDefense = [
      {
        id: 40,
        x: 10,
        y: 0,
        range: 2.5,
        availableInterceptions: 2,
      },
    ];
    const fractionalPath = [{ x: 12, y: 1, blocked: false }];
    try {
      module.replaceDefenseIndex(handle, fractionalDefense);
      const rust = module.assessDefensePath(
        handle,
        fractionalPath,
        source,
        destination,
        20,
      );
      const typescript = assessStrategicRoute({
        path: fractionalPath,
        source,
        destination,
        targetableRange: 20,
        sams: fractionalDefense,
      });

      expect(rust).toEqual({
        blocked: typescript.blocked,
        interceptingDefenses: typescript.interceptingSams,
        interceptionCapacity: typescript.interceptionCapacity,
      });
      expect(rust.interceptionCapacity).toBe(2);
    } finally {
      module.destroyDefenseIndex(handle);
    }
  });

  it("matches early blocking and clears stale coverage on replacement", async () => {
    const module = await loadModule();
    const handle = module.createDefenseIndex(4);
    try {
      module.replaceDefenseIndex(handle, defenses);
      const blockedPath = pathPoints.map((point) => ({ ...point }));
      blockedPath[6]!.blocked = true;

      const rustBlocked = module.assessDefensePath(
        handle,
        blockedPath,
        source,
        destination,
        targetableRange,
      );
      const typescriptBlocked = assessStrategicRoute({
        path: blockedPath,
        source,
        destination,
        targetableRange,
        sams: defenses,
      });
      expect(rustBlocked).toEqual({
        blocked: typescriptBlocked.blocked,
        interceptingDefenses: typescriptBlocked.interceptingSams,
        interceptionCapacity: typescriptBlocked.interceptionCapacity,
      });

      module.replaceDefenseIndex(handle, [
        { id: 99, x: 100, y: 100, range: 1, availableInterceptions: 5 },
      ]);
      expect(
        module.assessDefensePath(
          handle,
          pathPoints,
          source,
          destination,
          targetableRange,
        ),
      ).toEqual({
        blocked: false,
        interceptingDefenses: 0,
        interceptionCapacity: 0,
      });
    } finally {
      module.destroyDefenseIndex(handle);
    }
  });

  it("rejects a zero-sized spatial cell", async () => {
    const module = await loadModule();
    expect(() => module.createDefenseIndex(0)).toThrow(
      /cell size must be greater than zero/,
    );
  });
});
