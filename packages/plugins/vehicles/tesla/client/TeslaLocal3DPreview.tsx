import { useEffect, useRef, useState } from "react";
import styles from "./TeslaVehicleVisualDev.module.css";

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];

type MeshData = {
  positions: number[];
  normals: number[];
};

type Triangle = {
  points: readonly [Vec3, Vec3, Vec3];
  normal: Vec3;
};

type RenderStats = {
  backend: string;
  triangles: number;
  renderMs: number;
};

type GpuMesh = {
  positionBuffer: WebGLBuffer;
  normalBuffer: WebGLBuffer;
  vertices: number;
  color: Vec3;
};

const BODY_PROFILE: readonly Vec2[] = [
  [-2.2, -0.38],
  [-2.14, 0.02],
  [-1.72, 0.28],
  [-1.1, 0.48],
  [-0.55, 0.95],
  [0.52, 1.02],
  [1.2, 0.62],
  [1.86, 0.39],
  [2.18, 0.08],
  [2.22, -0.38],
];

const GLASS_PROFILE: readonly Vec2[] = [
  [-0.52, 0.61],
  [-0.2, 0.92],
  [0.13, 1.12],
  [0.55, 1.1],
  [1.07, 0.73],
  [0.86, 0.6],
];

const PAINT_COLORS: Record<string, Vec3> = {
  deepblue: [0.025, 0.12, 0.36],
  deepbluemetallic: [0.025, 0.12, 0.36],
  midnightcherryred: [0.34, 0.015, 0.045],
  midnightsilver: [0.19, 0.21, 0.24],
  midnightsilvermetallic: [0.19, 0.21, 0.24],
  pearlwhite: [0.87, 0.89, 0.91],
  pearlwhitemulticoat: [0.87, 0.89, 0.91],
  quicksilver: [0.48, 0.53, 0.58],
  redmulticoat: [0.58, 0.015, 0.025],
  solidblack: [0.025, 0.028, 0.034],
  stealthgray: [0.14, 0.16, 0.18],
  stealthgrey: [0.14, 0.16, 0.18],
  ultrared: [0.72, 0.018, 0.03],
};

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform float uYaw;
uniform float uPitch;
uniform float uAspect;
varying float vLight;

void main() {
  float cy = cos(uYaw);
  float sy = sin(uYaw);
  float cp = cos(uPitch);
  float sp = sin(uPitch);
  mat3 rotateY = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
  mat3 rotateX = mat3(1.0, 0.0, 0.0, 0.0, cp, sp, 0.0, -sp, cp);
  vec3 position = rotateX * rotateY * aPosition;
  vec3 normal = normalize(rotateX * rotateY * aNormal);
  float depth = 6.1 - position.z;
  vec2 projected = vec2(position.x / uAspect, position.y - 0.12) * (2.5 / depth);
  gl_Position = vec4(projected, -position.z / 4.0, 1.0);
  vec3 lightDirection = normalize(vec3(-0.45, 0.85, 0.62));
  vLight = 0.34 + max(dot(normal, lightDirection), 0.0) * 0.66;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 uColor;
varying float vLight;

void main() {
  vec3 color = uColor * (0.62 + vLight * 0.62);
  gl_FragColor = vec4(color, 1.0);
}
`;

function vec3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

function normalizeColorName(value?: string | null): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function paintColor(value?: string | null): Vec3 {
  return PAINT_COLORS[normalizeColorName(value)] ?? [0.04, 0.34, 0.78];
}

function triangle(a: Vec3, b: Vec3, c: Vec3, normal: Vec3): Triangle {
  return { points: [a, b, c], normal };
}

function normalizeVector([x, y, z]: Vec3): Vec3 {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function trianglesToMesh(items: readonly Triangle[]): MeshData {
  return {
    positions: items.flatMap((item) =>
      item.points.flatMap((point) => [...point])
    ),
    normals: items.flatMap((item) => [
      ...item.normal,
      ...item.normal,
      ...item.normal,
    ]),
  };
}

function extrudedProfile(
  profile: readonly Vec2[],
  halfWidth: number,
): MeshData {
  if (profile.length < 3) return { positions: [], normals: [] };
  const front = profile.map(([x, y]) => vec3(x, y, halfWidth));
  const back = profile.map(([x, y]) => vec3(x, y, -halfWidth));
  const faceCount = profile.length - 2;
  const frontFaces = Array.from(
    { length: faceCount },
    (_, index) =>
      triangle(front[0], front[index + 1], front[index + 2], vec3(0, 0, 1)),
  );
  const backFaces = Array.from(
    { length: faceCount },
    (_, index) =>
      triangle(back[0], back[index + 2], back[index + 1], vec3(0, 0, -1)),
  );
  const sideFaces = profile.flatMap((point, index) => {
    const next = profile[(index + 1) % profile.length];
    const a = vec3(point[0], point[1], halfWidth);
    const b = vec3(next[0], next[1], halfWidth);
    const c = vec3(point[0], point[1], -halfWidth);
    const d = vec3(next[0], next[1], -halfWidth);
    const normal = normalizeVector(
      vec3(next[1] - point[1], point[0] - next[0], 0),
    );
    return [triangle(a, c, b, normal), triangle(b, c, d, normal)];
  });
  return trianglesToMesh([...frontFaces, ...backFaces, ...sideFaces]);
}

function cylinderPoint(
  center: Vec3,
  radius: number,
  angle: number,
  zOffset: number,
): Vec3 {
  return vec3(
    center[0] + Math.cos(angle) * radius,
    center[1] + Math.sin(angle) * radius,
    center[2] + zOffset,
  );
}

function cylinderMesh(
  center: Vec3,
  radius: number,
  halfDepth: number,
): MeshData {
  const segments = 18;
  const parts = Array.from({ length: segments }, (_, index) => {
    const a0 = index / segments * Math.PI * 2;
    const a1 = (index + 1) / segments * Math.PI * 2;
    const p0f = cylinderPoint(center, radius, a0, halfDepth);
    const p1f = cylinderPoint(center, radius, a1, halfDepth);
    const p0b = cylinderPoint(center, radius, a0, -halfDepth);
    const p1b = cylinderPoint(center, radius, a1, -halfDepth);
    const sideNormal = normalizeVector(
      vec3(Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2), 0),
    );
    const frontCenter = vec3(center[0], center[1], center[2] + halfDepth);
    const backCenter = vec3(center[0], center[1], center[2] - halfDepth);
    return [
      triangle(p0f, p0b, p1f, sideNormal),
      triangle(p1f, p0b, p1b, sideNormal),
      triangle(frontCenter, p1f, p0f, vec3(0, 0, 1)),
      triangle(backCenter, p0b, p1b, vec3(0, 0, -1)),
    ];
  });
  return trianglesToMesh(parts.flat());
}

function mergeMeshes(meshes: readonly MeshData[]): MeshData {
  return {
    positions: meshes.flatMap((mesh) => mesh.positions),
    normals: meshes.flatMap((mesh) => mesh.normals),
  };
}

function wheelMeshes(radius: number, depth: number, z: number): MeshData[] {
  return [-1.45, 1.45].map((x) =>
    cylinderMesh(vec3(x, -0.34, z), radius, depth)
  );
}

function createCarMeshes(bodyColor: Vec3): readonly [MeshData, Vec3][] {
  const wheels = mergeMeshes([
    ...wheelMeshes(0.39, 0.15, 0.82),
    ...wheelMeshes(0.39, 0.15, -0.82),
  ]);
  const rims = mergeMeshes([
    ...wheelMeshes(0.22, 0.025, 0.985),
    ...wheelMeshes(0.22, 0.025, -0.985),
  ]);
  return [
    [extrudedProfile(BODY_PROFILE, 0.82), bodyColor],
    [extrudedProfile(GLASS_PROFILE, 0.835), [0.025, 0.055, 0.09]],
    [wheels, [0.018, 0.02, 0.024]],
    [rims, [0.42, 0.46, 0.52]],
  ];
}

function createShader(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create WebGL shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  const message = gl.getShaderInfoLog(shader) ??
    "WebGL shader compilation failed";
  gl.deleteShader(shader);
  throw new Error(message);
}

function createProgram(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): WebGLProgram {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to create WebGL program");
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  const message = gl.getProgramInfoLog(program) ?? "WebGL program link failed";
  gl.deleteProgram(program);
  throw new Error(message);
}

function uploadMesh(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  data: MeshData,
  color: Vec3,
): GpuMesh {
  const positionBuffer = gl.createBuffer();
  const normalBuffer = gl.createBuffer();
  if (!positionBuffer || !normalBuffer) {
    throw new Error("Unable to allocate WebGL buffers");
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array(data.positions),
    gl.STATIC_DRAW,
  );
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array(data.normals),
    gl.STATIC_DRAW,
  );
  return {
    positionBuffer,
    normalBuffer,
    vertices: data.positions.length / 3,
    color,
  };
}

function getLocation(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
) {
  const location = gl.getUniformLocation(program, name);
  if (!location) throw new Error(`Missing WebGL uniform ${name}`);
  return location;
}

class LocalCarRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext | WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly meshes: readonly GpuMesh[];
  private readonly positionLocation: number;
  private readonly normalLocation: number;
  private readonly yawLocation: WebGLUniformLocation;
  private readonly pitchLocation: WebGLUniformLocation;
  private readonly aspectLocation: WebGLUniformLocation;
  private readonly colorLocation: WebGLUniformLocation;
  private readonly onStats: (stats: RenderStats) => void;
  private yaw = -0.58;
  private pitch = -0.12;
  private pointer = { active: false, x: 0, y: 0 };

  constructor(
    canvas: HTMLCanvasElement,
    color: Vec3,
    onStats: (stats: RenderStats) => void,
  ) {
    const options: WebGLContextAttributes = {
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    };
    const gl = canvas.getContext("webgl2", options) ??
      canvas.getContext("webgl", options);
    if (!gl) throw new Error("WebGL is not available in this browser");
    const program = createProgram(gl);
    const positionLocation = gl.getAttribLocation(program, "aPosition");
    const normalLocation = gl.getAttribLocation(program, "aNormal");
    if (positionLocation < 0 || normalLocation < 0) {
      throw new Error("Missing WebGL vertex attributes");
    }
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    this.positionLocation = positionLocation;
    this.normalLocation = normalLocation;
    this.yawLocation = getLocation(gl, program, "uYaw");
    this.pitchLocation = getLocation(gl, program, "uPitch");
    this.aspectLocation = getLocation(gl, program, "uAspect");
    this.colorLocation = getLocation(gl, program, "uColor");
    this.meshes = createCarMeshes(color).map(([mesh, meshColor]) =>
      uploadMesh(gl, mesh, meshColor)
    );
    this.onStats = onStats;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0, 0, 0, 0);
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(bounds.width * pixelRatio));
    const height = Math.max(1, Math.round(bounds.height * pixelRatio));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
    this.render(width / height);
  }

  pointerDown(x: number, y: number) {
    this.pointer = { active: true, x, y };
  }

  pointerMove(x: number, y: number) {
    if (!this.pointer.active) return;
    const deltaX = x - this.pointer.x;
    const deltaY = y - this.pointer.y;
    this.pointer = { active: true, x, y };
    this.yaw += deltaX * 0.012;
    this.pitch = Math.max(
      -0.38,
      Math.min(0.22, this.pitch + deltaY * 0.006),
    );
    this.render(this.canvas.width / this.canvas.height);
  }

  pointerUp() {
    this.pointer = { ...this.pointer, active: false };
  }

  render(aspect: number) {
    const startedAt = performance.now();
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform1f(this.yawLocation, this.yaw);
    gl.uniform1f(this.pitchLocation, this.pitch);
    gl.uniform1f(this.aspectLocation, Math.max(0.1, aspect));
    this.meshes.forEach((mesh) => this.draw(mesh));
    const triangles = this.meshes.reduce(
      (total, mesh) => total + mesh.vertices / 3,
      0,
    );
    const webgl2 = typeof WebGL2RenderingContext !== "undefined" &&
      gl instanceof WebGL2RenderingContext;
    this.onStats({
      backend: webgl2 ? "WebGL 2" : "WebGL 1",
      triangles,
      renderMs: performance.now() - startedAt,
    });
  }

  dispose() {
    this.meshes.forEach((mesh) => {
      this.gl.deleteBuffer(mesh.positionBuffer);
      this.gl.deleteBuffer(mesh.normalBuffer);
    });
    this.gl.deleteProgram(this.program);
  }

  private draw(mesh: GpuMesh) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.positionBuffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(
      this.positionLocation,
      3,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normalBuffer);
    gl.enableVertexAttribArray(this.normalLocation);
    gl.vertexAttribPointer(this.normalLocation, 3, gl.FLOAT, false, 0, 0);
    gl.uniform3f(
      this.colorLocation,
      mesh.color[0],
      mesh.color[1],
      mesh.color[2],
    );
    gl.drawArrays(gl.TRIANGLES, 0, mesh.vertices);
  }
}

function bindRenderer(canvas: HTMLCanvasElement, renderer: LocalCarRenderer) {
  const pointerDown = (event: PointerEvent) => {
    canvas.setPointerCapture(event.pointerId);
    renderer.pointerDown(event.clientX, event.clientY);
  };
  const pointerMove = (event: PointerEvent) =>
    renderer.pointerMove(event.clientX, event.clientY);
  const pointerUp = () => renderer.pointerUp();
  const resizeObserver = new ResizeObserver(() => renderer.resize());
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerUp);
  resizeObserver.observe(canvas);
  renderer.resize();
  return () => {
    resizeObserver.disconnect();
    canvas.removeEventListener("pointerdown", pointerDown);
    canvas.removeEventListener("pointermove", pointerMove);
    canvas.removeEventListener("pointerup", pointerUp);
    canvas.removeEventListener("pointercancel", pointerUp);
    renderer.dispose();
  };
}

export function TeslaLocal3DPreview(
  { exteriorColor, model }: {
    exteriorColor?: string | null;
    model: string;
  },
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<RenderStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const renderer = new LocalCarRenderer(
        canvas,
        paintColor(exteriorColor),
        setStats,
      );
      return bindRenderer(canvas, renderer);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Local 3D renderer failed",
      );
    }
  }, [exteriorColor]);

  return (
    <div className={styles.local3d}>
      <canvas
        ref={canvasRef}
        className={styles.local3dCanvas}
        aria-label={`${model} local 3D preview`}
      />
      <div className={styles.local3dTopline}>
        <span>LOCAL 3D ENGINE TEST</span>
        <span>{exteriorColor ?? "Default blue"}</span>
      </div>
      <div className={styles.local3dFooter}>
        <span>Drag to rotate</span>
        {stats && (
          <span>
            {stats.backend} · {Math.round(stats.triangles)} triangles ·{" "}
            {stats.renderMs.toFixed(2)} ms
          </span>
        )}
      </div>
      {error && <div className={styles.local3dError}>{error}</div>}
    </div>
  );
}
