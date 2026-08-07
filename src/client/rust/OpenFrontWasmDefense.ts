import { assetUrl } from "../../core/AssetUrls";
import {
  OpenFrontWasmModule,
  type RustDefensePathPoint,
  type RustDefenseRecord,
} from "./OpenFrontWasmModule";

export interface RustStrategicRouteInput {
  path: readonly RustDefensePathPoint[];
  source: { x: number; y: number };
  destination: { x: number; y: number };
  targetableRange: number;
  sams: readonly RustDefenseRecord[];
}

export interface RustStrategicRouteAssessment {
  blocked: boolean;
  interceptingSams: number;
  interceptionCapacity: number;
}

type LoadedDefenseIndex = {
  module: OpenFrontWasmModule;
  handle: number;
};

type DefenseModuleLoader = () => Promise<OpenFrontWasmModule>;

let loaded: LoadedDefenseIndex | null = null;
let loadPromise: Promise<void> | null = null;
let disabled = false;
let failureLogged = false;
let hasDefenseSnapshot = false;
let cachedDefenses: RustDefenseRecord[] = [];

function sameDefenseSnapshot(defenses: readonly RustDefenseRecord[]): boolean {
  if (!hasDefenseSnapshot || defenses.length !== cachedDefenses.length) return false;
  for (let index = 0; index < defenses.length; index++) {
    const next = defenses[index]!;
    const previous = cachedDefenses[index]!;
    if (
      next.id !== previous.id ||
      next.x !== previous.x ||
      next.y !== previous.y ||
      next.range !== previous.range ||
      next.availableInterceptions !== previous.availableInterceptions
    ) {
      return false;
    }
  }
  return true;
}

function rememberDefenseSnapshot(defenses: readonly RustDefenseRecord[]): void {
  cachedDefenses = defenses.map((defense) => ({ ...defense }));
  hasDefenseSnapshot = true;
}

function disableRustDefense(error: unknown): void {
  disabled = true;
  if (loaded !== null) {
    try {
      loaded.module.destroyDefenseIndex(loaded.handle);
    } catch {
      // The original error is the useful one; cleanup failure is not actionable.
    }
    loaded = null;
  }
  if (!failureLogged) {
    failureLogged = true;
    console.warn(
      "Rust defense index unavailable; using TypeScript route assessment",
      error,
    );
  }
}

function loadBrowserDefenseModule(): Promise<OpenFrontWasmModule> {
  return OpenFrontWasmModule.load(assetUrl("wasm/openfront_wasm.wasm"));
}

/** Whether the persistent Rust defense index is loaded and available. */
export function isRustDefenseIndexReady(): boolean {
  return loaded !== null && !disabled;
}

/**
 * Preload the persistent Rust defense index; failures preserve TS fallback.
 * Tests and headless callers may inject a loader so they can instantiate the
 * built Wasm bytes directly instead of relying on browser-relative fetches.
 */
export function preloadRustDefenseIndex(
  loadModule: DefenseModuleLoader = loadBrowserDefenseModule,
): Promise<void> {
  if (loaded !== null || disabled) return Promise.resolve();
  if (loadPromise !== null) return loadPromise;

  loadPromise = loadModule()
    .then((module) => {
      loaded = {
        module,
        handle: module.createDefenseIndex(32),
      };
    })
    .catch((error: unknown) => {
      disableRustDefense(error);
    });
  return loadPromise;
}

/**
 * Use Rust when its Wasm module is ready. The first browser call starts an
 * asynchronous preload and returns null, allowing the existing TypeScript path
 * to serve as a deterministic fallback until Rust is available.
 */
export function assessStrategicRouteRust(
  input: RustStrategicRouteInput,
): RustStrategicRouteAssessment | null {
  if (disabled) return null;
  if (loaded === null) {
    if (typeof window !== "undefined") void preloadRustDefenseIndex();
    return null;
  }

  try {
    if (!sameDefenseSnapshot(input.sams)) {
      loaded.module.replaceDefenseIndex(loaded.handle, input.sams);
      rememberDefenseSnapshot(input.sams);
    }
    const assessment = loaded.module.assessDefensePath(
      loaded.handle,
      input.path,
      input.source,
      input.destination,
      input.targetableRange,
    );
    return {
      blocked: assessment.blocked,
      interceptingSams: assessment.interceptingDefenses,
      interceptionCapacity: assessment.interceptionCapacity,
    };
  } catch (error: unknown) {
    disableRustDefense(error);
    return null;
  }
}
