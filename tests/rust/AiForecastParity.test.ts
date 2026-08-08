// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  forecastOpponent,
  inferOpponentChoice,
  type OpponentChoice,
  type OpponentForecast,
  type OpponentObservation,
} from "../../src/client/ai/OpponentForecastPolicy";
import type { OpenFrontWasmExports } from "../../src/client/rust/OpenFrontWasmTypes";

type Wasm = OpenFrontWasmExports & {
  openfront_ai_infer_opponent_choice(...args: number[]): number;
  openfront_ai_forecast_opponent(...args: number[]): number;
};

const choices: readonly OpponentChoice[] = [
  "attack",
  "defend",
  "expand",
  "bank",
  "economy",
  "naval",
];

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

function readU32Result(wasm: Wasm): Uint32Array {
  const length = wasm.openfront_result_len() >>> 0;
  const pointer = wasm.openfront_result_ptr() >>> 0;
  return new Uint32Array(new Uint32Array(wasm.memory.buffer, pointer, length));
}

function readF64Result(wasm: Wasm): Float64Array {
  const length = wasm.openfront_result_f64_len() >>> 0;
  const pointer = wasm.openfront_result_f64_ptr() >>> 0;
  return new Float64Array(new Float64Array(wasm.memory.buffer, pointer, length));
}

function observation(
  overrides: Partial<OpponentObservation> = {},
): OpponentObservation {
  return {
    tick: 100,
    troops: 700_000,
    maxTroops: 1_000_000,
    tiles: 5_000,
    gold: 2_000_000,
    incomingAttacks: 0,
    incomingTroops: 0,
    outgoingAttacks: 0,
    outgoingTroops: 0,
    cities: 3,
    factories: 1,
    ports: 1,
    silos: 0,
    warships: 1,
    allied: false,
    sharesBorder: true,
    ...overrides,
  };
}

function choiceCode(choice: OpponentChoice): number {
  return choices.indexOf(choice);
}

function directInfer(
  wasm: Wasm,
  current: OpponentObservation,
  previous?: OpponentObservation,
): OpponentChoice {
  const code = wasm.openfront_ai_infer_opponent_choice(
    current.tiles,
    current.incomingAttacks,
    current.incomingTroops,
    current.outgoingAttacks,
    current.outgoingTroops,
    current.cities,
    current.factories,
    current.ports,
    current.silos,
    current.warships,
    previous === undefined ? 0 : 1,
    previous?.tiles ?? 0,
    previous?.outgoingTroops ?? 0,
    previous?.cities ?? 0,
    previous?.factories ?? 0,
    previous?.ports ?? 0,
    previous?.silos ?? 0,
    previous?.warships ?? 0,
  );
  return choices[code] ?? "bank";
}

function directForecast(
  wasm: Wasm,
  current: OpponentObservation,
  previous: OpponentObservation | undefined,
  previousForecast: OpponentForecast | undefined,
  ownTroops: number,
  ownMaxTroops: number,
  ownTiles: number,
) {
  expect(
    wasm.openfront_ai_forecast_opponent(
      current.tick,
      current.troops,
      current.maxTroops,
      current.tiles,
      current.gold,
      current.incomingAttacks,
      current.incomingTroops,
      current.outgoingAttacks,
      current.outgoingTroops,
      current.cities,
      current.factories,
      current.ports,
      current.silos,
      current.warships,
      current.allied ? 1 : 0,
      current.sharesBorder ? 1 : 0,
      previous === undefined ? 0 : 1,
      previous?.tick ?? 0,
      previous?.troops ?? 0,
      previous?.maxTroops ?? 0,
      previous?.tiles ?? 0,
      previous?.gold ?? 0,
      previous?.incomingAttacks ?? 0,
      previous?.incomingTroops ?? 0,
      previous?.outgoingAttacks ?? 0,
      previous?.outgoingTroops ?? 0,
      previous?.cities ?? 0,
      previous?.factories ?? 0,
      previous?.ports ?? 0,
      previous?.silos ?? 0,
      previous?.warships ?? 0,
      previousForecast === undefined ? 0 : 1,
      previousForecast === undefined
        ? choiceCode("bank")
        : choiceCode(previousForecast.predictedChoice),
      previousForecast?.confidence ?? 0,
      ownTroops,
      ownMaxTroops,
      ownTiles,
    ),
  ).toBe(1);
  return {
    control: readU32Result(wasm),
    values: readF64Result(wasm),
  };
}

describe("opponent forecast TypeScript/WebAssembly parity", () => {
  it("infers opponent actions identically", async () => {
    const wasm = await loadWasm();
    const previous = observation();
    const cases = [
      observation({
        tick: 105,
        tiles: 4_980,
        incomingAttacks: 1,
        incomingTroops: 300_000,
        outgoingAttacks: 1,
        outgoingTroops: 100_000,
      }),
      observation({
        tick: 105,
        outgoingAttacks: 1,
        outgoingTroops: 180_000,
      }),
      observation({ tick: 105, warships: 2 }),
      observation({ tick: 105, factories: 2 }),
      observation({ tick: 105, tiles: 5_020 }),
      observation({ tick: 105 }),
    ];

    for (const current of cases) {
      expect(directInfer(wasm, current, previous)).toBe(
        inferOpponentChoice(current, previous),
      );
    }
  });

  it("matches probability, threat, and projection math", async () => {
    const wasm = await loadWasm();
    const previous = observation();
    const previousForecast: OpponentForecast = {
      id: "enemy",
      observedChoice: "expand",
      predictedChoice: "attack",
      probabilities: {
        attack: 0.4,
        defend: 0.1,
        expand: 0.2,
        bank: 0.1,
        economy: 0.1,
        naval: 0.1,
      },
      confidence: 0.37,
      threat: 0.8,
      projected: {
        near: { tick: 220, troops: 0, tiles: 0, reserveRatio: 0 },
        far: { tick: 700, troops: 0, tiles: 0, reserveRatio: 0 },
      },
    };
    const scenarios = [
      observation({
        tick: 105,
        troops: 735_000,
        tiles: 5_040,
        gold: 1_900_000,
        outgoingAttacks: 1,
        outgoingTroops: 180_000,
        silos: 1,
      }),
      observation({
        tick: 105,
        troops: 650_000,
        tiles: 4_970,
        incomingAttacks: 2,
        incomingTroops: 350_000,
        allied: true,
      }),
      observation({
        tick: 105,
        troops: 720_000,
        factories: 2,
        ports: 2,
        warships: 3,
        sharesBorder: false,
      }),
    ];

    for (const current of scenarios) {
      const ts = forecastOpponent({
        id: "enemy",
        current,
        previous,
        previousForecast,
        ownTroops: 800_000,
        ownMaxTroops: 1_100_000,
        ownTiles: 5_500,
      });
      const { control, values } = directForecast(
        wasm,
        current,
        previous,
        previousForecast,
        800_000,
        1_100_000,
        5_500,
      );
      expect(choices[control[0]!]).toBe(ts.observedChoice);
      expect(choices[control[1]!]).toBe(ts.predictedChoice);
      choices.forEach((choice, index) => {
        expect(values[index]).toBeCloseTo(ts.probabilities[choice], 12);
      });
      expect(values[6]).toBeCloseTo(ts.confidence, 12);
      expect(values[7]).toBeCloseTo(ts.threat, 12);
      expect(values[8]).toBeCloseTo(ts.projected.near.tick, 12);
      expect(values[9]).toBeCloseTo(ts.projected.near.troops, 8);
      expect(values[10]).toBeCloseTo(ts.projected.near.tiles, 12);
      expect(values[11]).toBeCloseTo(ts.projected.near.reserveRatio, 12);
      expect(values[12]).toBeCloseTo(ts.projected.far.tick, 12);
      expect(values[13]).toBeCloseTo(ts.projected.far.troops, 8);
      expect(values[14]).toBeCloseTo(ts.projected.far.tiles, 12);
      expect(values[15]).toBeCloseTo(ts.projected.far.reserveRatio, 12);
    }
  });

  it("matches cold-start banking without a previous observation", async () => {
    const wasm = await loadWasm();
    const current = observation({ allied: false, sharesBorder: false });
    const ts = forecastOpponent({
      id: "cold",
      current,
      ownTroops: 700_000,
      ownMaxTroops: 1_000_000,
      ownTiles: 5_000,
    });
    const { control, values } = directForecast(
      wasm,
      current,
      undefined,
      undefined,
      700_000,
      1_000_000,
      5_000,
    );
    expect(choices[control[0]!]).toBe(ts.observedChoice);
    expect(choices[control[1]!]).toBe(ts.predictedChoice);
    expect(values[7]).toBeCloseTo(ts.threat, 12);
  });
});
