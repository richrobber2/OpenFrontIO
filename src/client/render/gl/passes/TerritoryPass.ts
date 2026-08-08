/**
 * TerritoryPass — territory fill + stale-nuke ground.
 *
 * Draws only what should be darkened by the night cycle:
 *   - Owned territory (player color fill)
 *   - Any fallout tile (stale-nuke ground, overrides owned territory)
 *
 * No borders, embers, trails, or defense checkerboard — those are
 * handled by BorderStampPass and TrailPass at full brightness.
 *
 * Owns the display-side tile state and the drip queue that staggers tile
 * uploads across render frames. When graphics Wasm is available, the queue,
 * coalescing, state comparison, and patch packing live in Rust; WebGL still
 * owns the actual rasterization.
 */

import {
  createRustTerritoryRenderQueue,
  type RustTerritoryDrain,
  type RustTerritoryRenderQueue,
} from "../../../rust/OpenFrontWasmTerritoryRender";
import type { RenderSettings } from "../RenderSettings";
import { getPaletteSize } from "../utils/ColorUtils";
import { createMapQuad, createProgram, shaderSrc } from "../utils/GlUtils";
import { FALLOUT_BIT, OWNER_MASK, TILE_DEFINES } from "../utils/TileCodec";
import { TileDripQueue } from "../utils/TileDripQueue";

import overlayVertSrc from "../shaders/map-overlay/overlay.vert.glsl?raw";
import territoryFragSrc from "../shaders/map-overlay/territory.frag.glsl?raw";
import { TileScatterPass } from "./TileScatterPass";

export class TerritoryPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private mapW: number;
  private mapH: number;

  private program: WebGLProgram;
  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uAltView: WebGLUniformLocation;
  private uStaleNukeBase: WebGLUniformLocation;
  private uStaleNukeVariation: WebGLUniformLocation;
  private uStaleNukeAlpha: WebGLUniformLocation;
  private uStaleNukeColor: WebGLUniformLocation;
  private uHighlightOwner: WebGLUniformLocation;
  private uHighlightBrighten: WebGLUniformLocation;
  private uShowPatterns: WebGLUniformLocation;
  private uIsTeamMode: WebGLUniformLocation;
  private uDefenseDarken: WebGLUniformLocation;
  private uSaturation: WebGLUniformLocation;
  private uTerritoryAlpha: WebGLUniformLocation;
  private highlightOwner = 0;
  private isTeamMode = false;

  private vao: WebGLVertexArrayObject;
  private tileTex: WebGLTexture;
  private paletteTex: WebGLTexture;
  private patternMetaTex: WebGLTexture;
  private patternDataTex: WebGLTexture;
  private skinAtlasTex: WebGLTexture;
  private skinLayerTex: WebGLTexture;
  private skinAnchorTex: WebGLTexture;
  private defenseCoverageTex: WebGLTexture | null = null;
  private borderTex: WebGLTexture | null = null;

  private altView = false;
  private showPatterns = true;

  /** TypeScript fallback display state. Rust owns the live mirror when enabled. */
  private cpuTileState: Uint16Array;
  private tilesDirty = false;

  /**
   * True when a tile's fallout bit flipped since the last consume (or a full
   * state replacement happened, which may contain fallout). The renderer uses
   * this to activate the heat-decay pass only while fallout is in play.
   */
  private falloutTouched = false;

  /**
   * True after a full state replacement (initial load / seek). flushTileTexture
   * uploads the full display state via texSubImage2D and discards any queued
   * scatter patches — those are already covered by the full upload.
   */
  private fullUploadPending = false;

  /**
   * GPU scatter pass for per-frame patches. Replaces the old dirty-row bbox
   * upload — constant cost regardless of how spatially scattered patches are.
   */
  private scatter!: TileScatterPass;

  /**
   * Hook for forwarding tile changes to the border-compute pipeline so it can
   * incrementally repaint affected tiles instead of rebuilding the whole map.
   * Wired by the renderer to `borderPass.patchTile`.
   */
  private borderPatchConsumer:
    | ((x: number, y: number, prevOwner: number, newOwner: number) => void)
    | null = null;

  /** TypeScript compatibility queue used when the graphics Wasm is unavailable. */
  private readonly dripQueue: TileDripQueue;
  private liveTileState: Uint16Array | null = null;
  /** Rust fast path. Null keeps stale dev Wasm assets backwards compatible. */
  private rustQueue: RustTerritoryRenderQueue | null = null;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    tileTex: WebGLTexture,
    paletteTex: WebGLTexture,
    patternMetaTex: WebGLTexture,
    patternDataTex: WebGLTexture,
    skinAtlasTex: WebGLTexture,
    skinLayerTex: WebGLTexture,
    skinAnchorTex: WebGLTexture,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = mapW;
    this.mapH = mapH;
    this.tileTex = tileTex;
    this.paletteTex = paletteTex;
    this.patternMetaTex = patternMetaTex;
    this.patternDataTex = patternDataTex;
    this.skinAtlasTex = skinAtlasTex;
    this.skinLayerTex = skinLayerTex;
    this.skinAnchorTex = skinAnchorTex;
    this.cpuTileState = new Uint16Array(mapW * mapH);

    this.dripQueue = new TileDripQueue(
      mapW * mapH,
      settings.tileDrip.bucketCount,
    );
    this.rustQueue = createRustTerritoryRenderQueue(
      mapW,
      mapH,
      settings.tileDrip.bucketCount,
      this.cpuTileState,
    );

    this.program = createProgram(
      gl,
      overlayVertSrc,
      shaderSrc(territoryFragSrc, {
        PALETTE_SIZE: getPaletteSize(),
        ...TILE_DEFINES,
      }),
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uAltView = gl.getUniformLocation(this.program, "uAltView")!;
    this.uStaleNukeBase = gl.getUniformLocation(
      this.program,
      "uStaleNukeBase",
    )!;
    this.uStaleNukeVariation = gl.getUniformLocation(
      this.program,
      "uStaleNukeVariation",
    )!;
    this.uStaleNukeAlpha = gl.getUniformLocation(
      this.program,
      "uStaleNukeAlpha",
    )!;
    this.uStaleNukeColor = gl.getUniformLocation(
      this.program,
      "uStaleNukeColor",
    )!;
    this.uHighlightOwner = gl.getUniformLocation(
      this.program,
      "uHighlightOwner",
    )!;
    this.uHighlightBrighten = gl.getUniformLocation(
      this.program,
      "uHighlightBrighten",
    )!;
    this.uShowPatterns = gl.getUniformLocation(this.program, "uShowPatterns")!;
    this.uIsTeamMode = gl.getUniformLocation(this.program, "uIsTeamMode")!;
    this.uDefenseDarken = gl.getUniformLocation(
      this.program,
      "uDefenseDarken",
    )!;
    this.uSaturation = gl.getUniformLocation(this.program, "uSaturation")!;
    this.uTerritoryAlpha = gl.getUniformLocation(
      this.program,
      "uTerritoryAlpha",
    )!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTileTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPalette"), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPatternMeta"), 2);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPatternData"), 3);
    gl.uniform1i(gl.getUniformLocation(this.program, "uSkinAtlas"), 4);
    gl.uniform1i(gl.getUniformLocation(this.program, "uSkinLayer"), 5);
    gl.uniform1i(gl.getUniformLocation(this.program, "uSkinAnchor"), 6);
    gl.uniform1i(gl.getUniformLocation(this.program, "uDefenseCoverageTex"), 7);
    gl.uniform1i(gl.getUniformLocation(this.program, "uBorderTex"), 8);

    this.vao = createMapQuad(gl, mapW, mapH);

    this.scatter = new TileScatterPass(gl, mapW, mapH, tileTex);
  }

  // ---------------------------------------------------------------------------
  // Tile data upload
  // ---------------------------------------------------------------------------

  /** Live-game path: snapshot the initial tile state and clear pending drip. */
  setLiveRef(tileState: Uint16Array): void {
    this.liveTileState = tileState;
    this.cpuTileState.set(tileState);
    if (this.rustQueue) {
      this.rustQueue.replace(tileState);
    } else {
      this.clearDripBuckets();
    }
    this.scatter.clear();
    this.fullUploadPending = true;
    this.tilesDirty = true;
    this.falloutTouched = true; // conservative: replaced state may have fallout
  }

  /**
   * Wire a consumer that will be called once per tile coordinate change while
   * scatter mode is active (i.e., not during a full upload). The renderer
   * hooks this to `borderPass.patchTile` so border recompute scales with the
   * number of changed tiles instead of full map area.
   */
  setBorderPatchConsumer(
    fn: (x: number, y: number, prevOwner: number, newOwner: number) => void,
  ): void {
    this.borderPatchConsumer = fn;
  }

  /**
   * Queue changed refs for staggered upload. A ref appears at most once while
   * pending; Rust stores the latest state with the pending ref so later updates
   * coalesce without retaining duplicate JavaScript work.
   */
  applyLiveDelta(
    tileState: Uint16Array,
    changedTiles: readonly number[],
  ): void {
    this.liveTileState = tileState;
    if (this.rustQueue) {
      this.rustQueue.enqueue(tileState, changedTiles);
      return;
    }
    for (let i = 0; i < changedTiles.length; i++) {
      this.dripQueue.enqueue(changedTiles[i]);
    }
  }

  private applyQueuedTile(ref: number): void {
    const live = this.liveTileState;
    if (live === null) return;

    const state = live[ref];
    const prev = this.cpuTileState[ref];
    if (state === prev) return;
    if (((prev ^ state) & FALLOUT_BIT) !== 0) {
      this.falloutTouched = true;
    }
    this.cpuTileState[ref] = state;
    if (this.fullUploadPending) return;

    const x = ref % this.mapW;
    const y = (ref - x) / this.mapW;
    this.scatter.push(x, y, state);
    const prevOwner = prev & OWNER_MASK;
    const newOwner = state & OWNER_MASK;
    if (prevOwner !== newOwner) {
      this.borderPatchConsumer?.(x, y, prevOwner, newOwner);
    }
  }

  private applyRustDrain(batch: RustTerritoryDrain): void {
    if (batch.falloutTouched) this.falloutTouched = true;
    if (batch.tilePatches.length === 0) return;

    this.tilesDirty = true;
    // A full texture upload will consume Rust's display-state mirror directly,
    // and BorderComputePass will be globally invalidated by the caller.
    if (this.fullUploadPending) return;

    this.scatter.pushBatch(batch.tilePatches);
    const changes = batch.borderChanges;
    for (let i = 0; i < changes.length; i += 4) {
      this.borderPatchConsumer?.(
        changes[i],
        changes[i + 1],
        changes[i + 2],
        changes[i + 3],
      );
    }
  }

  /** Drain one drip bucket into display state. Called once per render frame. */
  drainDripBucket(): void {
    if (this.rustQueue) {
      this.applyRustDrain(this.rustQueue.drainNext());
      return;
    }
    const count = this.dripQueue.drainNext((ref) => this.applyQueuedTile(ref));
    if (count > 0) this.tilesDirty = true;
  }

  /**
   * Drain every drip bucket immediately. Used during spawn phase and after
   * seek so tile state pops to current sim state without the stagger.
   */
  flushAllDripBuckets(): void {
    if (this.rustQueue) {
      this.applyRustDrain(this.rustQueue.drainAll());
      return;
    }
    const count = this.dripQueue.drainAll((ref) => this.applyQueuedTile(ref));
    if (count > 0) this.tilesDirty = true;
  }

  private clearDripBuckets(): void {
    if (this.rustQueue) {
      this.rustQueue.clear();
      return;
    }
    this.dripQueue.clear();
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Returns true (and resets) if any fallout bit flipped since the last call.
   * Checked by the renderer each frame to (re)activate heat decay.
   */
  consumeFalloutTouched(): boolean {
    const touched = this.falloutTouched;
    this.falloutTouched = false;
    return touched;
  }

  // ---------------------------------------------------------------------------
  // GPU flush + draw
  // ---------------------------------------------------------------------------

  /**
   * Flush tile texture to GPU early (before heat update reads it).
   * Return value lets the renderer decide what downstream invalidation is
   * needed — full uploads require a full border recompute, scatter uploads
   * already pushed per-tile border patches via `borderPatchConsumer`.
   */
  flushTileTexture(): "none" | "full" | "scatter" {
    if (!this.tilesDirty) return "none";
    const gl = this.gl;

    if (this.fullUploadPending) {
      // Full upload (first tick, seek, replay full frame, etc.) — supersedes
      // any queued scatter patches. The Rust fast path uploads directly from
      // Wasm linear memory, avoiding a map-sized synchronization copy to JS.
      const displayState = this.rustQueue?.displayState() ?? this.cpuTileState;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        this.mapW,
        this.mapH,
        gl.RED_INTEGER,
        gl.UNSIGNED_SHORT,
        displayState,
      );
      this.scatter.clear();
      this.fullUploadPending = false;
      this.tilesDirty = false;
      return "full";
    }
    if (this.scatter.count > 0) {
      // Per-frame patches — scatter via FBO + POINTS draw. Constant cost in
      // patch count regardless of spatial distribution.
      this.scatter.flush();
      this.tilesDirty = false;
      return "scatter";
    }

    this.tilesDirty = false;
    return "none";
  }

  setAltView(active: boolean): void {
    this.altView = active;
  }

  setShowPatterns(show: boolean): void {
    this.showPatterns = show;
  }

  /**
   * Update the skin atlas texture handle. Called once at game start after
   * the renderer learns the locked-in skin URL set.
   */
  setSkinAtlas(tex: WebGLTexture): void {
    this.skinAtlasTex = tex;
  }

  /** Whether this game has teams (controls skin tinting). */
  setTeamMode(isTeamMode: boolean): void {
    this.isTeamMode = isTeamMode;
  }

  /** Set the hovered player's smallID for territory-fill brightening (0 = off). */
  setHighlightOwner(ownerID: number): void {
    this.highlightOwner = ownerID;
  }

  /** Defense-coverage texture (R8) — darkens the fill on defended tiles. */
  setDefenseCoverageTex(tex: WebGLTexture): void {
    this.defenseCoverageTex = tex;
  }

  /** Border flags (RGBA8) — used to skip the defense darken on border tiles. */
  setBorderTex(tex: WebGLTexture): void {
    this.borderTex = tex;
  }

  /** Draw territory fill + stale-nuke ground. Blending must be enabled by caller. */
  draw(cameraMatrix: Float32Array): void {
    this.flushTileTexture();

    const gl = this.gl;
    const mo = this.settings.mapOverlay;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1i(this.uAltView, this.altView ? 1 : 0);
    gl.uniform1f(this.uStaleNukeBase, mo.staleNukeBase);
    gl.uniform1f(this.uStaleNukeVariation, mo.staleNukeVariation);
    gl.uniform1f(this.uStaleNukeAlpha, mo.staleNukeAlpha);
    gl.uniform3f(
      this.uStaleNukeColor,
      mo.staleNukeR,
      mo.staleNukeG,
      mo.staleNukeB,
    );
    gl.uniform1ui(this.uHighlightOwner, this.highlightOwner);
    gl.uniform1f(this.uHighlightBrighten, mo.highlightFillBrighten);
    gl.uniform1i(
      this.uShowPatterns,
      this.settings.passEnabled.territoryPatterns && this.showPatterns ? 1 : 0,
    );
    gl.uniform1i(this.uIsTeamMode, this.isTeamMode ? 1 : 0);
    gl.uniform1f(this.uDefenseDarken, mo.territoryDefenseDarken);
    gl.uniform1f(this.uSaturation, mo.territorySaturation);
    gl.uniform1f(this.uTerritoryAlpha, mo.territoryAlpha);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.patternMetaTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.patternDataTex);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.skinAtlasTex);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.skinLayerTex);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.skinAnchorTex);
    if (this.defenseCoverageTex) {
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, this.defenseCoverageTex);
    }
    if (this.borderTex) {
      gl.activeTexture(gl.TEXTURE8);
      gl.bindTexture(gl.TEXTURE_2D, this.borderTex);
    }

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    this.scatter.dispose();
    this.rustQueue?.dispose();
    this.rustQueue = null;
    // tileTex, paletteTex, patternMetaTex, patternDataTex owned by GPUResources / renderer
  }
}
