// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assessStrategicRoute,
  assessStrategicStrike,
} from "../src/client/ai/StrategicWeaponsPolicy";
import {
  isRustDefenseIndexReady,
  preloadRustDefenseIndex,
} from "../src/client/rust/OpenFrontWasmDefense";
import { OpenFrontWasmModule } from "../src/client/rust/OpenFrontWasmModule";

async function loadDefenseModule(): Promise<OpenFrontWasmModule> {
  const wasmPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../resources/wasm/openfront_wasm.wasm",
  );
  return OpenFrontWasmModule.fromBytes(
    new Uint8Array(await readFile(wasmPath)),
  );
}

describe("strategic weapons against upgraded SAMs", () => {
  beforeAll(async () => {
    await preloadRustDefenseIndex(loadDefenseModule);
    expect(isRustDefenseIndexReady()).toBe(true);
  });

  it("counts every ready interception slot on an upgraded SAM route in Rust", () => {
    expect(isRustDefenseIndexReady()).toBe(true);

    const route = assessStrategicRoute({
      path: [
        { x: 0, y: 0, blocked: false },
        { x: 20, y: 0, blocked: false },
        { x: 40, y: 0, blocked: false },
      ],
      source: { x: 0, y: 0 },
      destination: { x: 40, y: 0 },
      targetableRange: 100,
      sams: [
        {
          id: 7,
          x: 20,
          y: 0,
          range: 110,
          availableInterceptions: 3,
        },
      ],
    });

    expect(route.blocked).toBe(false);
    expect(route.interceptingSams).toBe(1);
    expect(route.interceptionCapacity).toBe(3);
  });

  it("does not mistake several owned nukes for a simultaneous saturation salvo", () => {
    const decision = assessStrategicStrike({
      weapon: "nuke",
      targetTroops: 2_000_000,
      targetStructures: 6,
      targetTerritoryShare: 0.4,
      targetActiveWars: 2,
      targetHasSamCoverage: true,
      targetIsWinning: true,
      targetIsAlly: false,
      ownReserveRatio: 0.9,
      ownActiveNationWars: 0,
      availableWeapons: 8,
      ticksSinceLastStrike: 100,
      expectedTroopLoss: 1_500_000,
      affectedTargetTiles: 400,
      targetTotalTiles: 1_000,
      destroyedStructureValue: 20,
      pathBlocked: false,
      samInterceptionCapacity: 3,
      requiredSalvoSize: 4,
      weaponCost: 750_000,
      spendableGold: 20_000_000,
    });

    expect(decision.fire).toBe(false);
    expect(
      decision.reasons.some((reason) => reason.includes("sequential launches")),
    ).toBe(true);
  });

  it("still allows a valuable strike when the evaluated route is clear", () => {
    const decision = assessStrategicStrike({
      weapon: "nuke",
      targetTroops: 2_000_000,
      targetStructures: 6,
      targetTerritoryShare: 0.4,
      targetActiveWars: 2,
      targetHasSamCoverage: true,
      targetIsWinning: true,
      targetIsAlly: false,
      ownReserveRatio: 0.9,
      ownActiveNationWars: 0,
      availableWeapons: 2,
      ticksSinceLastStrike: 100,
      expectedTroopLoss: 1_500_000,
      affectedTargetTiles: 400,
      targetTotalTiles: 1_000,
      destroyedStructureValue: 20,
      pathBlocked: false,
      samInterceptionCapacity: 0,
      weaponCost: 750_000,
      spendableGold: 20_000_000,
    });

    expect(decision.fire).toBe(true);
  });
});
