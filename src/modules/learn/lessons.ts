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
  | { kind: 'table' }
  | { kind: 'practice' };

export type Assist = 'chase' | 'method' | null;

export interface Lesson {
  steps: Step[];
  /** what the assist button suggests on the practice board, or null for no assist */
  assist: Assist;
  /** practice taps come only from these cells (default: all 25) */
  pool?: number[];
  /** show moves vs par while practising */
  showPar?: boolean;
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => from + k);
/** a board a chase clears completely (no taps in the top row) */
const CHASE_ME = [6, 8, 12, 17];
/** a board the chase alone can't finish */
const STUBBORN = [1, 8, 12, 16, 24];
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
    steps: [
      { kind: 'show', boards: [{ from: STUBBORN, chased: true }] },
      { kind: 'table' },
      { kind: 'demo', from: STUBBORN, play: 'method' },
      { kind: 'practice' },
    ],
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
