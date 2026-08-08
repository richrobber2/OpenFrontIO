// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("alliance AI WebAssembly ABI", () => {
  it("exports the live alliance policy entrypoints", async () => {
    const wasmPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../resources/wasm/openfront_wasm.wasm",
    );
    const source = await WebAssembly.instantiate(
      new Uint8Array(await readFile(wasmPath)),
      {},
    );
    const exports = source.instance.exports as Record<string, unknown>;
    for (const name of [
      "openfront_ai_projected_troop_growth_rate",
      "openfront_ai_assess_alliance_cooperation",
      "openfront_ai_alliance_response_window_ticks",
      "openfront_ai_plan_alliance_lifecycle",
      "openfront_ai_choose_aid_request",
      "openfront_ai_should_donate_troops",
      "openfront_ai_should_donate_gold",
      "openfront_ai_should_coordinate_attack",
      "openfront_ai_plan_communication",
      "openfront_ai_plan_coalition_growth_support",
    ]) {
      expect(typeof exports[name], name).toBe("function");
    }
  });
});
