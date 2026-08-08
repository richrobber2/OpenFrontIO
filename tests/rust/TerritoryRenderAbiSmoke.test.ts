// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("territory render WebAssembly ABI", () => {
  it("exports the territory staging entrypoints used by the live renderer", async () => {
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
      "openfront_territory_renderer_create",
      "openfront_territory_renderer_destroy",
      "openfront_territory_renderer_replace",
      "openfront_territory_renderer_enqueue",
      "openfront_territory_renderer_drain_next",
      "openfront_territory_renderer_drain_all",
      "openfront_territory_renderer_clear",
      "openfront_territory_renderer_tile_patch_ptr",
      "openfront_territory_renderer_tile_patch_len",
      "openfront_territory_renderer_border_change_ptr",
      "openfront_territory_renderer_border_change_len",
      "openfront_territory_renderer_display_ptr",
      "openfront_territory_renderer_display_len",
      "openfront_territory_renderer_fallout_touched",
    ]) {
      expect(typeof exports[name], name).toBe("function");
    }
  });
});
