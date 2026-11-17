// WebGL2 Gaussian splat renderer: no dependencies, one instanced draw per frame.
import type { Mat4 } from "./mat4.ts";
import type { Layout, PackedScene } from "./pack.ts";
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
  readonly eye: readonly [number, number, number];
  readonly opacity: number;
}

const UNIFORMS = [
  "uCenters", "uCovA", "uCovB", "uColors", "uNormals", "uEye", "uRows", "uFrom", "uTo", "uT", "uTime",
  "uModelA", "uModelB", "uView", "uProj", "uViewport", "uFocal", "uOpacity",
] as const;

interface Texture {
  readonly texture: WebGLTexture;
  readonly unit: number;
  readonly format: number;
  readonly type: number;
}

export class SplatRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly vao: WebGLVertexArrayObject;
  private readonly indexBuffer: WebGLBuffer;
  private layout: Layout | undefined;
  private textures: Record<"centers" | "covA" | "covB" | "colors" | "normals", Texture> | undefined;
  private readonly loaded = new Set<number>();

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

  /** Number of scenes, from the first, that are uploaded and can be drawn. */
  get readyScenes(): number {
    let n = 0;
    while (this.loaded.has(n)) n++;
    return n;
  }

  get splatCount(): number {
    return this.layout?.count ?? 0;
  }

  /** Allocates every texture for `layout`; scenes are uploaded into it as they arrive. */
  allocate(layout: Layout): void {
    const { gl } = this;
    const height = layout.rows * layout.sceneCount;
    const make = (unit: number, internal: number, format: number, type: number): Texture => {
      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texStorage2D(gl.TEXTURE_2D, 1, internal, layout.width, height);
      return { texture, unit, format, type };
    };
    this.textures = {
      centers: make(0, gl.RGBA32F, gl.RGBA, gl.FLOAT),
      covA: make(1, gl.RGBA32F, gl.RGBA, gl.FLOAT),
      covB: make(2, gl.RG32F, gl.RG, gl.FLOAT),
      colors: make(3, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE),
      normals: make(4, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE),
    };
    this.layout = layout;
    this.setOrder(Uint32Array.from({ length: layout.count }, (_, i) => i));
  }

  upload(scene: PackedScene): void {
    const { gl, layout, textures } = this;
    if (!layout || !textures) throw new Error("allocate() before upload()");
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const put = (t: Texture, data: ArrayBufferView) => {
      gl.activeTexture(gl.TEXTURE0 + t.unit);
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, scene.index * layout.rows, layout.width, layout.rows, t.format, t.type, data);
    };
    put(textures.centers, scene.centers);
    put(textures.covA, scene.covA);
    put(textures.covB, scene.covB);
    put(textures.colors, scene.colors);
    put(textures.normals, scene.normals);
    this.loaded.add(scene.index);
  }

  setOrder(order: Uint32Array): void {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, order, gl.DYNAMIC_DRAW);
  }

  render(frame: Frame): void {
    const { gl, layout, uniforms: u } = this;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!layout || frame.opacity <= 0 || !this.loaded.has(frame.from) || !this.loaded.has(frame.to)) return;

    gl.useProgram(this.program);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(u.uCenters, 0);
    gl.uniform1i(u.uCovA, 1);
    gl.uniform1i(u.uCovB, 2);
    gl.uniform1i(u.uColors, 3);
    gl.uniform1i(u.uNormals, 4);
    gl.uniform3f(u.uEye, frame.eye[0], frame.eye[1], frame.eye[2]);
    gl.uniform1i(u.uRows, layout.rows);
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
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, layout.count);
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
