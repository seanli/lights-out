// The shape of each lesson: what each step shows. Every sentence lives in copy.json → learn.lessons.
// Boards are described by the taps that make them from a dark board, so they are always reachable.

/** what to ring on a mini board */
export type Marks = number[] | 'taps' | 'chase-first-row' | 'method' | 'shortest' | 'quiet';

export interface MiniSpec {
  /** taps that build the board from dark */
  from: number[];
  /** run a chase on the board before showing it */
  chased?: boolean;
  marks?: Marks;
  /** which quiet pattern (0-based) when marks is 'quiet'; the board is dark */
  quiet?: number;
  /** copy key in learn.captions, filled with {n} = number of marks */
  caption?: string;
}

export type Step =
  | { kind: 'show'; boards: MiniSpec[] }
  | { kind: 'demo'; from: number[]; play: number[] | 'chase' | 'method' }
  | { kind: 'practice' }
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

export type Assist = 'chase' | 'method' | null;

export interface Lesson {
  steps: Step[];
  /** what the assist button suggests on the practice board, or null for no assist */
  assist: Assist;
  /** practice taps come only from these cells (default: all 25) */
  pool?: number[];
  /** show moves vs par while practising */
  showPar?: boolean;
  /** an extra lesson behind a quiet "Go deeper" link on the last step */
  deeper?: string;
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => from + k);
/** a board a chase clears completely (no taps in the top row) */
const CHASE_ME = [6, 8, 12, 17];
/** a board the chase alone can't finish */
const STUBBORN = [1, 8, 12, 16, 24];
/** a board whose chase leaves B's echo (ABC··): built from B plus taps below the top row */
const ECHO_B = [1, 12, 18];
/** a board whose chase-method answer is long but whose shortest answer is 5 taps */
const LONG_WAY = [0, 4, 12, 20, 24];

export const LESSONS: Record<string, Lesson> = {
  shapes: {
    assist: null,
    steps: [
      { kind: 'show', boards: [{ from: [12], marks: 'taps' }] },
      { kind: 'show', boards: [{ from: [2], marks: 'taps', caption: 'edge' }, { from: [20], marks: 'taps', caption: 'corner' }] },
      { kind: 'demo', from: [16], play: [16] },
      { kind: 'practice' },
    ],
  },
  order: {
    assist: null,
    steps: [
      { kind: 'demo', from: [], play: [12, 12] },
      { kind: 'show', boards: [{ from: [6, 8], marks: 'taps' }] },
      { kind: 'show', boards: [{ from: [0, 13, 21], marks: 'taps', caption: 'set' }] },
      { kind: 'practice' },
    ],
  },
  chase: {
    assist: 'chase',
    pool: range(5, 25),
    steps: [
      { kind: 'show', boards: [{ from: CHASE_ME, marks: 'chase-first-row' }] },
      { kind: 'demo', from: CHASE_ME, play: 'chase' },
      { kind: 'show', boards: [{ from: STUBBORN, chased: true }] },
      { kind: 'practice' },
    ],
  },
  'bottom-row': {
    assist: 'method',
    deeper: 'echo-more',
    steps: [
      { kind: 'show', boards: [{ from: STUBBORN, chased: true }] },
      { kind: 'echo' },
      { kind: 'demo', from: ECHO_B, play: 'method' },
      { kind: 'stack', pairs: [[0, 3], [0, 1]] },
      { kind: 'practice' },
    ],
  },
  /** not in the lesson list: opened from "Go deeper" at the end of lesson 4 */
  'echo-more': {
    assist: null,
    steps: [{ kind: 'rules' }, { kind: 'derive' }, { kind: 'drill' }],
  },
  shortest: {
    assist: null,
    showPar: true,
    steps: [
      { kind: 'show', boards: [{ from: [], quiet: 0, marks: 'quiet', caption: 'quiet' }, { from: [], quiet: 1, marks: 'quiet', caption: 'quiet' }] },
      { kind: 'show', boards: [{ from: LONG_WAY, marks: 'method', caption: 'method' }, { from: LONG_WAY, marks: 'shortest', caption: 'shortest' }] },
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
  { key: 'gap', rows: [{ bottom: [1, 3], top: [0, 3] }] },
];
export const ruleFor = (bottom: readonly number[]): Rule | undefined => RULES.find((r) => r.rows.some((x) => x.bottom.join() === bottom.join()));
