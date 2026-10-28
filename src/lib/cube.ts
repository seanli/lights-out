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

// ---- orientation: the cube turns in quarter turns; an orientation is a 3×3 rotation matrix (row-major, integers) ----

export type Mat = readonly [number, number, number, number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const mul = (a: Mat, b: Mat): Mat => {
  const o = new Array<number>(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
  return o as unknown as Mat;
};
export const apply = (m: Mat, p: Vec): Vec => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[3] * p[0] + m[4] * p[1] + m[5] * p[2], m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
];

/**
 * A quarter turn in the world (before the view's fixed tilt), pre-multiplied: 'left'/'right' spin about the vertical
 * axis (a swipe left brings the right face to the front), 'up'/'down' tip about the horizontal axis (a swipe up brings
 * the bottom face to the front).
 */
export function turn(m: Mat, dir: 'left' | 'right' | 'up' | 'down'): Mat {
  // CSS axes (y down): rotating +90° about y takes +z (front) to +x (right)
  const R: Record<typeof dir, Mat> = {
    right: [0, 0, 1, 0, 1, 0, -1, 0, 0], // front → right: the left face comes to the front
    left: [0, 0, -1, 0, 1, 0, 1, 0, 0], // front → left: the right face comes to the front
    up: [1, 0, 0, 0, 0, -1, 0, 1, 0], // front → up: the bottom face comes to the front
    down: [1, 0, 0, 0, 0, 1, 0, -1, 0], // front → down: the top face comes to the front
  };
  return mul(R[dir], m);
}

/** the orientation that brings a face to the front, keeping the turn small (used to show a hinted light) */
export function frontFace(face: FaceId): Mat {
  let m = IDENTITY;
  const path: Record<FaceId, ('left' | 'right' | 'up' | 'down')[]> = {
    front: [], right: ['left'], left: ['right'], back: ['left', 'left'], up: ['down'], down: ['up'],
  };
  for (const d of path[face]) m = turn(m, d);
  return m;
}

/** CSS matrix3d() for an orientation (column-major, no translation) */
export const cssMatrix = (m: Mat): string =>
  `matrix3d(${m[0]},${m[3]},${m[6]},0,${m[1]},${m[4]},${m[7]},0,${m[2]},${m[5]},${m[8]},0,0,0,0,1)`;

/** CSS matrix3d() placing a face: its columns along u, rows along v, facing n (translate out along n afterwards) */
export const faceMatrix = (f: Face): string =>
  `matrix3d(${f.u[0]},${f.u[1]},${f.u[2]},0,${f.v[0]},${f.v[1]},${f.v[2]},0,${f.n[0]},${f.n[1]},${f.n[2]},0,0,0,0,1)`;

/**
 * Which faces point at the viewer for an orientation under the view's tilt (a rotation: x tilt then y spin, degrees).
 * A face shows when its turned normal has a positive z after the tilt.
 */
export function facesShowing(m: Mat, tiltX: number, spinY: number): FaceId[] {
  const rx = (tiltX * Math.PI) / 180, ry = (spinY * Math.PI) / 180;
  return FACES.filter((f) => {
    let [x, y, z] = apply(m, f.n);
    // rotateY(spinY) then rotateX(tiltX) as CSS applies "rotateX() rotateY() matrix" right to left
    const x1 = x * Math.cos(ry) + z * Math.sin(ry);
    const z1 = -x * Math.sin(ry) + z * Math.cos(ry);
    [x, z] = [x1, z1];
    const z2 = y * Math.sin(rx) + z * Math.cos(rx);
    return z2 > 1e-6;
  }).map((f) => f.id);
}
