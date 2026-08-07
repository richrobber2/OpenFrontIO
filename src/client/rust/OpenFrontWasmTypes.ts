export const DEFAULT_WASM_URL = "/wasm/openfront_wasm.wasm";
export const ABI_VERSION = 1;
export const INVALID_RESULT = 0xffff_ffff;

export const ERROR_MESSAGES: Record<number, string> = {
  1: "invalid WebAssembly handle",
  2: "invalid tile reference",
  3: "invalid map dimensions",
  4: "terrain length does not match map dimensions",
  5: "traversal mask length does not match the map",
  6: "owner ID exceeds the 12-bit tile-state field",
  7: "upload buffer index is out of range",
  8: "uploaded tile list length is not divisible by four",
  255: "Rust map invariant failed",
};

export interface OpenFrontWasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  openfront_abi_version(): number;
  openfront_last_error(): number;
  openfront_invalid_result(): number;
  openfront_upload_create(length: number): number;
  openfront_upload_destroy(handle: number): number;
  openfront_upload_ptr(handle: number): number;
  openfront_upload_len(handle: number): number;
  openfront_map_create(width: number, height: number, upload: number): number;
  openfront_map_destroy(handle: number): number;
  openfront_map_width(handle: number): number;
  openfront_map_height(handle: number): number;
  openfront_map_tile_count(handle: number): number;
  openfront_map_num_land_tiles(handle: number): number;
  openfront_map_num_tiles_with_fallout(handle: number): number;
  openfront_map_packed_tile(handle: number, tile: number): number;
  openfront_map_update_tile(
    handle: number,
    tile: number,
    packed: number,
  ): number;
  openfront_map_set_owner_id(
    handle: number,
    tile: number,
    ownerID: number,
  ): number;
  openfront_map_set_fallout(
    handle: number,
    tile: number,
    value: number,
  ): number;
  openfront_map_set_defense_bonus(
    handle: number,
    tile: number,
    value: number,
  ): number;
  openfront_map_neighbors4(handle: number, tile: number): number;
  openfront_map_neighbors8(handle: number, tile: number): number;
  openfront_map_connected_owner(handle: number, start: number): number;
  openfront_map_connected_mask(
    handle: number,
    start: number,
    upload: number,
  ): number;
  openfront_map_owned_depths(
    handle: number,
    upload: number,
    ownerID: number,
    maximumDepth: number,
  ): number;
  openfront_map_owner_territory_analysis(
    handle: number,
    ownerID: number,
    maximumDepth: number,
  ): number;
  openfront_map_largest_owned_depths(
    handle: number,
    maximumDepth: number,
  ): number;
  openfront_map_air_path(
    handle: number,
    from: number,
    to: number,
    seed: number,
  ): number;
  openfront_map_rail_path(
    handle: number,
    upload: number,
    goal: number,
  ): number;
  openfront_map_rail_path_small(
    handle: number,
    count: number,
    start0: number,
    start1: number,
    start2: number,
    start3: number,
    goal: number,
  ): number;
  openfront_map_water_path(
    handle: number,
    upload: number,
    goal: number,
  ): number;
  openfront_map_water_path_small(
    handle: number,
    count: number,
    start0: number,
    start1: number,
    start2: number,
    start3: number,
    goal: number,
  ): number;
  openfront_result_ptr(): number;
  openfront_result_len(): number;
}

export async function instantiateWasm(
  response: Response,
): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
  if (typeof WebAssembly.instantiateStreaming === "function") {
    try {
      return await WebAssembly.instantiateStreaming(response.clone(), {});
    } catch {
      // Development servers occasionally serve Wasm as application/octet-stream.
      // Falling back to ArrayBuffer keeps the loader independent of MIME setup.
    }
  }
  return WebAssembly.instantiate(await response.arrayBuffer(), {});
}
