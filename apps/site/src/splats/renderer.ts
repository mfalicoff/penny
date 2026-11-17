// WebGL2 Gaussian splat renderer: no dependencies, one instanced draw per frame.
import type { Mat4 } from "./mat4.ts";
import type { PackedScenes } from "./pack.ts";
import { fragmentShader, QUAD_EXTENT, vertexShader } from "./shaders.ts";

export interface Frame {
  readonly from: number;
  readonly to: number;
  readonly t: number;
  readonly time: number;
  readonly modelA: Mat4;
  readonly modelB: Mat4;
  readonly view: Mat4;
  readonly proj: Mat4;
  readonly opacity: number;
}

const UNIFORMS = [
  "uCenters", "uCovA", "uCovB", "uColors", "uRows", "uFrom", "uTo", "uT", "uTime",
  "uModelA", "uModelB", "uView", "uProj", "uViewport", "uFocal", "uOpacity",
] as const;

export class SplatRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly vao: WebGLVertexArrayObject;
  private readonly indexBuffer: WebGLBuffer;
  private packed: PackedScenes | undefined;

  static create(canvas: HTMLCanvasElement): SplatRenderer | undefined {
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true, alpha: true, powerPreference: "high-performance" });
    return gl ? new SplatRenderer(gl) : undefined;
  }

  private constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = link(gl, vertexShader, fragmentShader);
    this.uniforms = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(this.program, name)])) as SplatRenderer["uniforms"];

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const k = QUAD_EXTENT;
    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-k, -k, k, -k, -k, k, k, k]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
  }

  get ready(): boolean {
    return this.packed !== undefined;
  }

  upload(packed: PackedScenes): void {
    const { gl } = this;
    const height = packed.rows * packed.sceneCount;
    const texture = (unit: number, internal: number, format: number, type: number, data: ArrayBufferView) => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, packed.width, height, 0, format, type, data);
    };
    texture(0, gl.RGBA32F, gl.RGBA, gl.FLOAT, packed.centers);
    texture(1, gl.RGBA32F, gl.RGBA, gl.FLOAT, packed.covA);
    texture(2, gl.RG32F, gl.RG, gl.FLOAT, packed.covB);
    texture(3, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, packed.colors);
    this.setOrder(Uint32Array.from({ length: packed.count }, (_, i) => i));
    this.packed = packed;
  }

  setOrder(order: Uint32Array): void {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, order, gl.DYNAMIC_DRAW);
  }

  render(frame: Frame): void {
    const { gl, packed, uniforms: u } = this;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!packed || frame.opacity <= 0) return;

    gl.useProgram(this.program);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(u.uCenters, 0);
    gl.uniform1i(u.uCovA, 1);
    gl.uniform1i(u.uCovB, 2);
    gl.uniform1i(u.uColors, 3);
    gl.uniform1i(u.uRows, packed.rows);
    gl.uniform1i(u.uFrom, frame.from);
    gl.uniform1i(u.uTo, frame.to);
    gl.uniform1f(u.uT, frame.t);
    gl.uniform1f(u.uTime, frame.time);
    gl.uniform1f(u.uOpacity, frame.opacity);
    gl.uniformMatrix4fv(u.uModelA, false, frame.modelA);
    gl.uniformMatrix4fv(u.uModelB, false, frame.modelB);
    gl.uniformMatrix4fv(u.uView, false, frame.view);
    gl.uniformMatrix4fv(u.uProj, false, frame.proj);
    gl.uniform2f(u.uViewport, width, height);
    gl.uniform2f(u.uFocal, (frame.proj[0]! * width) / 2, (frame.proj[5]! * height) / 2);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, packed.count);
    gl.bindVertexArray(null);
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "Shader compile failed");
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "Program link failed");
  }
  return program;
}
