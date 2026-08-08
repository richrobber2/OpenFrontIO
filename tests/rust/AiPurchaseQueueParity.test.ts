// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GoldBudgetModule, type AiModuleContext } from "../../src/client/ai/AiModule";
import {
  selectPurchaseQueue,
  type PurchaseQueueCandidate,
  type PurchaseQueueContext,
} from "../../src/client/ai/PurchaseQueuePolicy";
import type { OpenFrontWasmExports } from "../../src/client/rust/OpenFrontWasmTypes";

type Wasm = OpenFrontWasmExports & {
  openfront_ai_select_purchase_queue(
    spendCap: number,
    minimumPurchases: number,
    maximumPurchases: number,
    risk: number,
    capitalPressure: number,
    uploadHandle: number,
    count: number,
  ): number;
};

async function loadWasm(): Promise<Wasm> {
  const wasmPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../resources/wasm/openfront_wasm.wasm",
  );
  const source = await WebAssembly.instantiate(
    new Uint8Array(await readFile(wasmPath)),
    {},
  );
  return source.instance.exports as Wasm;
}

function candidates(): PurchaseQueueCandidate[] {
  return [
    { index: 0, cost: 150_000, value: 10, returnRatio: 0.7, synergy: 1 },
    { index: 1, cost: 140_000, value: 9, returnRatio: 0.62, synergy: 0.9 },
    { index: 2, cost: 130_000, value: 8, returnRatio: 0.55, synergy: 0.8 },
    { index: 3, cost: 120_000, value: 7, returnRatio: 0.48, synergy: 0.7 },
    { index: 4, cost: 110_000, value: 6, returnRatio: 0.4, synergy: 0.6 },
  ];
}

function writeCandidates(
  wasm: Wasm,
  records: readonly PurchaseQueueCandidate[],
): number {
  const recordBytes = 40;
  const upload = wasm.openfront_upload_create(records.length * recordBytes) >>> 0;
  expect(upload).not.toBe(0);
  const pointer = wasm.openfront_upload_ptr(upload) >>> 0;
  const view = new DataView(
    wasm.memory.buffer,
    pointer,
    records.length * recordBytes,
  );
  records.forEach((candidate, index) => {
    const offset = index * recordBytes;
    view.setUint32(offset, candidate.index >>> 0, true);
    view.setUint32(offset + 4, (candidate.group ?? 0) >>> 0, true);
    view.setFloat64(offset + 8, candidate.cost, true);
    view.setFloat64(offset + 16, candidate.value, true);
    view.setFloat64(offset + 24, candidate.returnRatio, true);
    view.setFloat64(offset + 32, candidate.synergy, true);
  });
  return upload;
}

function runRawWasm(wasm: Wasm, context: PurchaseQueueContext) {
  const upload = writeCandidates(wasm, context.candidates);
  try {
    expect(
      wasm.openfront_ai_select_purchase_queue(
        context.spendCap,
        context.minimumPurchases,
        context.maximumPurchases,
        context.risk,
        context.capitalPressure,
        upload,
        context.candidates.length,
      ),
    ).toBe(1);
    const resultLength = wasm.openfront_result_len() >>> 0;
    const resultPointer = wasm.openfront_result_ptr() >>> 0;
    const selectedIndices = Array.from(
      new Uint32Array(wasm.memory.buffer, resultPointer, resultLength),
    );
    expect(wasm.openfront_result_f64_len() >>> 0).toBe(3);
    const valuesPointer = wasm.openfront_result_f64_ptr() >>> 0;
    const values = new Float64Array(wasm.memory.buffer, valuesPointer, 3);
    return {
      selectedIndices,
      totalCost: values[0]!,
      totalScore: values[1]!,
      remainingBudget: values[2]!,
    };
  } finally {
    expect(wasm.openfront_upload_destroy(upload)).toBe(1);
  }
}

function moduleContext(overrides: Partial<AiModuleContext> = {}): AiModuleContext {
  return {
    tick: 1_000,
    reserveRatio: 0.9,
    maxTroops: 1_000_000,
    troops: 900_000,
    gold: 150_000_000,
    incomingTroopRatio: 0,
    outgoingCommittedRatio: 0,
    activeFronts: 0,
    neutralLandAvailable: false,
    activeNationWars: 0,
    borderPressure: 0,
    economyReturnScore: 8,
    usefulPortSites: 8,
    existingPorts: 2,
    existingCities: 5,
    existingDefensePosts: 3,
    existingSams: 2,
    existingSilos: 1,
    infrastructureNeedScore: 7,
    strategicWeaponValue: 2,
    allyAidUrgency: 0,
    incomePerMinute: 1_000_000,
    emergencyGoldFloor: 500_000,
    productiveStackSites: 6,
    coastalEconomicTargets: 5,
    enemyWarshipsNearTargets: 0,
    enemyMissileSilos: 0,
    ...overrides,
  };
}

describe("Rust purchase queue parity and growth behavior", () => {
  it("matches TypeScript for safe surplus batching", async () => {
    const wasm = await loadWasm();
    const context: PurchaseQueueContext = {
      spendCap: 1_000_000,
      minimumPurchases: 3,
      maximumPurchases: 5,
      risk: 0.1,
      capitalPressure: 0.9,
      candidates: candidates(),
    };
    const ts = selectPurchaseQueue(context);
    const rust = runRawWasm(wasm, context);
    expect(rust.selectedIndices).toEqual(ts.selectedIndices);
    expect(rust.selectedIndices.length).toBe(5);
    expect(rust.totalCost).toBeCloseTo(ts.totalCost, 9);
    expect(rust.totalScore).toBeCloseTo(ts.totalScore, 12);
    expect(rust.remainingBudget).toBeCloseTo(ts.remainingBudget, 9);
  });

  it("collapses mass spending to one purchase under severe risk", async () => {
    const wasm = await loadWasm();
    const context: PurchaseQueueContext = {
      spendCap: 1_000_000,
      minimumPurchases: 5,
      maximumPurchases: 5,
      risk: 0.85,
      capitalPressure: 1,
      candidates: candidates(),
    };
    const ts = selectPurchaseQueue(context);
    const rust = runRawWasm(wasm, context);
    expect(rust.selectedIndices).toEqual(ts.selectedIndices);
    expect(rust.selectedIndices).toHaveLength(1);
    expect(rust.totalCost).toBeLessThanOrEqual(context.spendCap);
  });

  it("uses diversification groups to avoid duplicate relationship purchases", async () => {
    const wasm = await loadWasm();
    const grouped: PurchaseQueueCandidate[] = [
      { index: 0, group: 7, cost: 100, value: 10, returnRatio: 0.8, synergy: 1 },
      { index: 1, group: 7, cost: 90, value: 9.8, returnRatio: 0.78, synergy: 1 },
      { index: 2, group: 8, cost: 100, value: 9, returnRatio: 0.7, synergy: 1 },
      { index: 3, group: 9, cost: 100, value: 8, returnRatio: 0.6, synergy: 1 },
    ];
    const context: PurchaseQueueContext = {
      spendCap: 500,
      minimumPurchases: 4,
      maximumPurchases: 4,
      risk: 0,
      capitalPressure: 1,
      candidates: grouped,
    };
    const rust = runRawWasm(wasm, context);
    const ts = selectPurchaseQueue(context);
    expect(rust.selectedIndices).toEqual(ts.selectedIndices);
    expect(rust.selectedIndices).toHaveLength(3);
    expect(
      rust.selectedIndices.filter((index) => grouped[index]!.group === 7),
    ).toHaveLength(1);
  });

  it("increases the batch size when safe capital pressure rises", () => {
    const low = selectPurchaseQueue({
      spendCap: 1_000_000,
      minimumPurchases: 1,
      maximumPurchases: 5,
      risk: 0.1,
      capitalPressure: 0.1,
      candidates: candidates(),
    });
    const high = selectPurchaseQueue({
      spendCap: 1_000_000,
      minimumPurchases: 1,
      maximumPurchases: 5,
      risk: 0.1,
      capitalPressure: 0.9,
      candidates: candidates(),
    });
    expect(high.selectedIndices.length).toBeGreaterThan(low.selectedIndices.length);
    expect(high.totalCost).toBeGreaterThan(low.totalCost);
    expect(high.totalCost).toBeLessThanOrEqual(1_000_000);
  });

  it("propagates runaway-treasury queue demand through the live gold module", () => {
    const decision = new GoldBudgetModule().evaluate(moduleContext(), {});
    expect(decision.action).toBe("invest");
    expect(decision.data?.minimumQueuedPurchases).toEqual(
      decision.signals?.goldMinimumQueuedPurchases,
    );
    expect(Number(decision.signals?.goldMinimumQueuedPurchases)).toBeGreaterThanOrEqual(10);
    expect(Number(decision.signals?.goldSpendCap)).toBeGreaterThan(0);
  });
});
