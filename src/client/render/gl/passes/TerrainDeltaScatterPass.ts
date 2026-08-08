import { createProgram } from "../utils/GlUtils";

import byteFragSrc from "../shaders/terrain/terrain-delta-scatter-byte.frag.glsl?raw";
import rgbaFragSrc from "../shaders/terrain/terrain-delta-scatter-rgba.frag.glsl?raw";
import vertSrc from "../shaders/terrain/terrain-delta-scatter.vert.glsl?raw";

const WORDS_PER_PATCH = 3;
const BYTES_PER_PATCH = WORDS_PER_PATCH * Uint32Array.BYTES_PER_ELEMENT;

/**
 * Applies sparse terrain changes with one buffer upload and point-raster scatter
 * draws. The same packed records update the visible RGBA terrain texture and
 * every R8UI terrain-byte mirror that depends on simulation terrain.
 */
export class TerrainDeltaScatterPass {
  private readonly rgbaProgram: WebGLProgram;
  private readonly byteProgram: WebGLProgram;
  private readonly rgbaMapSize: WebGLUniformLocation;
  private readonly byteMapSize: WebGLUniformLocation;
  private readonly fbo: WebGLFramebuffer;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private gpuCapacityBytes = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly mapW: number,
    private readonly mapH: number,
    private readonly rgbaTarget: WebGLTexture,
    private readonly byteTargets: readonly WebGLTexture[],
  ) {
    this.rgbaProgram = createProgram(gl, vertSrc, rgbaFragSrc);
    this.byteProgram = createProgram(gl, vertSrc, byteFragSrc);
    this.rgbaMapSize = gl.getUniformLocation(this.rgbaProgram, "uMapSize")!;
    this.byteMapSize = gl.getUniformLocation(this.byteProgram, "uMapSize")!;

    this.fbo = gl.createFramebuffer()!;
    this.vbo = gl.createBuffer()!;
    this.vao = gl.createVertexArray()!;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 3, gl.UNSIGNED_INT, BYTES_PER_PATCH, 0);
    gl.bindVertexArray(null);
  }

  /**
   * `patches` is `[tileRef, terrainByte, packedRGBA, ...]`, where packedRGBA
   * stores R in the low byte and A in the high byte.
   */
  apply(patches: Uint32Array): void {
    if (patches.length === 0) return;
    if (patches.length % WORDS_PER_PATCH !== 0) {
      throw new Error(
        `Invalid terrain scatter batch: ${patches.length} words is not divisible by ${WORDS_PER_PATCH}`,
      );
    }

    const gl = this.gl;
    const byteCount = patches.byteLength;
    const patchCount = patches.length / WORDS_PER_PATCH;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    if (byteCount > this.gpuCapacityBytes) {
      gl.bufferData(gl.ARRAY_BUFFER, patches, gl.STREAM_DRAW);
      this.gpuCapacityBytes = byteCount;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, patches);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.mapW, this.mapH);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);

    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.rgbaTarget,
      0,
    );
    gl.useProgram(this.rgbaProgram);
    gl.uniform2ui(this.rgbaMapSize, this.mapW, this.mapH);
    gl.drawArrays(gl.POINTS, 0, patchCount);

    gl.useProgram(this.byteProgram);
    gl.uniform2ui(this.byteMapSize, this.mapW, this.mapH);
    for (const target of this.byteTargets) {
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        target,
        0,
      );
      gl.drawArrays(gl.POINTS, 0, patchCount);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.rgbaProgram);
    gl.deleteProgram(this.byteProgram);
    gl.deleteFramebuffer(this.fbo);
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
  }
}
