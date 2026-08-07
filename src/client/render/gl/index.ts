export type { AttackRingInput } from "../types";
// createDebugGui is intentionally not re-exported here — it pulls lil-gui and
// the debug GUI into the main bundle; dynamically import "./debug/index".
export { GraphicsOverridesSchema } from "./GraphicsOverrides";
export type { GraphicsOverrides, GraphicsPresets } from "./GraphicsOverrides";
export { GLUnavailableError, showGLGate, trackGLInit } from "./initGL";
export { MapRenderer } from "./MapRenderer";
import { preloadAtlasData as preloadNameAtlasData } from "./passes/name-pass/AtlasData";
import { preloadRustTerrainEncoder } from "./utils/ColorUtils";

// ClientGameRunner already awaits this graphics preload before constructing
// GPURenderer. Fold the main-thread Rust graphics instance into the same gate
// so the very first terrain texture build uses Rust rather than only later
// theme/context rebuilds.
export async function preloadAtlasData() {
  const [atlasData] = await Promise.all([
    preloadNameAtlasData(),
    preloadRustTerrainEncoder(),
  ]);
  return atlasData;
}

export type { SpawnCenter } from "./passes/SpawnOverlayPass";
export { applyGraphicsOverrides } from "./RenderOverrides";
export { createRenderSettings, dumpSettings } from "./RenderSettings";
export type { RenderSettings } from "./RenderSettings";
export { deepAssign, deepDiff } from "./SettingsUtils";
export {
  MAX_TRAIL_COLORS,
  buildTerrainRGBA,
  getPaletteSize,
} from "./utils/ColorUtils";
export { renderDpr } from "./utils/Dpr";
export { buildNukeTrajectory, samRange } from "./utils/NukeTrajectory";
export type { SAMInfo } from "./utils/NukeTrajectory";

// Re-export shared types used in the public API
export type {
  NameEntry,
  PlayerState,
  PlayerStatic,
  RendererConfig,
  UnitState,
} from "../types";
