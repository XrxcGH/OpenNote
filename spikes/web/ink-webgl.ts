// WebGL renderer for the ink spike: each new segment is a quad with a round joint, in one draw call.
import type { Renderer } from './ink-canvas';
import { fitCanvas } from './ink-canvas';
import { INK_COLOR, PAPER_COLOR, radiusAt, type InkPoint } from './ink-stroke';

const VERTEX_SHADER = `#version 300 es
in vec2 position;
uniform vec2 size;
void main() {
  vec2 clip = position / size * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform vec4 color;
out vec4 outColor;
void main() {
  outColor = color;
}`;

/** Triangles in each round joint. */
const JOINT_SIDES = 16;

/** Converts a #RRGGBB color to red, green, and blue from 0 to 1. */
export function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** Triangles for a disc of `radius` at a point, as x, y pairs. */
export function disc(point: InkPoint, radius: number): number[] {
  const vertices: number[] = [];
  for (let side = 0; side < JOINT_SIDES; side++) {
    const a = (side / JOINT_SIDES) * Math.PI * 2;
    const b = ((side + 1) / JOINT_SIDES) * Math.PI * 2;
    vertices.push(point.x, point.y);
    vertices.push(point.x + Math.cos(a) * radius, point.y + Math.sin(a) * radius);
    vertices.push(point.x + Math.cos(b) * radius, point.y + Math.sin(b) * radius);
  }
  return vertices;
}

/** Two triangles joining two points, as wide as the stroke at each end. */
export function segment(from: InkPoint, to: InkPoint): number[] {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return [];
  const [nx, ny] = [-(to.y - from.y) / length, (to.x - from.x) / length];
  const [r1, r2] = [radiusAt(from.pressure), radiusAt(to.pressure)];
  const a = [from.x + nx * r1, from.y + ny * r1];
  const b = [from.x - nx * r1, from.y - ny * r1];
  const c = [to.x + nx * r2, to.y + ny * r2];
  const d = [to.x - nx * r2, to.y - ny * r2];
  return [...a, ...b, ...c, ...b, ...d, ...c];
}

/** A WebGL 2 renderer. The drawing buffer is kept between frames, so each event draws only new ink. */
export class WebGlRenderer implements Renderer {
  readonly desynchronized: boolean;
  private readonly gl: WebGL2RenderingContext;
  private readonly buffer: WebGLBuffer;
  private readonly sizeUniform: WebGLUniformLocation | null;
  private last: InkPoint | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const options: WebGLContextAttributes = {
      desynchronized: true,
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: true,
    };
    const gl = canvas.getContext('webgl2', options);
    if (!gl) throw new Error('This browser has no WebGL 2.');
    this.gl = gl;
    this.desynchronized = gl.getContextAttributes()?.desynchronized === true;
    const program = link(gl);
    gl.useProgram(program);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    this.sizeUniform = gl.getUniformLocation(program, 'size');
    gl.uniform4f(gl.getUniformLocation(program, 'color'), ...rgb(INK_COLOR), 1);
    this.resize();
  }

  start(point: InkPoint): void {
    this.last = point;
    this.draw(disc(point, radiusAt(point.pressure)));
  }

  extend(points: readonly InkPoint[]): void {
    const vertices: number[] = [];
    for (const point of points) {
      if (this.last) vertices.push(...segment(this.last, point));
      vertices.push(...disc(point, radiusAt(point.pressure)));
      this.last = point;
    }
    this.draw(vertices);
  }

  preview(): void {}

  settle(): void {}

  clear(): void {
    const { gl } = this;
    this.last = null;
    gl.clearColor(...rgb(PAPER_COLOR), 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  resize(): void {
    fitCanvas(this.canvas);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.uniform2f(this.sizeUniform, window.innerWidth, window.innerHeight);
    this.clear();
  }

  private draw(vertices: number[]): void {
    if (vertices.length === 0) return;
    const { gl } = this;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
  }
}

function link(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`The ink shaders didn't link: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL could not create a shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`An ink shader didn't compile: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}
