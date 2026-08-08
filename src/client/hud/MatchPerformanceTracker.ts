type SpanWindow = {
  totalMs: number;
  calls: number;
  maxMs: number;
};

export type PerformanceSpanSample = {
  avgMs: number;
  totalMs: number;
  calls: number;
  maxMs: number;
};

export type MatchPerformanceSample = {
  elapsedSec: number;
  fps: number;
  frameAvgMs: number;
  frameP95Ms: number;
  frameMaxMs: number;
  heapUsedMB: number | null;
  heapDeltaMB: number | null;
  domNodes: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  longTaskMaxMs: number;
  eventLoopLagMaxMs: number;
  workerTickMs: number | null;
  tickDelayMs: number | null;
  gpuFrameAvgMs: number | null;
  counts: Record<string, number>;
  spans: Record<string, PerformanceSpanSample>;
};

export type MatchPerformanceDiagnosis = {
  currentHotspots: Array<{
    name: string;
    avgMs: number;
    totalMs: number;
    calls: number;
  }>;
  fastestGrowing: Array<{
    name: string;
    baselineAvgMs: number;
    recentAvgMs: number;
    ratio: number;
    deltaMs: number;
  }>;
  fpsChange: number | null;
  heapGrowthMB: number | null;
  domNodeGrowth: number;
};

export type MatchPerformanceSnapshot = {
  generatedAt: string;
  elapsedSec: number;
  sampleIntervalSec: number;
  latest: MatchPerformanceSample | null;
  diagnosis: MatchPerformanceDiagnosis;
  lifetimeSpans: Record<string, PerformanceSpanSample>;
  history: MatchPerformanceSample[];
};

type UnknownFn = (this: unknown, ...args: unknown[]) => unknown;
type UnknownRecord = Record<string, unknown>;

type MemoryPerformance = Performance & {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
};

type PerfGlobal = typeof globalThis & {
  __webglView?: unknown;
  __OPENFRONT_PERF__?: {
    snapshot: () => MatchPerformanceSnapshot;
    copy: () => Promise<boolean>;
    reset: () => void;
  };
};

const SAMPLE_INTERVAL_MS = 5000;
const MAX_HISTORY_SAMPLES = 360;
const MAX_SPANS_PER_SAMPLE = 40;
const FRAME_WINDOW_LIMIT = 600;
const EVENT_LOOP_INTERVAL_MS = 1000;

function asRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== "object" || value === null) return null;
  return value as UnknownRecord;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1),
  );
  return sorted[index];
}

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function spanAverage(
  samples: readonly MatchPerformanceSample[],
  name: string,
): number | null {
  const values: number[] = [];
  for (const sample of samples) {
    const span = sample.spans[name];
    if (span !== undefined) values.push(span.avgMs);
  }
  return values.length === 0 ? null : average(values);
}

export class MatchPerformanceTracker {
  private enabled = false;
  private startedAtMs = 0;
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private lagTimer: ReturnType<typeof setInterval> | null = null;
  private rafId: number | null = null;
  private lastRafTime = 0;
  private nextLagExpectedAt = 0;
  private longTaskObserver: PerformanceObserver | null = null;
  private panel: HTMLDivElement | null = null;

  private readonly patchedMethods = new WeakMap<object, Set<string>>();
  private readonly frameTimes: number[] = [];
  private readonly spanWindow = new Map<string, SpanWindow>();
  private readonly lifetimeSpans = new Map<string, SpanWindow>();
  private readonly history: MatchPerformanceSample[] = [];
  private readonly pendingGpuQueries: Array<{
    gl: WebGL2RenderingContext;
    ext: EXT_disjoint_timer_query_webgl2;
    query: WebGLQuery;
  }> = [];
  private readonly gpuFrameWindow: number[] = [];

  private baselineHeapBytes: number | null = null;
  private longTaskCount = 0;
  private longTaskTotalMs = 0;
  private longTaskMaxMs = 0;
  private eventLoopLagMaxMs = 0;
  private latestWorkerTickMs: number | null = null;
  private latestTickDelayMs: number | null = null;
  private readonly latestCounts: Record<string, number> = {};

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.start();
    } else {
      this.stopSampling();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  record(name: string, durationMs: number): void {
    if (!this.enabled || !Number.isFinite(durationMs) || durationMs < 0) return;
    this.addSpan(this.spanWindow, name, durationMs);
    this.addSpan(this.lifetimeSpans, name, durationMs);
  }

  reset(): void {
    this.startedAtMs = performance.now();
    this.frameTimes.length = 0;
    this.spanWindow.clear();
    this.lifetimeSpans.clear();
    this.history.length = 0;
    this.gpuFrameWindow.length = 0;
    this.baselineHeapBytes = this.readHeapUsedBytes();
    this.longTaskCount = 0;
    this.longTaskTotalMs = 0;
    this.longTaskMaxMs = 0;
    this.eventLoopLagMaxMs = 0;
    this.latestWorkerTickMs = null;
    this.latestTickDelayMs = null;
    for (const key of Object.keys(this.latestCounts)) delete this.latestCounts[key];
    this.updatePanel();
  }

  snapshot(): MatchPerformanceSnapshot {
    return {
      generatedAt: new Date().toISOString(),
      elapsedSec: round((performance.now() - this.startedAtMs) / 1000, 1),
      sampleIntervalSec: SAMPLE_INTERVAL_MS / 1000,
      latest: this.history.at(-1) ?? null,
      diagnosis: this.buildDiagnosis(),
      lifetimeSpans: this.serializeSpanMap(this.lifetimeSpans, false),
      history: this.history.map((sample) => ({
        ...sample,
        counts: { ...sample.counts },
        spans: { ...sample.spans },
      })),
    };
  }

  async copySnapshot(): Promise<boolean> {
    const json = JSON.stringify(this.snapshot(), null, 2);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = json;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      return true;
    } catch (error) {
      console.warn("Unable to copy OpenFront performance snapshot", error);
      console.log("OpenFront performance snapshot", this.snapshot());
      return false;
    }
  }

  private start(): void {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (this.startedAtMs === 0) this.reset();
    this.installGlobalApi();
    this.installLongTaskObserver();
    this.patchRuntimeTargets();
    this.ensurePanel();

    if (this.rafId === null) {
      this.lastRafTime = 0;
      this.rafId = requestAnimationFrame(this.onAnimationFrame);
    }
    if (this.sampleTimer === null) {
      this.sampleTimer = setInterval(() => this.captureSample(), SAMPLE_INTERVAL_MS);
    }
    if (this.lagTimer === null) {
      this.nextLagExpectedAt = performance.now() + EVENT_LOOP_INTERVAL_MS;
      this.lagTimer = setInterval(
        () => this.measureEventLoopLag(),
        EVENT_LOOP_INTERVAL_MS,
      );
    }
  }

  private stopSampling(): void {
    if (this.sampleTimer !== null) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
    if (this.lagTimer !== null) {
      clearInterval(this.lagTimer);
      this.lagTimer = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastRafTime = 0;
    this.longTaskObserver?.disconnect();
    this.longTaskObserver = null;
    this.panel?.remove();
    this.panel = null;
  }

  private readonly onAnimationFrame = (now: number): void => {
    if (!this.enabled) {
      this.rafId = null;
      return;
    }
    if (!document.hidden && this.lastRafTime !== 0) {
      const delta = now - this.lastRafTime;
      if (delta > 0 && delta < 1000) {
        this.frameTimes.push(delta);
        if (this.frameTimes.length > FRAME_WINDOW_LIMIT) this.frameTimes.shift();
      }
    }
    this.lastRafTime = now;
    this.pollGpuQueries();
    this.rafId = requestAnimationFrame(this.onAnimationFrame);
  };

  private measureEventLoopLag(): void {
    const now = performance.now();
    const lag = Math.max(0, now - this.nextLagExpectedAt);
    this.eventLoopLagMaxMs = Math.max(this.eventLoopLagMaxMs, lag);
    this.nextLagExpectedAt = now + EVENT_LOOP_INTERVAL_MS;
    this.patchRuntimeTargets();
  }

  private installLongTaskObserver(): void {
    if (this.longTaskObserver !== null || typeof PerformanceObserver === "undefined") {
      return;
    }
    const supported = PerformanceObserver.supportedEntryTypes ?? [];
    if (!supported.includes("longtask")) return;
    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!this.enabled) continue;
          this.longTaskCount++;
          this.longTaskTotalMs += entry.duration;
          this.longTaskMaxMs = Math.max(this.longTaskMaxMs, entry.duration);
        }
      });
      this.longTaskObserver.observe({ entryTypes: ["longtask"] });
    } catch {
      this.longTaskObserver = null;
    }
  }

  private captureSample(): void {
    if (!this.enabled) return;
    this.patchRuntimeTargets();
    this.pollGpuQueries();

    const frames = this.frameTimes.splice(0, this.frameTimes.length);
    const frameAvgMs = average(frames);
    const heapUsedBytes = this.readHeapUsedBytes();
    if (this.baselineHeapBytes === null && heapUsedBytes !== null) {
      this.baselineHeapBytes = heapUsedBytes;
    }

    const gpuAvgMs =
      this.gpuFrameWindow.length > 0 ? average(this.gpuFrameWindow) : null;
    this.gpuFrameWindow.length = 0;

    const sample: MatchPerformanceSample = {
      elapsedSec: round((performance.now() - this.startedAtMs) / 1000, 1),
      fps: frameAvgMs > 0 ? round(1000 / frameAvgMs, 1) : 0,
      frameAvgMs: round(frameAvgMs),
      frameP95Ms: round(percentile(frames, 0.95)),
      frameMaxMs: round(frames.length > 0 ? Math.max(...frames) : 0),
      heapUsedMB:
        heapUsedBytes === null ? null : round(heapUsedBytes / (1024 * 1024), 1),
      heapDeltaMB:
        heapUsedBytes === null || this.baselineHeapBytes === null
          ? null
          : round((heapUsedBytes - this.baselineHeapBytes) / (1024 * 1024), 1),
      domNodes: document.getElementsByTagName("*").length,
      longTaskCount: this.longTaskCount,
      longTaskTotalMs: round(this.longTaskTotalMs),
      longTaskMaxMs: round(this.longTaskMaxMs),
      eventLoopLagMaxMs: round(this.eventLoopLagMaxMs),
      workerTickMs:
        this.latestWorkerTickMs === null ? null : round(this.latestWorkerTickMs),
      tickDelayMs:
        this.latestTickDelayMs === null ? null : round(this.latestTickDelayMs),
      gpuFrameAvgMs: gpuAvgMs === null ? null : round(gpuAvgMs),
      counts: { ...this.latestCounts },
      spans: this.serializeSpanMap(this.spanWindow, true),
    };

    this.spanWindow.clear();
    this.longTaskCount = 0;
    this.longTaskTotalMs = 0;
    this.longTaskMaxMs = 0;
    this.eventLoopLagMaxMs = 0;

    this.history.push(sample);
    if (this.history.length > MAX_HISTORY_SAMPLES) this.history.shift();
    this.updatePanel();
  }

  private addSpan(target: Map<string, SpanWindow>, name: string, durationMs: number): void {
    const current = target.get(name);
    if (current === undefined) {
      target.set(name, { totalMs: durationMs, calls: 1, maxMs: durationMs });
      return;
    }
    current.totalMs += durationMs;
    current.calls++;
    current.maxMs = Math.max(current.maxMs, durationMs);
  }

  private serializeSpanMap(
    source: Map<string, SpanWindow>,
    limit: boolean,
  ): Record<string, PerformanceSpanSample> {
    const entries = Array.from(source.entries())
      .map(([name, span]) => [
        name,
        {
          avgMs: round(span.totalMs / Math.max(1, span.calls)),
          totalMs: round(span.totalMs),
          calls: span.calls,
          maxMs: round(span.maxMs),
        } satisfies PerformanceSpanSample,
      ] as const)
      .sort((a, b) => b[1].totalMs - a[1].totalMs);

    const selected = limit ? entries.slice(0, MAX_SPANS_PER_SAMPLE) : entries;
    return Object.fromEntries(selected);
  }

  private buildDiagnosis(): MatchPerformanceDiagnosis {
    const latest = this.history.at(-1);
    const first = this.history[0];
    if (latest === undefined || first === undefined) {
      return {
        currentHotspots: [],
        fastestGrowing: [],
        fpsChange: null,
        heapGrowthMB: null,
        domNodeGrowth: 0,
      };
    }

    const recent = this.history.slice(-6);
    const baseline = this.history.slice(0, Math.min(6, this.history.length));
    const currentHotspots = Object.entries(latest.spans)
      .sort((a, b) => b[1].totalMs - a[1].totalMs)
      .slice(0, 8)
      .map(([name, span]) => ({
        name,
        avgMs: span.avgMs,
        totalMs: span.totalMs,
        calls: span.calls,
      }));

    const names = new Set<string>();
    for (const sample of baseline) for (const name of Object.keys(sample.spans)) names.add(name);
    for (const sample of recent) for (const name of Object.keys(sample.spans)) names.add(name);

    const fastestGrowing: MatchPerformanceDiagnosis["fastestGrowing"] = [];
    for (const name of names) {
      const baselineAvgMs = spanAverage(baseline, name);
      const recentAvgMs = spanAverage(recent, name);
      if (baselineAvgMs === null || recentAvgMs === null) continue;
      if (recentAvgMs < 0.1 || baselineAvgMs < 0.02) continue;
      const ratio = recentAvgMs / baselineAvgMs;
      if (ratio < 1.15) continue;
      fastestGrowing.push({
        name,
        baselineAvgMs: round(baselineAvgMs),
        recentAvgMs: round(recentAvgMs),
        ratio: round(ratio),
        deltaMs: round(recentAvgMs - baselineAvgMs),
      });
    }
    fastestGrowing.sort((a, b) => b.deltaMs - a.deltaMs);

    return {
      currentHotspots,
      fastestGrowing: fastestGrowing.slice(0, 8),
      fpsChange:
        first.fps > 0 ? round(((latest.fps - first.fps) / first.fps) * 100, 1) : null,
      heapGrowthMB:
        first.heapUsedMB === null || latest.heapUsedMB === null
          ? null
          : round(latest.heapUsedMB - first.heapUsedMB, 1),
      domNodeGrowth: latest.domNodes - first.domNodes,
    };
  }

  private readHeapUsedBytes(): number | null {
    const memory = (performance as MemoryPerformance).memory;
    if (!memory || !Number.isFinite(memory.usedJSHeapSize)) return null;
    return memory.usedJSHeapSize;
  }

  private installGlobalApi(): void {
    const global = globalThis as PerfGlobal;
    global.__OPENFRONT_PERF__ = {
      snapshot: () => this.snapshot(),
      copy: () => this.copySnapshot(),
      reset: () => this.reset(),
    };
  }

  private patchRuntimeTargets(): void {
    if (typeof document === "undefined") return;
    this.patchWebGLView();
    this.patchGameView();
    this.patchPerformanceOverlay();
  }

  private patchWebGLView(): void {
    const global = globalThis as PerfGlobal;
    const view = global.__webglView;
    if (view === undefined) return;

    const publicMethods = [
      "uploadLiveDelta",
      "uploadLiveTrailDelta",
      "uploadTileAndTrailState",
      "updateSpiralRibbons",
      "updatePalette",
      "updateEffectPalette",
      "uploadRailroadState",
      "updateUnits",
      "updateNames",
      "updateRelations",
      "updateStructures",
      "applyTerrainDelta",
      "applyDeadUnits",
      "applyConquestEvents",
    ] as const;
    for (const method of publicMethods) {
      this.patchMethod(view, method, `view.${method}`);
    }

    const viewRecord = asRecord(view);
    const renderer = viewRecord?.renderer;
    if (renderer === undefined) return;
    this.patchRenderer(renderer);
  }

  private patchRenderer(renderer: unknown): void {
    this.patchGpuTimedDraw(renderer);
    for (const method of ["uploadTextures", "computeTextures", "renderFrame"] as const) {
      this.patchMethod(renderer, method, `render.${method}`);
    }

    const rendererRecord = asRecord(renderer);
    if (rendererRecord === null) return;
    const passMethods: ReadonlyArray<readonly [string, readonly string[]]> = [
      ["terrainPass", ["draw", "applyTerrainDelta"]],
      ["territoryPass", ["draw", "flushTileTexture", "drainDripBucket"]],
      ["borderPass", ["draw"]],
      ["borderStampPass", ["draw"]],
      ["defenseCoveragePass", ["draw"]],
      ["railroadPass", ["draw", "applyTerrainDelta"]],
      ["unitPass", ["updateUnits", "drawGround", "drawMissiles"]],
      ["structurePass", ["updateStructures", "draw"]],
      ["structureLevelPass", ["updateStructures", "draw"]],
      ["namePass", ["updateNames", "draw"]],
      ["trailPass", ["flushTexture", "draw"]],
      ["bloomPass", ["draw"]],
      ["lightmapPass", ["draw"]],
      ["fxPass", ["tick", "draw"]],
      ["samRadiusPass", ["updateStructures", "draw"]],
      ["heatManager", ["updateHeat", "decayHeat"]],
    ];
    for (const [property, methods] of passMethods) {
      const target = rendererRecord[property];
      if (target === undefined) continue;
      for (const method of methods) {
        this.patchMethod(target, method, `${property}.${method}`);
      }
    }
  }

  private patchGameView(): void {
    for (const selector of [
      "game-left-sidebar",
      "unit-display",
      "game-right-sidebar",
      "player-panel",
    ]) {
      const elementRecord = asRecord(document.querySelector(selector));
      if (elementRecord === null) continue;
      const gameView = elementRecord.game ?? elementRecord.g;
      if (gameView === undefined) continue;
      this.patchMethod(gameView, "update", "main.gameView.update");
      this.patchFrameData(gameView);
      return;
    }
  }

  private patchFrameData(gameView: unknown): void {
    const target = asRecord(gameView);
    if (target === null) return;
    const key = "capture:frameData";
    if (!this.markPatched(target, key)) return;
    const original = target.frameData;
    if (typeof original !== "function") return;
    const originalFn = original as UnknownFn;
    const tracker = this;
    target.frameData = function (this: unknown, ...args: unknown[]): unknown {
      const start = tracker.enabled ? performance.now() : 0;
      const result = originalFn.apply(this, args);
      if (tracker.enabled) {
        tracker.record("main.gameView.frameData", performance.now() - start);
        const frame = asRecord(result);
        if (frame !== null) {
          const units = frame.units;
          if (units instanceof Map) tracker.latestCounts.units = units.size;
          const changedTiles = frame.changedTiles;
          if (Array.isArray(changedTiles) || ArrayBuffer.isView(changedTiles)) {
            tracker.latestCounts.changedTiles = changedTiles.length;
          }
        }
      }
      return result;
    };
  }

  private patchPerformanceOverlay(): void {
    const overlay = document.querySelector("performance-overlay");
    if (overlay === null) return;
    this.patchTickLayerCapture(overlay);
    this.patchTickMetricsCapture(overlay);
  }

  private patchTickLayerCapture(overlay: unknown): void {
    const target = asRecord(overlay);
    if (target === null) return;
    const key = "capture:updateTickLayerMetrics";
    if (!this.markPatched(target, key)) return;
    const original = target.updateTickLayerMetrics;
    if (typeof original !== "function") return;
    const originalFn = original as UnknownFn;
    const tracker = this;
    target.updateTickLayerMetrics = function (
      this: unknown,
      durations: unknown,
      ...rest: unknown[]
    ): unknown {
      if (tracker.enabled) {
        const values = asRecord(durations);
        if (values !== null) {
          for (const [name, value] of Object.entries(values)) {
            if (typeof value === "number") tracker.record(`ui.${name}`, value);
          }
        }
      }
      return originalFn.apply(this, [durations, ...rest]);
    };
  }

  private patchTickMetricsCapture(overlay: unknown): void {
    const target = asRecord(overlay);
    if (target === null) return;
    const key = "capture:updateTickMetrics";
    if (!this.markPatched(target, key)) return;
    const original = target.updateTickMetrics;
    if (typeof original !== "function") return;
    const originalFn = original as UnknownFn;
    const tracker = this;
    target.updateTickMetrics = function (
      this: unknown,
      tickExecutionDuration: unknown,
      tickDelay: unknown,
      ...rest: unknown[]
    ): unknown {
      if (tracker.enabled) {
        if (typeof tickExecutionDuration === "number") {
          tracker.latestWorkerTickMs = tickExecutionDuration;
          tracker.record("worker.tickExecution", tickExecutionDuration);
        }
        if (typeof tickDelay === "number") tracker.latestTickDelayMs = tickDelay;
      }
      return originalFn.apply(this, [tickExecutionDuration, tickDelay, ...rest]);
    };
  }

  private patchGpuTimedDraw(renderer: unknown): void {
    const target = asRecord(renderer);
    if (target === null) return;
    const key = "gpu:draw";
    if (!this.markPatched(target, key)) return;
    const original = target.draw;
    const gl = target.gl;
    if (typeof original !== "function" || !(gl instanceof WebGL2RenderingContext)) {
      return;
    }
    const originalFn = original as UnknownFn;
    const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    const tracker = this;
    target.draw = function (this: unknown, ...args: unknown[]): unknown {
      const start = tracker.enabled ? performance.now() : 0;
      let query: WebGLQuery | null = null;
      if (tracker.enabled && ext !== null) {
        query = gl.createQuery();
        if (query !== null) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      }
      try {
        return originalFn.apply(this, args);
      } finally {
        if (tracker.enabled) tracker.record("render.frame.cpu", performance.now() - start);
        if (query !== null && ext !== null) {
          gl.endQuery(ext.TIME_ELAPSED_EXT);
          tracker.pendingGpuQueries.push({ gl, ext, query });
        }
      }
    };
  }

  private pollGpuQueries(): void {
    for (let index = 0; index < this.pendingGpuQueries.length; ) {
      const pending = this.pendingGpuQueries[index];
      const available = pending.gl.getQueryParameter(
        pending.query,
        pending.gl.QUERY_RESULT_AVAILABLE,
      ) as boolean;
      if (!available) {
        index++;
        continue;
      }
      const disjoint = pending.gl.getParameter(pending.ext.GPU_DISJOINT_EXT) as boolean;
      if (!disjoint) {
        const nanoseconds = pending.gl.getQueryParameter(
          pending.query,
          pending.gl.QUERY_RESULT,
        ) as number;
        if (Number.isFinite(nanoseconds)) {
          const milliseconds = nanoseconds / 1_000_000;
          this.gpuFrameWindow.push(milliseconds);
          this.record("render.frame.gpu", milliseconds);
        }
      }
      pending.gl.deleteQuery(pending.query);
      this.pendingGpuQueries.splice(index, 1);
    }
  }

  private patchMethod(targetValue: unknown, methodName: string, label: string): void {
    const target = asRecord(targetValue);
    if (target === null) return;
    const key = `duration:${methodName}`;
    if (!this.markPatched(target, key)) return;
    const original = target[methodName];
    if (typeof original !== "function") return;
    const originalFn = original as UnknownFn;
    const tracker = this;
    target[methodName] = function (this: unknown, ...args: unknown[]): unknown {
      if (!tracker.enabled) return originalFn.apply(this, args);
      const start = performance.now();
      try {
        return originalFn.apply(this, args);
      } finally {
        tracker.record(label, performance.now() - start);
      }
    };
  }

  private markPatched(target: object, key: string): boolean {
    let methods = this.patchedMethods.get(target);
    if (methods === undefined) {
      methods = new Set<string>();
      this.patchedMethods.set(target, methods);
    }
    if (methods.has(key)) return false;
    methods.add(key);
    return true;
  }

  private ensurePanel(): void {
    if (this.panel !== null || typeof document === "undefined") return;
    const panel = document.createElement("div");
    panel.id = "openfront-match-performance-tracker";
    Object.assign(panel.style, {
      position: "fixed",
      right: "8px",
      bottom: "8px",
      zIndex: "10000",
      maxWidth: "min(420px, calc(100vw - 16px))",
      padding: "8px",
      borderRadius: "4px",
      background: "rgba(0, 0, 0, 0.84)",
      color: "white",
      font: "11px monospace",
      whiteSpace: "pre-wrap",
      pointerEvents: "auto",
    });
    document.body.appendChild(panel);
    this.panel = panel;
    this.updatePanel();
  }

  private updatePanel(): void {
    const panel = this.panel;
    if (panel === null) return;
    const latest = this.history.at(-1);
    const diagnosis = this.buildDiagnosis();
    const hot = diagnosis.currentHotspots[0];
    const growth = diagnosis.fastestGrowing[0];
    const lines = ["MATCH PROFILER"];
    if (latest === undefined) {
      lines.push("Collecting 5s baseline...");
    } else {
      lines.push(
        `FPS ${latest.fps.toFixed(1)} | frame ${latest.frameAvgMs.toFixed(1)}ms p95 ${latest.frameP95Ms.toFixed(1)}ms`,
      );
      if (latest.gpuFrameAvgMs !== null) {
        lines.push(`GPU frame ${latest.gpuFrameAvgMs.toFixed(2)}ms`);
      }
      if (latest.heapUsedMB !== null) {
        lines.push(
          `Heap ${latest.heapUsedMB.toFixed(1)}MB (${latest.heapDeltaMB !== null && latest.heapDeltaMB >= 0 ? "+" : ""}${latest.heapDeltaMB?.toFixed(1) ?? "?"}MB) | DOM ${latest.domNodes}`,
        );
      } else {
        lines.push(`DOM ${latest.domNodes} | heap API unavailable`);
      }
      lines.push(
        `Long tasks ${latest.longTaskCount} / ${latest.longTaskTotalMs.toFixed(0)}ms | lag max ${latest.eventLoopLagMaxMs.toFixed(0)}ms`,
      );
      if (hot !== undefined) {
        lines.push(`Hot: ${hot.name} ${hot.avgMs.toFixed(2)}ms avg (${hot.calls} calls/5s)`);
      }
      if (growth !== undefined) {
        lines.push(
          `Growing: ${growth.name} ${growth.baselineAvgMs.toFixed(2)}→${growth.recentAvgMs.toFixed(2)}ms (${growth.ratio.toFixed(2)}x)`,
        );
      }
    }

    panel.replaceChildren();
    const text = document.createElement("div");
    text.textContent = lines.join("\n");
    panel.appendChild(text);

    const copy = document.createElement("button");
    copy.textContent = "Copy full timeline";
    copy.style.marginTop = "6px";
    copy.style.marginRight = "6px";
    copy.addEventListener("click", () => {
      void this.copySnapshot().then((ok) => {
        copy.textContent = ok ? "Copied" : "Copy failed";
        setTimeout(() => {
          copy.textContent = "Copy full timeline";
        }, 1500);
      });
    });
    panel.appendChild(copy);

    const reset = document.createElement("button");
    reset.textContent = "Reset baseline";
    reset.addEventListener("click", () => this.reset());
    panel.appendChild(reset);
  }
}

export const matchPerformanceTracker = new MatchPerformanceTracker();
