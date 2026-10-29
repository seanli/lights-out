// Symmetries of a board: the mirrors and turns that carry a shape onto itself (cells onto cells, gaps onto gaps,
// stuck onto stuck, each switch's wiring onto the matching wiring), on square grids, honeycombs and cubes. Levels use
// them to make patterns that look designed: presses chosen in whole orbits give a board with the same symmetry. Pure.
import type { Shape } from '../contracts';
import { cellCentre, cubeSide, FACES, type Vec } from './cube';
import { cellIndexes, gridOf, gridSize, isCell, isStuck, WIRE_DIRS } from './shape';

/**
 * mirror: left–right · flip: top–bottom · turn: a half turn (a cube: about its upright axis) · both: mirror and flip ·
 * diagonal: across the main diagonal (a cube: front and right swap) · third: turns by 120° with their mirrors (a
 * honeycomb about its centre, a cube about a corner) · full: every turn and mirror the board has.
 * Turns finer than a half turn always come with mirrors: turns alone make pinwheels (see isPinwheel).
 */
export type SymmetryName = 'mirror' | 'flip' | 'turn' | 'both' | 'diagonal' | 'third' | 'full';
export const SYMMETRY_NAMES: readonly SymmetryName[] = ['mirror', 'flip', 'turn', 'both', 'diagonal', 'third', 'full'];

export interface Symmetry {
  name: SymmetryName;
  /** one map per element of the group (the identity first): grid index → grid index */
  maps: readonly (readonly number[])[];
  /** per element, how a switch's wiring bits turn with it (square grids; null on a honeycomb or a cube) */
  wires: readonly ((bits: number) => number)[] | null;
}

/** a linear map of (row, column) offsets from the centre: (r, c) → (a·r + b·c, c·r + d·c) */
type Lin = readonly [number, number, number, number];
const I: Lin = [1, 0, 0, 1], MIRROR: Lin = [1, 0, 0, -1], FLIP: Lin = [-1, 0, 0, 1], TURN: Lin = [-1, 0, 0, -1];
const DIAG: Lin = [0, 1, 1, 0], ANTI: Lin = [0, -1, -1, 0], CW: Lin = [0, 1, -1, 0], CCW: Lin = [0, -1, 1, 0];
const SQUARE: Partial<Record<SymmetryName, readonly Lin[]>> = {
  mirror: [I, MIRROR],
  flip: [I, FLIP],
  turn: [I, TURN],
  both: [I, MIRROR, FLIP, TURN],
  diagonal: [I, DIAG],
  full: [I, CW, TURN, CCW, MIRROR, FLIP, DIAG, ANTI],
};
const apply = ([a, b, c, d]: Lin, r: number, k: number): [number, number] => [a * r + b * k, c * r + d * k];

/** a switch's wiring bits after the map: each direction turns with it */
function turnBits(lin: Lin): (bits: number) => number {
  return (bits) => {
    let out = 0;
    WIRE_DIRS.forEach(([dr, dc], k) => {
      if (!(bits & (1 << k))) return;
      const [r, c] = apply(lin, dr, dc);
      out |= 1 << WIRE_DIRS.findIndex(([x, y]) => x === r && y === c);
    });
    return out;
  };
}

function squareMaps(s: Shape, lins: readonly Lin[]): number[][] {
  // doubled offsets from the centre, so a centre between cells stays whole
  return lins.map((lin) => Array.from({ length: gridSize(s) }, (_, i) => {
    const R = 2 * Math.floor(i / s.cols) - (s.rows - 1), C = 2 * (i % s.cols) - (s.cols - 1);
    const [r2, c2] = apply(lin, R, C);
    const r = (r2 + s.rows - 1) / 2, c = (c2 + s.cols - 1) / 2;
    return r >= 0 && r < s.rows && c >= 0 && c < s.cols && Number.isInteger(r) && Number.isInteger(c) ? r * s.cols + c : -1;
  }));
}

/** cube coordinates (q, r, s) of a honeycomb cell (odd rows half a cell right: lib/shape.ts hexagonShape) */
const toCube = (s: Shape, i: number): [number, number, number] => {
  const row = Math.floor(i / s.cols), col = i % s.cols;
  const q = col - (row - (row & 1)) / 2;
  return [q, row, -q - row];
};
const fromCube = (s: Shape, [q, row]: readonly number[]): number => {
  const col = q! + (row! - (row! & 1)) / 2;
  return row! >= 0 && row! < s.rows && col >= 0 && col < s.cols ? row! * s.cols + col : -1;
};
type Cube = (v: readonly [number, number, number]) => [number, number, number];
const H_ID: Cube = (v) => [...v];
const H_TURN60: Cube = ([q, r, s]) => [-r, -s, -q];
const H_MIRROR: Cube = ([q, r, s]) => [s, r, q];
const H_FLIP: Cube = ([q, r, s]) => [-s, -r, -q];
const turns = (k: number): Cube => (v) => { let x: [number, number, number] = [...v]; for (let t = 0; t < k; t++) x = H_TURN60(x); return x; };
const HEX: Partial<Record<SymmetryName, readonly Cube[]>> = {
  mirror: [H_ID, H_MIRROR],
  flip: [H_ID, H_FLIP],
  turn: [H_ID, turns(3)],
  both: [H_ID, H_MIRROR, H_FLIP, turns(3)],
  third: [0, 2, 4].flatMap((k) => [turns(k), (v: readonly [number, number, number]) => H_MIRROR(turns(k)(v))]),
  full: [0, 1, 2, 3, 4, 5].flatMap((k) => [turns(k), (v: readonly [number, number, number]) => H_MIRROR(turns(k)(v))]),
};

function hexMaps(s: Shape, group: readonly Cube[]): number[][] | null {
  // turn about the real cell nearest the middle of all of them
  const cells = cellIndexes(s);
  const cubes = cells.map((i) => toCube(s, i));
  const mid = [0, 1, 2].map((k) => cubes.reduce((a, v) => a + v[k]!, 0) / cubes.length);
  let centre = cubes[0]!, best = Infinity;
  for (const v of cubes) {
    const d = Math.max(...v.map((x, k) => Math.abs(x - mid[k]!)));
    if (d < best - 1e-9) { best = d; centre = v; }
  }
  return group.map((f) => Array.from({ length: gridSize(s) }, (_, i) => {
    const v = toCube(s, i);
    const t = f([v[0] - centre[0], v[1] - centre[1], v[2] - centre[2]]);
    return fromCube(s, [t[0] + centre[0], t[1] + centre[1]]);
  }));
}

/** a cube's mirrors and turns as maps of 3D points (CSS axes: x right, y down, z toward the viewer) */
type Space = (p: Vec) => Vec;
const PERMS: readonly (readonly [number, number, number])[] = [[0, 1, 2], [1, 2, 0], [2, 0, 1], [1, 0, 2], [0, 2, 1], [2, 1, 0]];
const permute = ([a, b, c]: readonly number[], sx = 1, sy = 1, sz = 1): Space => (p) => [sx * p[a!]!, sy * p[b!]!, sz * p[c!]!];
const SIGNS = [1, -1].flatMap((x) => [1, -1].flatMap((y) => [1, -1].map((z) => [x, y, z] as const)));
const CUBE: Partial<Record<SymmetryName, readonly Space[]>> = {
  mirror: [permute([0, 1, 2]), permute([0, 1, 2], -1)],
  flip: [permute([0, 1, 2]), permute([0, 1, 2], 1, -1)],
  turn: [permute([0, 1, 2]), permute([0, 1, 2], -1, 1, -1)],
  both: [permute([0, 1, 2]), permute([0, 1, 2], -1), permute([0, 1, 2], 1, -1), permute([0, 1, 2], -1, -1)],
  diagonal: [permute([0, 1, 2]), permute([2, 1, 0])],
  third: PERMS.map((p) => permute(p)),
  full: PERMS.flatMap((p) => SIGNS.map(([x, y, z]) => permute(p, x, y, z))),
};

function cubeMaps(s: Shape, group: readonly Space[]): number[][] {
  const n = cubeSide(s);
  // light centres are on a half grid: doubled, they key exactly
  const key = (p: Vec) => p.map((x) => Math.round(2 * x)).join(',');
  const at = new Map<string, number>();
  const centres = Array.from({ length: gridSize(s) }, (_, i) => cellCentre(n, i));
  centres.forEach((p, i) => { if (p) at.set(key(p), i); });
  return group.map((f) => centres.map((p) => (p ? at.get(key(f(p))) ?? -1 : -1)));
}

/** a group's maps over a grid's geometry (cells and gaps; stuck cells and wiring aside), or null when a cell would land off the board */
type Geometry = { maps: number[][]; wires: Symmetry['wires'] } | null;
const geometries = new Map<string, Geometry>();

function geometry(s: Shape, name: SymmetryName): Geometry {
  const grid = gridOf(s);
  const key = `${grid} ${s.cols}x${s.rows} ${s.mask ? s.mask.map((m) => (m ? 1 : 0)).join('') : ''} ${name}`;
  if (geometries.has(key)) return geometries.get(key)!;
  let geo: Geometry = null;
  if (grid === 'square' && SQUARE[name]) geo = { maps: squareMaps(s, SQUARE[name]), wires: SQUARE[name].map(turnBits) };
  else if (grid === 'hex' && HEX[name]) geo = { maps: hexMaps(s, HEX[name])!, wires: null };
  else if (grid === 'cube' && CUBE[name] && cubeSide(s)) geo = { maps: cubeMaps(s, CUBE[name]), wires: null };
  if (geo && !cellIndexes(s).every((i) => geo!.maps.every((m) => isCell(s, m[i]!)))) geo = null;
  // custom boards come and go: keep the cache small
  if (geometries.size > 512) geometries.clear();
  geometries.set(key, geo);
  return geo;
}

const cache = new WeakMap<Shape, Map<SymmetryName, Symmetry | null>>();

/** the symmetry of that name if the board has it: stuck cells land on stuck cells, each switch on matching wiring */
export function symmetryNamed(s: Shape, name: SymmetryName): Symmetry | undefined {
  let per = cache.get(s);
  if (!per) { per = new Map(); cache.set(s, per); }
  if (per.has(name)) return per.get(name) ?? undefined;
  const geo = geometry(s, name);
  const fits = !!geo && cellIndexes(s).every((i) => geo.maps.every((m, e) => {
    const j = m[i]!;
    if (isStuck(s, i) !== isStuck(s, j)) return false;
    return !s.wires || !geo.wires || s.wires[j] === geo.wires[e]!(s.wires[i]!);
  }));
  const sym = fits ? { name, maps: geo.maps, wires: geo.wires } : null;
  per.set(name, sym);
  return sym ?? undefined;
}

/** the symmetries this board has, in SYMMETRY_NAMES order */
export const symmetries = (s: Shape): Symmetry[] => SYMMETRY_NAMES.flatMap((name) => symmetryNamed(s, name) ?? []);

/** the orbits of `cells` under a symmetry: each cell with every cell the maps carry it to (sorted, no repeats) */
export function orbits(sym: Symmetry, cells: readonly number[]): number[][] {
  const seen = new Set<number>();
  const out: number[][] = [];
  for (const i of cells) {
    if (seen.has(i)) continue;
    const o = [...new Set(sym.maps.map((m) => m[i]!))].sort((a, b) => a - b);
    for (const j of o) seen.add(j);
    out.push(o);
  }
  return out;
}

/** the symmetries a board's lights have (the shape's symmetries that leave the lit cells as they are) */
export function symmetriesOfBoard(s: Shape, cells: readonly boolean[]): SymmetryName[] {
  return symmetries(s).filter((sym) => sym.maps.every((m) => cells.every((on, i) => !isCell(s, i) || on === !!cells[m[i]!]))).map((x) => x.name);
}

/** true when the lit cells of a w × w block (top-left r0, c0) turn onto themselves by a quarter turn, but no mirror carries them */
function squarePinwheel(s: Shape, cells: readonly boolean[], r0: number, c0: number, w: number): boolean {
  const at = (r: number, c: number) => !!cells[(r0 + r) * s.cols + c0 + c];
  let lit = 0;
  for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) if (at(r, c)) lit++;
  if (lit < 8) return false;
  // each map in the block's own coordinates: (r, c) → the cell it lands on
  const keeps = (f: (r: number, c: number) => [number, number]) => {
    for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) if (at(r, c) && !at(...f(r, c))) return false;
    return true;
  };
  const m = w - 1;
  if (!keeps((r, c) => [c, m - r])) return false;
  return !keeps((r, c) => [r, m - c]) && !keeps((r, c) => [m - r, c]) && !keeps((r, c) => [c, r]) && !keeps((r, c) => [m - c, m - r]);
}

/**
 * True when the lights make a pinwheel: a pattern that a quarter turn (on a honeycomb, a third of a turn) carries onto
 * itself but no mirror does. Arms that turn like that can read as a swastika, so no level may show one: not as the
 * whole board, and on a square grid (or a cube's face) not in any square block of it either.
 */
export function isPinwheel(s: Shape, cells: readonly boolean[]): boolean {
  const grid = gridOf(s);
  const blocks = (r0: number, c0: number, rows: number, cols: number) => {
    for (let w = 4; w <= Math.min(rows, cols); w++) {
      for (let r = r0; r + w <= r0 + rows; r++) for (let c = c0; c + w <= c0 + cols; c++) if (squarePinwheel(s, cells, r, c, w)) return true;
    }
    return false;
  };
  if (grid === 'square') return blocks(0, 0, s.rows, s.cols);
  if (grid === 'cube') {
    const n = cubeSide(s);
    return FACES.some((f) => blocks(f.by * n, f.bx * n, n, n));
  }
  if (grid !== 'hex') return false;
  const turn = geometry(s, 'third')?.maps[2], mirrors = geometry(s, 'full')?.maps.filter((_, e) => e % 2 === 1);
  if (!turn || !mirrors) return false;
  const real = cellIndexes(s);
  const keeps = (m: readonly number[]) => real.every((i) => isCell(s, m[i]!) && !!cells[i] === !!cells[m[i]!]);
  return real.filter((i) => cells[i]).length >= 6 && keeps(turn!) && !mirrors.some(keeps);
}
