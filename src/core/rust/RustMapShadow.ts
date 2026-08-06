import type { OpenFrontRustMap } from "../../client/rust/OpenFrontRustMap";
import { OpenFrontWasmModule } from "../../client/rust/OpenFrontWasmModule";
import type { GameMap, TileRef } from "../game/GameMap";

function packedTile(map: GameMap, tile: TileRef): number {
  return (
    ((map.terrainByte(tile) & 0xff) << 16) |
    (map.tileState(tile) & 0xffff)
  ) >>> 0;
}

function mismatch(checkpoint: string, detail: string): never {
  throw new Error(`Rust map shadow mismatch at ${checkpoint}: ${detail}`);
}

/**
 * Mirrors authoritative TypeScript map mutations into the Rust WebAssembly map.
 *
 * The simulation remains authoritative. This class only verifies that the Rust
 * port reaches the same state after consuming GameImpl's packed tile-update
 * stream.
 */
export class RustMapShadow {
  private constructor(private readonly rustMap: OpenFrontRustMap) {}

  static async create(
    map: GameMap,
    wasmBytes: Uint8Array,
  ): Promise<RustMapShadow> {
    const module = await OpenFrontWasmModule.fromBytes(wasmBytes);
    const terrain = new Uint8Array(map.width() * map.height());
    for (let tile = 0; tile < terrain.length; tile++) {
      terrain[tile] = map.terrainByte(tile);
    }

    const rustMap = module.createMap(map.width(), map.height(), terrain);
    for (let tile = 0; tile < terrain.length; tile++) {
      if (map.tileState(tile) !== 0) {
        rustMap.updateTile(tile, packedTile(map, tile));
      }
    }

    const shadow = new RustMapShadow(rustMap);
    shadow.assertFullParity(map, "initialization");
    return shadow;
  }

  applyPackedTileUpdates(
    map: GameMap,
    updates: Uint32Array,
    checkpoint: string,
  ): void {
    if (updates.length % 2 !== 0) {
      mismatch(
        checkpoint,
        `packed update stream has odd length ${updates.length}`,
      );
    }

    const touched = new Set<TileRef>();
    for (let index = 0; index < updates.length; index += 2) {
      const tile = updates[index];
      const packed = updates[index + 1];
      if (!map.isValidRef(tile)) {
        mismatch(checkpoint, `update references invalid tile ${tile}`);
      }
      this.rustMap.updateTile(tile, packed);
      touched.add(tile);
    }

    this.assertDimensionsAndCounters(map, checkpoint);
    for (const tile of touched) {
      this.assertTileParity(map, tile, checkpoint);
    }
  }

  assertFullParity(map: GameMap, checkpoint: string): void {
    this.assertDimensionsAndCounters(map, checkpoint);
    const tileCount = map.width() * map.height();
    for (let tile = 0; tile < tileCount; tile++) {
      this.assertTileParity(map, tile, checkpoint);
    }
  }

  dispose(): void {
    this.rustMap.dispose();
  }

  private assertDimensionsAndCounters(
    map: GameMap,
    checkpoint: string,
  ): void {
    if (this.rustMap.width() !== map.width()) {
      mismatch(
        checkpoint,
        `width ${this.rustMap.width()} !== ${map.width()}`,
      );
    }
    if (this.rustMap.height() !== map.height()) {
      mismatch(
        checkpoint,
        `height ${this.rustMap.height()} !== ${map.height()}`,
      );
    }
    if (this.rustMap.numLandTiles() !== map.numLandTiles()) {
      mismatch(
        checkpoint,
        `land count ${this.rustMap.numLandTiles()} !== ${map.numLandTiles()}`,
      );
    }
    if (this.rustMap.numTilesWithFallout() !== map.numTilesWithFallout()) {
      mismatch(
        checkpoint,
        `fallout count ${this.rustMap.numTilesWithFallout()} !== ${map.numTilesWithFallout()}`,
      );
    }
  }

  private assertTileParity(
    map: GameMap,
    tile: TileRef,
    checkpoint: string,
  ): void {
    const rustPacked = this.rustMap.packedTile(tile);
    const typescriptPacked = packedTile(map, tile);
    if (rustPacked !== typescriptPacked) {
      mismatch(
        checkpoint,
        `tile ${tile} packed 0x${rustPacked.toString(16)} !== 0x${typescriptPacked.toString(16)}`,
      );
    }
  }
}
