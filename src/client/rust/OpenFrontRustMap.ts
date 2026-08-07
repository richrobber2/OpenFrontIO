import type { OpenFrontWasmModule } from "./OpenFrontWasmModule";

export class OpenFrontRustMap {
  private disposed = false;

  constructor(
    private readonly module: OpenFrontWasmModule,
    private readonly handle: number,
  ) {}

  width(): number {
    this.assertLive();
    return this.module.mapWidth(this.handle);
  }

  height(): number {
    this.assertLive();
    return this.module.mapHeight(this.handle);
  }

  tileCount(): number {
    this.assertLive();
    return this.module.mapTileCount(this.handle);
  }

  numLandTiles(): number {
    this.assertLive();
    return this.module.mapLandCount(this.handle);
  }

  numTilesWithFallout(): number {
    this.assertLive();
    return this.module.mapFalloutCount(this.handle);
  }

  packedTile(tile: number): number {
    this.assertLive();
    return this.module.packedTile(this.handle, tile);
  }

  updateTile(tile: number, packed: number): boolean {
    this.assertLive();
    return this.module.updateTile(this.handle, tile, packed);
  }

  setOwnerID(tile: number, ownerID: number): void {
    this.assertLive();
    this.module.setOwnerID(this.handle, tile, ownerID);
  }

  setFallout(tile: number, value: boolean): boolean {
    this.assertLive();
    return this.module.setFallout(this.handle, tile, value);
  }

  setDefenseBonus(tile: number, value: boolean): void {
    this.assertLive();
    this.module.setDefenseBonus(this.handle, tile, value);
  }

  neighbors4(tile: number): Uint32Array {
    this.assertLive();
    return this.module.neighbors4(this.handle, tile);
  }

  neighbors8(tile: number): Uint32Array {
    this.assertLive();
    return this.module.neighbors8(this.handle, tile);
  }

  connectedOwner(start: number): Uint32Array {
    this.assertLive();
    return this.module.connectedOwner(this.handle, start);
  }

  connectedMask(start: number, accepted: Uint8Array): Uint32Array {
    this.assertLive();
    return this.module.connectedMask(this.handle, start, accepted);
  }

  ownedDepths(
    starts: Uint32Array,
    ownerID: number,
    maximumDepth: number,
  ): Uint32Array {
    this.assertLive();
    return this.module.ownedDepths(
      this.handle,
      starts,
      ownerID,
      maximumDepth,
    );
  }

  ownerTerritoryAnalysis(
    ownerID: number,
    maximumDepth: number,
  ): Uint32Array {
    this.assertLive();
    return this.module.ownerTerritoryAnalysis(
      this.handle,
      ownerID,
      maximumDepth,
    );
  }

  largestOwnedDepths(maximumDepth: number): Uint32Array {
    this.assertLive();
    return this.module.largestOwnedDepths(this.handle, maximumDepth);
  }

  airPath(from: number, to: number, seed: number): Uint32Array {
    this.assertLive();
    return this.module.airPath(this.handle, from, to, seed);
  }

  waterComponents(): Uint32Array {
    this.assertLive();
    return this.module.waterComponents(this.handle);
  }

  railPath(starts: Uint32Array, goal: number): Uint32Array {
    this.assertLive();
    return this.module.railPath(this.handle, starts, goal);
  }

  waterPath(starts: Uint32Array, goal: number): Uint32Array {
    this.assertLive();
    return this.module.waterPath(this.handle, starts, goal);
  }

  dispose(): void {
    if (this.disposed) return;
    this.module.destroyMap(this.handle);
    this.disposed = true;
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("OpenFront Rust map has been disposed");
  }
}
