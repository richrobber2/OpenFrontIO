// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeNukeControlPoints,
  computeTrajectoryThresholds,
  fillNukeTrajectoryStripVertices,
  NUKE_TRAJECTORY_FLOATS_PER_PAIR,
  NUKE_TRAJECTORY_SEGMENTS,
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

function expectStripParity(
  rust: OpenFrontWasmTrajectory,
  trajectory: ReturnType<typeof typescriptTrajectory>,
  segments = NUKE_TRAJECTORY_SEGMENTS,
): Float32Array {
  const length = (segments + 1) * NUKE_TRAJECTORY_FLOATS_PER_PAIR;
  const expected = new Float32Array(length);
  const actual = new Float32Array(length);
  fillNukeTrajectoryStripVertices(trajectory, expected, segments);
  rust.writeStrip(trajectory, actual, segments);
  for (let index = 0; index < length; index++) {
    expect(actual[index], `strip float ${index}`).toBe(expected[index]);
  }
  return actual;
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

  it("matches all 774 renderer strip floats for a downward arc", async () => {
    const rust = await loadTrajectory();
    try {
      const trajectory = typescriptTrajectory(
        0,
        250,
        600,
        250,
        800,
        false,
        [],
      );
      const strip = expectStripParity(rust, trajectory);
      expect(strip.length).toBe(774);
      expect(strip[strip.length - 1]).toBeGreaterThan(600);
    } finally {
      rust.dispose();
    }
  });

  it("matches strip geometry for a clamped upward arc", async () => {
    const rust = await loadTrajectory();
    try {
      const trajectory = typescriptTrajectory(15, 30, 405, 40, 180, true, []);
      expectStripParity(rust, trajectory);
    } finally {
      rust.dispose();
    }
  });

  it("overwrites the retained strip result on repeated builds", async () => {
    const rust = await loadTrajectory();
    try {
      const first = typescriptTrajectory(0, 250, 600, 250, 800, false, []);
      const second = typescriptTrajectory(20, 40, 360, 160, 500, true, []);
      const destination = new Float32Array(
        (NUKE_TRAJECTORY_SEGMENTS + 1) * NUKE_TRAJECTORY_FLOATS_PER_PAIR,
      );

      rust.writeStrip(first, destination, NUKE_TRAJECTORY_SEGMENTS);
      const firstDistance = destination[destination.length - 1];
      rust.writeStrip(second, destination, NUKE_TRAJECTORY_SEGMENTS);
      const secondDistance = destination[destination.length - 1];

      const expected = new Float32Array(destination.length);
      fillNukeTrajectoryStripVertices(
        second,
        expected,
        NUKE_TRAJECTORY_SEGMENTS,
      );
      expect(Array.from(destination)).toEqual(Array.from(expected));
      expect(secondDistance).not.toBe(firstDistance);
    } finally {
      rust.dispose();
    }
  });
});
