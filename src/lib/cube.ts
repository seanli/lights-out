// The cube board: n×n lights on each of six faces, stored row-major in the cube's unfolded net (a vertical cross,
// three faces across and four down). A face's frame says where its cells sit in 3D, so the same frames decide which
// lights touch (round the cube's edges too) and how the play view folds the net into a cube. Pure, no DOM.
//
//        . U .        U up      L left    F front
//        L F R        R right   D down    B back (under D, upside down as the net folds)
//        . D .
//        . B .
//
// Coordinates are CSS's: x right, y down, z toward the viewer. For every face u × v = its outward normal, so a face
// drawn with u as "right" and v as "down" faces out of the cube (its front side shows; backface-visibility works).
import type { Shape } from '../contracts/entities';

export type Vec = readonly [number, number, number];
export type FaceId = 'up' | 'left' | 'front' | 'right' | 'down' | 'back';

export interface Face {
  id: FaceId;
  /** the face's block in the net: column and row, in faces */
  bx: number;
  by: number;
  /** outward normal, and the 3D directions of the face's columns (u) and rows (v) */
  n: Vec;
  u: Vec;
  v: Vec;
}

export const FACES: readonly Face[] = Object.freeze([
  { id: 'up', bx: 1, by: 0, n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { id: 'left', bx: 0, by: 1, n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { id: 'front', bx: 1, by: 1, n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { id: 'right', bx: 2, by: 1, n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { id: 'down', bx: 1, by: 2, n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { id: 'back', bx: 1, by: 3, n: [0, 0, -1], u: [1, 0, 0], v: [0, -1, 0] },
] as const satisfies readonly Face[]);

/** the net of an n×n-per-face cube as a shape (grid 'cube'): 3n wide, 4n tall, a vertical cross */
export function cubeShape(n: number): Shape {
  const cols = 3 * n, rows = 4 * n;
  const mask = new Array<boolean>(cols * rows).fill(false);
  for (const f of FACES) {
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) mask[(f.by * n + b) * cols + f.bx * n + a] = true;
  }
  return { cols, rows, mask, grid: 'cube' };
}

/** cells along a face's edge, from a cube net's size (0 when the grid can't be a cube net) */
export const cubeSide = (s: Pick<Shape, 'cols' | 'rows'>): number => (s.cols % 3 === 0 && s.rows === (s.cols / 3) * 4 ? s.cols / 3 : 0);

/** true when the shape is exactly the net cubeShape() makes */
export function isCubeNet(s: Shape): boolean {
  const n = cubeSide(s);
  if (!n || !s.mask) return false;
  const want = cubeShape(n).mask!;
  return s.mask.length === want.length && want.every((m, i) => m === s.mask![i]);
}

/** the face a net cell sits on and its column a / row b inside that face, or null for a gap */
export function cellFace(n: number, i: number): { face: Face; a: number; b: number } | null {
  const cols = 3 * n;
  const r = Math.floor(i / cols), c = i % cols;
  const bx = Math.floor(c / n), by = Math.floor(r / n);
  const face = FACES.find((f) => f.bx === bx && f.by === by);
  return face ? { face, a: c % n, b: r % n } : null;
}

/** the centre of a net cell's light on a cube of side n centred on the origin (one cell = 1) */
export function cellCentre(n: number, i: number): Vec | null {
  const at = cellFace(n, i);
  if (!at) return null;
  const { face: f, a, b } = at;
  const h = n / 2, x = a + 0.5 - h, y = b + 0.5 - h;
  return [f.n[0] * h + f.u[0] * x + f.v[0] * y, f.n[1] * h + f.u[1] * x + f.v[1] * y, f.n[2] * h + f.u[2] * x + f.v[2] * y];
}

/**
 * For every net position: the lights touching it (empty for gaps). Two lights touch when they share an edge:
 * on one face their centres are 1 apart; across the cube's edge they are √½ apart (the two faces of one corner piece).
 * Every light has exactly four.
 */
export function cubeNeighbours(n: number): number[][] {
  const size = 3 * n * 4 * n;
  const centres = Array.from({ length: size }, (_, i) => cellCentre(n, i));
  const out: number[][] = centres.map(() => []);
  for (let i = 0; i < size; i++) {
    const p = centres[i];
    if (!p) continue;
    for (let j = 0; j < size; j++) {
      const q = centres[j];
      if (!q || j === i) continue;
      const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
      if (Math.abs(d - 1) < 1e-9 || Math.abs(d - 0.5) < 1e-9) out[i]!.push(j);
    }
  }
  return out;
}

// ---- orientation: the cube turns freely; an orientation is a 3×3 rotation matrix (row-major), the view included ----

export type Mat = readonly [number, number, number, number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const mul = (a: Mat, b: Mat): Mat => {
  const o = new Array<number>(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
  return o as unknown as Mat;
};
export const apply = (m: Mat, p: Vec): Vec => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[3] * p[0] + m[4] * p[1] + m[5] * p[2], m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
];

/**
 * A turn by `angle` radians about a unit axis, in CSS's axes (x right, y down, z toward the viewer): the same turn as
 * CSS's rotate3d, so rotation([0, 1, 0], a) is rotateY(a), which takes the front toward the right.
 */
export function rotation([x, y, z]: Vec, angle: number): Mat {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    c + t * x * x, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, c + t * y * y, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, c + t * z * z,
  ];
}

const DEG = Math.PI / 180;
/** the starting view: tipped toward you and turned a little, so the front, the top and the right side show */
export const VIEW: Mat = mul(rotation([1, 0, 0], -30 * DEG), rotation([0, 1, 0], -35 * DEG));

/** the nearest true rotation (rows made unit length and square to each other), so many small turns never skew the cube */
export function orthonormal(m: Mat): Mat {
  const unit = (v: Vec): Vec => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const a = unit([m[0], m[1], m[2]]);
  const r1: Vec = [m[3], m[4], m[5]];
  const d = dot(a, r1);
  const b = unit([r1[0] - d * a[0], r1[1] - d * a[1], r1[2] - d * a[2]]);
  const c: Vec = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return [...a, ...b, ...c] as unknown as Mat;
}

/**
 * A drag of (dx, dy) px rolls the cube like a ball under the finger: it turns about the axis square to the drag, on
 * the screen, by `perPx` radians a pixel. Free: no axis is preferred and nothing snaps.
 */
export function rolled(m: Mat, dx: number, dy: number, perPx: number): Mat {
  const d = Math.hypot(dx, dy);
  if (!d) return m;
  return orthonormal(mul(rotation([-dy / d, dx / d, 0], d * perPx), m));
}

/**
 * A quarter turn about the screen's axes, pre-multiplied: 'left'/'right' about the vertical (left brings the right
 * face toward you), 'up'/'down' about the horizontal (up brings the bottom face toward you).
 */
export function turn(m: Mat, dir: 'left' | 'right' | 'up' | 'down'): Mat {
  const axis: Record<typeof dir, [Vec, number]> = {
    right: [[0, 1, 0], 90], left: [[0, 1, 0], -90], down: [[1, 0, 0], -90], up: [[1, 0, 0], 90],
  };
  const [v, deg] = axis[dir];
  return orthonormal(mul(rotation(v, deg * DEG), m));
}

/** the turn that brings a face square to the front (keeping the turn small) */
export function frontFace(face: FaceId): Mat {
  const path: Record<FaceId, Mat> = {
    front: IDENTITY,
    right: rotation([0, 1, 0], -90 * DEG),
    left: rotation([0, 1, 0], 90 * DEG),
    back: rotation([0, 1, 0], 180 * DEG),
    up: rotation([1, 0, 0], -90 * DEG),
    down: rotation([1, 0, 0], 90 * DEG),
  };
  return path[face];
}

/** the orientation that shows a face toward you, in the starting view's tilt (its neighbours above and right show too) */
export const facing = (face: FaceId): Mat => mul(VIEW, frontFace(face));

/** CSS matrix3d() for an orientation (column-major, no translation) */
export const cssMatrix = (m: Mat): string =>
  `matrix3d(${m[0]},${m[3]},${m[6]},0,${m[1]},${m[4]},${m[7]},0,${m[2]},${m[5]},${m[8]},0,0,0,0,1)`;

/** CSS matrix3d() placing a face: its columns along u, rows along v, facing n (translate out along n afterwards) */
export const faceMatrix = (f: Face): string =>
  `matrix3d(${f.u[0]},${f.u[1]},${f.u[2]},0,${f.v[0]},${f.v[1]},${f.v[2]},0,${f.n[0]},${f.n[1]},${f.n[2]},0,0,0,0,1)`;

/**
 * The faces that look toward you: a face shows when its turned normal points at you by more than `least` (the z of a
 * unit normal; 0.1 leaves out faces seen almost edge on, whose lights are too thin to tap).
 */
export function facesShowing(m: Mat, least = 0.1): FaceId[] {
  return FACES.filter((f) => apply(m, f.n)[2] > least).map((f) => f.id);
}
