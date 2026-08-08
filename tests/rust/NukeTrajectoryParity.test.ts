// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeNukeControlPoints,
  computeTrajectoryThresholds,
  samRange,
  type SAMInfo,
} from "../../src/client/render/gl/utils/NukeTrajectory";
import { OpenFrontWasmTrajectory } from "../../src/client/rust/OpenFrontWasmTrajectory";

async function loadTrajectory(): Promise<OpenFrontWasmTrajectory> {
  const wasmPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../resources/wasm/openfront_wasm.wasm",
  );
  return OpenFrontWasmTrajectory.fromBytes(
    new Uint8Array(await readFile(wasmPath)),
  );
}

function typescriptTrajectory(
  srcX: number,
  srcY: number,
  dstX: number,
  dstY: number,
  mapH: number,
  directionUp: boolean,
  sams: readonly SAMInfo[],
) {
  const cp = computeNukeControlPoints(
    srcX,
    srcY,
    dstX,
    dstY,
    mapH,
    directionUp,
  );
  return {
    ...cp,
    ...computeTrajectoryThresholds(cp, srcX, srcY, dstX, dstY, sams),
  };
}

function expectTrajectoryParity(
  rust: ReturnType<OpenFrontWasmTrajectory["build"]>,
  typescript: ReturnType<typeof typescriptTrajectory>,
): void {
  for (const key of Object.keys(typescript) as (keyof typeof typescript)[]) {
    expect(rust[key], key).toBe(typescript[key]);
  }
}

describe("nuke trajectory TypeScript/WebAssembly parity", () => {
  it("matches the SAM range formula including fractional upgrade levels", async () => {
    const rust = await loadTrajectory();
    try {
      for (const level of [0, 1, 2.5, 5, 17]) {
        expect(rust.samRange(level)).toBe(samRange(level));
      }
    } finally {
      rust.dispose();
    }
  });

  it("matches control points, untargetable thresholds, and a source-side SAM intercept", async () => {
    const rust = await loadTrajectory();
    const sams = [{ x: 60, y: 330, rangeSq: 80 * 80 }];
    try {
      const actual = rust.build(0, 250, 600, 250, 800, false, sams);
      const expected = typescriptTrajectory(
        0,
        250,
        600,
        250,
        800,
        false,
        sams,
      );
      expectTrajectoryParity(actual, expected);
      expect(actual.tUntargetableStart).toBeGreaterThan(0);
      expect(actual.tUntargetableEnd).toBeGreaterThan(
        actual.tUntargetableStart,
      );
      expect(actual.tSamIntercept).toBeLessThan(
        actual.tUntargetableStart,
      );
    } finally {
      rust.dispose();
    }
  });

  it("ignores SAM coverage that exists only in the untargetable middle", async () => {
    const rust = await loadTrajectory();
    const sams = [{ x: 300, y: 400, rangeSq: 60 * 60 }];
    try {
      const actual = rust.build(0, 250, 600, 250, 800, false, sams);
      const expected = typescriptTrajectory(
        0,
        250,
        600,
        250,
        800,
        false,
        sams,
      );
      expectTrajectoryParity(actual, expected);
      expect(actual.tSamIntercept).toBe(1);
    } finally {
      rust.dispose();
    }
  });

  it("matches upward arcs with map-edge clamping and overlapping targetable ranges", async () => {
    const rust = await loadTrajectory();
    try {
      const actual = rust.build(15, 30, 205, 40, 180, true, []);
      const expected = typescriptTrajectory(15, 30, 205, 40, 180, true, []);
      expectTrajectoryParity(actual, expected);
      expect(actual.p1y).toBe(0);
      expect(actual.p2y).toBe(0);
      expect(actual.tUntargetableStart).toBe(-1);
      expect(actual.tUntargetableEnd).toBe(-1);
    } finally {
      rust.dispose();
    }
  });

  it("preserves first-hit ordering while the retained SAM upload grows", async () => {
    const rust = await loadTrajectory();
    const sams = Array.from({ length: 24 }, (_, index) => ({
      x: 1000 + index * 10,
      y: 1000,
      rangeSq: 25,
    }));
    sams[17] = { x: 55, y: 320, rangeSq: 70 * 70 };
    try {
      const actual = rust.build(0, 250, 600, 250, 800, false, sams);
      const expected = typescriptTrajectory(
        0,
        250,
        600,
        250,
        800,
        false,
        sams,
      );
      expectTrajectoryParity(actual, expected);
      expect(actual.tSamIntercept).toBeLessThan(1);
    } finally {
      rust.dispose();
    }
  });
});
