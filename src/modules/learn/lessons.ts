// The shape of each lesson: what each step shows. Every sentence lives in copy.json → learn.lessons.
// Boards are described by the taps that make them from a dark board, so they are always reachable.
// Board guides (guides.ts) use the same steps on a room's own shape; their boards are found from the solver.
import type { Shape } from '../../contracts';

/** what to ring on a mini board */
export type Marks = number[] | 'taps' | 'chase-first-row' | 'method' | 'shortest';

export interface MiniSpec {
  /** taps that build the board from dark */
  from: number[];
  /** instead: a board whose only lights are these cells */
  lit?: number[];
  /** run a chase on the board before showing it */
  chased?: boolean;
  marks?: Marks;
  /** lights outlined (the switches that reach a light, lights two taps cancel) */
  ring?: number[];
  /** a top-row fix to dot (columns): the caption may use {top} (its letters) and {total} (its taps plus the chase after) */
  fix?: number[];
  /** copy key in learn.captions, filled with {n} = number of marks ('method': every tap the method makes, none
   *  dotted), {lights} = lights lit, {rings} = lights outlined */
  caption?: string;
}

/** what a demo tap is part of: the first chase, the top-row (or top-edge) taps, the second chase, a spotted shape,
 *  a switch found by working back from a lit light (wired), or one of two overlapping taps side by side (hex, cube) */
export type Phase = 'chase' | 'top' | 'edge' | 'chase2' | 'spot' | 'back' | 'pair';

/** how a demo ends, when it doesn't end dark: copy.json → learn.demoEnd.<key> ({n} = lights left) */
export type DemoEnd = 'left' | 'stuck' | 'stuckShape' | 'cancelled';

export type Step =
  | { kind: 'show'; boards: MiniSpec[] }
  /** `bottom`: start from a board whose only lights are these bottom-row columns (instead of `from`);
   *  `lit`: start from a board whose only lights are these cells; `phases`: one per tap of an explicit `play`;
   *  `letters`: the column letters over the board; `end`: the end line (default: "All dark.", or `left` with lights on);
   *  `orders`: each Replay plays the next of these orders of the same taps; `markAll`: dot every tap still to come;
   *  `rings`: per tap, the lights outlined while it is next (a wired board: the switches that reach the light it clears) */
  | {
    kind: 'demo'; from: number[]; bottom?: number[]; lit?: number[]; play: number[] | 'chase' | 'method'; phases?: (Phase | null)[];
    letters?: boolean; end?: DemoEnd; orders?: number[][]; markAll?: boolean; rings?: number[][];
  }
  /** full rectangles: each bottom light and the top lights that clear it (tap a letter to watch it) */
  | { kind: 'lights'; rows: { bottom: number; top: number[] }[]; pick: number }
  | { kind: 'practice' }
  /** the bottom-row list: each leftover row and the top lights that clear it */
  | { kind: 'table' }
  /** pick a top-row light A–E, watch it tap and chase down to its echo */
  | { kind: 'echo' }
  /** two echoes stacked: lights in both cancel */
  | { kind: 'stack'; pairs: [number, number][] }
  /** the seven bottom rows grouped under five one-line rules */
  | { kind: 'rules' }
  /** how an echo is made: the chase's taps row by row, from the row rule */
  | { kind: 'derive' }
  /** whose echo is this? a short spaced-repetition quiz */
  | { kind: 'drill' };

/** chase: the next chase tap; method: classic chase → table → chase; fix: chase → start-cell fix → chase on any shape;
 *  par: the next tap of a shortest answer; spot: the tap of a shortest answer whose pattern is most lit (guides.ts spotOrder) */
export type Assist = 'chase' | 'method' | 'fix' | 'par' | 'spot' | null;

export interface Lesson {
  steps: Step[];
  /** the board every step is on; absent = classic 5×5 */
  shape?: Shape;
  /** what the assist button suggests on the practice board, or null for no assist */
  assist: Assist;
  /** practice taps come only from these cells (default: every cell of the board) */
  pool?: number[];
  /** practice boards always leave lights after a chase, so the bottom-row step gets used (full-rectangle guides) */
  leftover?: boolean;
  /** show moves vs par while practising */
  showPar?: boolean;
  /** an extra lesson behind a quiet "Go deeper" link on the last step */
  deeper?: string;
  /** practice: name the echo once only the bottom row is left */
  echoHelp?: boolean;
  /** practice boards are made of taps whose shapes don't touch, so spotting whole shapes always works */
  apart?: boolean;
  /** practice boards are made like the levels' (lib/puzzle.ts tangle): every tap overlaps another, none reads whole */
  tangled?: boolean;
  /** practice: a wrong tap is met with "tap it again to undo it" (one-tap boards) */
  undoHint?: boolean;
  /** practice: a coach line that follows the phase (chase, the bottom/top-edge fix, chase again); rect names letters,
   *  shape (shaped and stuck boards) points at the top-edge light Assist rings */
  coach?: 'rect' | 'shape';
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => from + k);
/** a board a chase clears completely (no taps in the top row) */
const CHASE_ME = [6, 8, 12, 17];
/** a board the chase alone can't finish */
const STUBBORN = [1, 8, 12, 16, 24];
/** a board whose chase-method answer is long but whose shortest answer is 5 taps */
const LONG_WAY = [0, 4, 12, 20, 24];
/** A, C, E on a dark board, then the chase that follows: it ends dark (taps under each lit light, row by row) */
const QUIET_ACE = [0, 2, 4, 5, 7, 9, 15, 17, 19, 20, 22, 24];

export const LESSONS: Record<string, Lesson> = {
  shapes: {
    assist: null,
    undoHint: true,
    steps: [
      { kind: 'show', boards: [{ from: [12], marks: 'taps', caption: 'dot' }] },
      { kind: 'show', boards: [{ from: [2], marks: 'taps', caption: 'edge' }, { from: [20], marks: 'taps', caption: 'corner' }] },
      // a T at the right edge: the step after "at an edge it's a T"
      { kind: 'demo', from: [14], play: [14] },
      { kind: 'practice' },
    ],
  },
  order: {
    assist: null,
    apart: true,
    steps: [
      { kind: 'demo', from: [], play: [12, 12], end: 'cancelled' },
      // the same three taps in another order on every Replay: always all dark
      { kind: 'demo', from: [0, 13, 21], play: [0, 13, 21], orders: [[0, 13, 21], [21, 0, 13], [13, 21, 0]], markAll: true },
      { kind: 'practice' },
    ],
  },
  chase: {
    assist: 'chase',
    pool: range(5, 25),
    steps: [
      { kind: 'show', boards: [{ from: CHASE_ME, marks: 'chase-first-row' }] },
      { kind: 'demo', from: CHASE_ME, play: 'chase' },
      { kind: 'demo', from: STUBBORN, play: 'chase', end: 'stuck' },
      { kind: 'practice' },
    ],
  },
  /** the one move: find your row, tap the top lights it shows, chase again */
  'bottom-row': {
    assist: 'method',
    deeper: 'echo-more',
    echoHelp: true,
    steps: [
      { kind: 'echo' },
      { kind: 'demo', from: [], bottom: [0, 1, 2], play: 'method', letters: true },
      { kind: 'table' },
      { kind: 'practice' },
    ],
  },
  /** not in the lesson list: opened from "Go deeper" in lesson 4. The stacked echoes are rows whose fix is exactly
   *  those two taps (both corners: A + B, and its mirror D + E), so the step agrees with the rules before it */
  'echo-more': {
    assist: null,
    steps: [{ kind: 'rules' }, { kind: 'stack', pairs: [[0, 1], [3, 4]] }, { kind: 'derive' }, { kind: 'drill' }],
  },
  shortest: {
    assist: 'par',
    showPar: true,
    steps: [
      // the chasing board: no dots (the method taps some lights twice), its caption counts every tap it makes
      { kind: 'show', boards: [{ from: LONG_WAY, marks: 'method', caption: 'method' }, { from: LONG_WAY, marks: 'shortest', caption: 'shortest' }] },
      // where other fixes come from: A·C·E on a dark board, chased, ends dark (a quiet top row); B·C·D does too
      { kind: 'demo', from: [], play: QUIET_ACE, phases: QUIET_ACE.map((_, k) => (k < 3 ? 'top' : 'chase')) },
      // so B·D has four fixes: A·D, plus A·C·E (C·D·E), plus B·C·D (A·B·C), plus both (B·E); counting the chase after,
      // 15, 11, 11 and 15 taps
      { kind: 'show', boards: [[0, 3], [2, 3, 4], [0, 1, 2], [1, 4]].map((fix) => ({ from: [], lit: [21, 23], fix, caption: 'fixTotal' })) },
      { kind: 'practice' },
    ],
  },
};

/**
 * The bottom-row table grouped under five rules, for remembering it. A presentation over the solver's
 * table: learn.test.ts checks that every rule's taps clear its rows and that the rules cover the table.
 * Columns 0–4 are A–E; every rule mirrors left ↔ right.
 */
export interface Rule { key: string; rows: { bottom: number[]; top: number[] }[] }
export const RULES: Rule[] = [
  { key: 'three', rows: [{ bottom: [0, 1, 2], top: [1] }, { bottom: [2, 3, 4], top: [3] }] },
  { key: 'allButMiddle', rows: [{ bottom: [0, 1, 3, 4], top: [2] }] },
  { key: 'pairLoner', rows: [{ bottom: [1, 2, 4], top: [0] }, { bottom: [0, 2, 3], top: [4] }] },
  { key: 'corners', rows: [{ bottom: [0, 4], top: [0, 1] }] },
  // A·D clears B·D too, in 15 taps; A·B·C takes 11 (lesson 5 shows all four fixes)
  { key: 'gap', rows: [{ bottom: [1, 3], top: [0, 1, 2] }] },
];
export const ruleFor = (bottom: readonly number[]): Rule | undefined => RULES.find((r) => r.rows.some((x) => x.bottom.join() === bottom.join()));
