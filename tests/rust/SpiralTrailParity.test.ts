// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  OpenFrontWasmSpiral,
  SPIRAL_SAMPLE_FLOATS,
  type RustSpiralSegmentInput,
} from "../../src/client/rust/OpenFrontWasmSpiral";

const SAMPLES_PER_TILE = 2;

async function loadSpiral(): Promise<OpenFrontWasmSpiral> {
  const wasmPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../resources/wasm/openfront_wasm.wasm",
  );
  return OpenFrontWasmSpiral.fromBytes(
    new Uint8Array(await readFile(wasmPath)),
  );
}

function referenceSegment(input: RustSpiralSegmentInput): Float32Array {
  const dx = input.x1 - input.x0;
  const dy = input.y1 - input.y0;
  const ndx = dx / input.segmentLength;
  const ndy = dy / input.segmentLength;
  const fromDirX = input.hasPreviousDir ? input.previousDirX : ndx;
  const fromDirY = input.hasPreviousDir ? input.previousDirY : ndy;
  const dirAt = (f: number): [number, number] => {
    const bx = fromDirX + (ndx - fromDirX) * f;
    const by = fromDirY + (ndy - fromDirY) * f;
    const len = Math.hypot(bx, by);
    if (len < 1e-6) return [ndx, ndy];
    return [bx / len, by / len];
  };

  const steps = Math.ceil(input.segmentLength * SAMPLES_PER_TILE);
  const sampleCount = steps + (input.includeStart ? 1 : 0);
  const output = new Float32Array(sampleCount * SPIRAL_SAMPLE_FLOATS);
  let offset = 0;
  const write = (
    cx: number,
    cy: number,
    px: number,
    py: number,
    distance: number,
  ) => {
    output[offset++] = cx;
    output[offset++] = cy;
    output[offset++] = px;
    output[offset++] = py;
    output[offset++] = distance;
  };

  if (input.includeStart) {
    const [bx, by] = dirAt(0);
    write(input.x0, input.y0, -by, bx, 0);
  }
  for (let step = 1; step <= steps; step++) {
    const f = step / steps;
    const [bx, by] = dirAt(f);
    write(
      input.x0 + dx * f,
      input.y0 + dy * f,
      -by,
      bx,
      input.headDistance + input.segmentLength * f,
    );
  }
  return output;
}

function expectSegmentParity(
  spiral: OpenFrontWasmSpiral,
  input: RustSpiralSegmentInput,
): Float32Array {
  const expected = referenceSegment(input);
  const actual = spiral.buildSegment(input);
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < expected.length; index++) {
    expect(actual[index], `spiral float ${index}`).toBe(expected[index]);
  }
  return new Float32Array(actual);
}

describe("spiral trail TypeScript/WebAssembly parity", () => {
  it("matches a first 3-4-5 segment including the ribbon start", async () => {
    const spiral = await loadSpiral();
    const input: RustSpiralSegmentInput = {
      x0: 10,
      y0: 20,
      x1: 13,
      y1: 24,
      segmentLength: Math.hypot(3, 4),
      previousDirX: 0,
      previousDirY: 0,
      hasPreviousDir: false,
      includeStart: true,
      headDistance: 0,
    };

    const actual = expectSegmentParity(spiral, input);
    expect(actual.length).toBe(11 * SPIRAL_SAMPLE_FLOATS);
    expect(actual[0]).toBe(10);
    expect(actual[1]).toBe(20);
    expect(actual[actual.length - 1]).toBe(5);
  });

  it("matches a continued straight segment without duplicating the start", async () => {
    const spiral = await loadSpiral();
    expectSegmentParity(spiral, {
      x0: 13,
      y0: 24,
      x1: 16,
      y1: 28,
      segmentLength: Math.hypot(3, 4),
      previousDirX: 3 / 5,
      previousDirY: 4 / 5,
      hasPreviousDir: true,
      includeStart: false,
      headDistance: 5,
    });
  });

  it("matches smoothed direction blending through a turn", async () => {
    const spiral = await loadSpiral();
    expectSegmentParity(spiral, {
      x0: 30,
      y0: 40,
      x1: 30,
      y1: 46,
      segmentLength: Math.hypot(0, 6),
      previousDirX: 1,
      previousDirY: 0,
      hasPreviousDir: true,
      includeStart: false,
      headDistance: 17.25,
    });
  });

  it("matches the 180-degree direction fallback at the zero-length blend", async () => {
    const spiral = await loadSpiral();
    expectSegmentParity(spiral, {
      x0: 12,
      y0: 8,
      x1: 10,
      y1: 8,
      segmentLength: Math.hypot(-2, 0),
      previousDirX: 1,
      previousDirY: 0,
      hasPreviousDir: true,
      includeStart: false,
      headDistance: 9,
    });
  });

  it("matches fractional diagonal sampling and accumulated distances", async () => {
    const spiral = await loadSpiral();
    expectSegmentParity(spiral, {
      x0: 101.25,
      y0: 77.5,
      x1: 104.75,
      y1: 79.125,
      segmentLength: Math.hypot(3.5, 1.625),
      previousDirX: 0.25,
      previousDirY: -Math.sqrt(1 - 0.25 * 0.25),
      hasPreviousDir: true,
      includeStart: false,
      headDistance: 123.456789,
    });
  });

  it("overwrites the reusable result buffer on repeated segments", async () => {
    const spiral = await loadSpiral();
    const first: RustSpiralSegmentInput = {
      x0: 0,
      y0: 0,
      x1: 1,
      y1: 0,
      segmentLength: 1,
      previousDirX: 0,
      previousDirY: 0,
      hasPreviousDir: false,
      includeStart: true,
      headDistance: 0,
    };
    const second: RustSpiralSegmentInput = {
      x0: 20,
      y0: 10,
      x1: 20,
      y1: 13,
      segmentLength: 3,
      previousDirX: 1,
      previousDirY: 0,
      hasPreviousDir: true,
      includeStart: false,
      headDistance: 50,
    };

    const firstCopy = new Float32Array(spiral.buildSegment(first));
    const secondCopy = expectSegmentParity(spiral, second);
    expect(Array.from(firstCopy)).toEqual(Array.from(referenceSegment(first)));
    expect(Array.from(secondCopy)).toEqual(Array.from(referenceSegment(second)));
  });
});
