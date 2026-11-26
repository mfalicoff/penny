// WebGL2 Gaussian splat renderer: no dependencies, one instanced draw per frame, one scene.
import type { Mat4 } from "./mat4.ts";
import type { Layout, PackedScene } from "./pack.ts";
import { fragmentShader, QUAD_EXTENT, vertexShader } from "./shaders.ts";

export interface Frame {
  readonly time: number;
  readonly model: Mat4;
  readonly view: Mat4;
  readonly proj: Mat4;
  readonly eye: readonly [number, number, number];
  readonly opacity: number;
  /**
   * Add the splats' light instead of compositing them back to front: for glowing scenes (the
   * ribbons), where it's smoother and needs no sorting.
   */
  readonly additive?: boolean;
}

const UNIFORMS = [
  "uCenters", "uCovA", "uCovB", "uColors", "uNormals", "uEye", "uTime", "uModel", "uView", "uProj", "uViewport", "uFocal", "uOpacity",
] as const;

export class SplatRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly vao: WebGLVertexArrayObject;
  private readonly indexBuffer: WebGLBuffer;
  private layout: Layout | undefined;

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
    return this.layout !== undefined;
  }

  get splatCount(): number {
    return this.layout?.count ?? 0;
  }

  upload(layout: Layout, scene: PackedScene): void {
    const { gl } = this;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const texture = (unit: number, internal: number, format: number, type: number, data: ArrayBufferView) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texStorage2D(gl.TEXTURE_2D, 1, internal, layout.width, layout.rows);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, layout.width, layout.rows, format, type, data);
    };
    texture(0, gl.RGBA32F, gl.RGBA, gl.FLOAT, scene.centers);
    texture(1, gl.RGBA32F, gl.RGBA, gl.FLOAT, scene.covA);
    texture(2, gl.RG32F, gl.RG, gl.FLOAT, scene.covB);
    texture(3, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, scene.colors);
    texture(4, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, scene.normals);
    this.layout = layout;
    this.setOrder(Uint32Array.from({ length: layout.count }, (_, i) => i));
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
    if (!layout || frame.opacity <= 0) return;

    gl.useProgram(this.program);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    if (frame.additive) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(u.uCenters, 0);
    gl.uniform1i(u.uCovA, 1);
    gl.uniform1i(u.uCovB, 2);
    gl.uniform1i(u.uColors, 3);
    gl.uniform1i(u.uNormals, 4);
    gl.uniform3f(u.uEye, frame.eye[0], frame.eye[1], frame.eye[2]);
    gl.uniform1f(u.uTime, frame.time);
    gl.uniform1f(u.uOpacity, frame.opacity);
    gl.uniformMatrix4fv(u.uModel, false, frame.model);
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
