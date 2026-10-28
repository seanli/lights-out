// custom: Custom mode, "make your own board". Owns the `custom` slice (the player's settings, puzzles started, the board
// in words) and renders view.region('screen:custom'): pick a grid, its size, a twist and a difficulty, then Play.
// custom:play makes a puzzle with lib/puzzle.ts from the session rng (so a replay makes the same one), loads it on the
// board under CUSTOM_LEVEL_ID and goes to play. Settings are remembered in storage under `custom`.
import * as v from 'valibot';
import {
  CUSTOM_LEVEL_ID, CustomSettingsSchema, MAX_COLS, MAX_ROWS,
  type CustomSettings, type CustomState, type ModuleDef, type Rng, type Shape,
} from '../../contracts';
import { cubeShape } from '../../lib/cube';
import { fmt, h, setAttr, setText } from '../../lib/dom';
import { roomGlyph } from '../../lib/glyph';
import { skull } from '../../lib/icons';
import { stuckCells, tangle, wiring } from '../../lib/puzzle';
import { cellCount, hexagonShape } from '../../lib/shape';
import './custom.css';

const Text = v.pipe(v.string(), v.minLength(1));
const Step = v.object({ name: Text, less: Text, more: Text });
const Copy = v.object({
  title: Text,
  eyebrow: Text,
  back: Text,
  sections: v.object({ grid: Text, size: Text, twist: Text, difficulty: Text }),
  grids: v.object({ square: Text, hex: Text, cube: Text }),
  twists: v.object({ none: Text, stuck: Text, wired: Text }),
  difficulties: v.object({ easy: Text, medium: Text, hard: Text, boss: Text }),
  /** each stepper's name and its buttons' labels */
  sizes: v.object({ cols: Step, rows: Step, hexSide: Step, cubeSide: Step }),
  /** beside the hex and cube steppers: "37 lights" */
  lights: Text,
  /** under the twist choice: what the chosen twist does */
  twistNotes: v.object({ none: Text, stuck: Text, wired: Text }),
  wiredNeedsSquare: Text,
  /** under the size steppers when a square board gets big */
  bigNote: Text,
  /** the board's name; also the start of the label the play header shows */
  name: v.object({ square: Text, hex: Text, cube: Text }),
  /** the preview's line, per grid (hex's name already counts its lights) */
  summary: v.object({ square: Text, hex: Text, cube: Text }),
  /** between the label's parts: "Square 7×7 · Stuck · Hard" */
  sep: Text,
  play: Text,
  error: Text,
});
type CopyT = v.InferOutput<typeof Copy>;

/** what a new player starts from (and what replaces unreadable saved settings) */
const DEFAULTS: CustomSettings = Object.freeze({
  grid: 'square', cols: 6, rows: 6, hexSide: 4, cubeSide: 3, twist: 'none', difficulty: 'medium',
});
const STORE_KEY = 'custom';
const SaveSchema = v.object({ version: v.literal(1), settings: v.unknown() });

/** the choices on screen, in order (the values CustomSettingsSchema allows) */
const OPTIONS = {
  grid: ['square', 'hex', 'cube'],
  twist: ['none', 'stuck', 'wired'],
  difficulty: ['easy', 'medium', 'hard', 'boss'],
} as const;
type OptionKey = keyof typeof OPTIONS;
const OPTION_KEYS = Object.keys(OPTIONS) as OptionKey[];
/** stepper bounds: the same as CustomSettingsSchema's */
const SIZES = { cols: [3, MAX_COLS], rows: [3, MAX_ROWS], hexSide: [3, 5], cubeSide: [3, 4] } as const;
/** past this many across (or down), a square board's lights get small enough to need the magnifier: say so */
const BIG = { cols: 10, rows: 16 };
/** hold a − or + to keep stepping: the wait before it repeats, then the pace */
const HOLD_MS = 380;
const REPEAT_MS = 60;
type SizeKey = keyof typeof SIZES;
const SIZE_KEYS = Object.keys(SIZES) as SizeKey[];
const SHOWN: Record<CustomSettings['grid'], SizeKey[]> = { square: ['cols', 'rows'], hex: ['hexSide'], cube: ['cubeSide'] };

/**
 * Tuning. par: the presses a puzzle needs, as a share of its lights. wires: how many switch patterns a wired puzzle mixes,
 * and whether only the gentle ones (lines, the plus, the cross); the same steps as the Wired room's bands.
 */
const share = v.pipe(v.number(), v.minValue(0.01), v.maxValue(0.6));
const count = v.pipe(v.number(), v.integer(), v.minValue(1));
const Wiring = v.object({ kinds: count, gentle: v.boolean() });
/** rules.json → custom: how a difficulty becomes a par, a twist's amount, and how hard generation tries */
const RulesSchema = v.object({
  /** par as a share of the board's lights, per difficulty */
  par: v.object({ easy: share, medium: share, hard: share, boss: share }),
  minPar: count,
  /** wiring patterns mixed per difficulty (gentle: lines, the plus and the cross only) */
  wires: v.object({ easy: Wiring, medium: Wiring, hard: Wiring, boss: Wiring }),
  /** one stuck light per this many lights, at least 1, at most maxStuck */
  lightsPerStuck: count,
  maxStuck: count,
  maxTries: count,
  /** a puzzle never asks for more presses than this, however big the board */
  maxPar: count,
});
type Tuning = v.InferOutput<typeof RulesSchema>;

/** the board before any twist */
function baseShape(s: CustomSettings): Shape {
  if (s.grid === 'hex') return hexagonShape(s.hexSide);
  if (s.grid === 'cube') return cubeShape(s.cubeSide);
  return { cols: s.cols, rows: s.rows, mask: null };
}

const parTarget = (t: Tuning, lights: number, d: CustomSettings['difficulty']) => Math.min(t.maxPar, Math.max(t.minPar, Math.round(lights * t.par[d])));

/** the board with its twist: stuck lights or wiring drawn from `rng` */
function puzzleShape(t: Tuning, s: CustomSettings, rng: Rng): Shape {
  const shape = baseShape(s);
  if (s.twist === 'stuck') {
    const n = Math.min(t.maxStuck, Math.max(1, Math.round(cellCount(shape) / t.lightsPerStuck)));
    return { ...shape, stuck: stuckCells(shape, n, rng) };
  }
  if (s.twist === 'wired') {
    const w = t.wires[s.difficulty];
    return { ...shape, wires: wiring(shape, rng, w.kinds, w.gentle) };
  }
  return shape;
}

/** wired needs the square grid: on hex or cube it quietly becomes none */
const fixWired = (s: CustomSettings): CustomSettings => (s.grid !== 'square' && s.twist === 'wired' ? { ...s, twist: 'none' } : s);

const same = (a: CustomSettings, b: CustomSettings) => (Object.keys(a) as (keyof CustomSettings)[]).every((k) => a[k] === b[k]);

const icon = (d: string) => {
  const span = document.createElement('span');
  span.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  return span.firstElementChild!;
};
const CHEVRON_LEFT = 'M15 18l-6-6 6-6';
const MINUS = 'M6 12h12';
const PLUS = 'M12 6v12M6 12h12';

interface Stepper { el: HTMLElement; value: HTMLElement; less: HTMLElement; more: HTMLElement }

const custom: ModuleDef = {
  manifest: {
    name: 'custom',
    emits: ['custom:started', 'custom:refused', 'custom:set', 'custom:play', 'board:load', 'nav:go', 'nav:back'],
    listens: ['custom:open', 'custom:set', 'custom:play'],
    owns: ['custom'],
    uses: ['view', 'solver', 'rng', 'clock'],
    optional: ['storage'],
    data: { copy: Copy, rules: RulesSchema },
  },
  init(ctx) {
    const copy = ctx.data.copy as CopyT;
    const tuning = ctx.data.rules as Tuning;
    const view = ctx.need('view');
    const solver = ctx.need('solver');
    const rng = ctx.need('rng');
    const clock = ctx.need('clock');
    const storage = ctx.service('storage');
    const state = () => ctx.read('custom')!;
    /** the last puzzle made, for the console */
    let last: { label: string; target: number; par: number; readable: number; tries: number; ms: number } | null = null;

    function loadSettings(): CustomSettings {
      const raw = storage?.get(STORE_KEY);
      if (raw === undefined) return DEFAULTS;
      const save = v.safeParse(SaveSchema, raw);
      const parsed = save.success ? v.safeParse(CustomSettingsSchema, save.output.settings) : null;
      if (!parsed?.success) {
        ctx.log.warn('Saved custom settings were unreadable; starting from the defaults', raw);
        return DEFAULTS;
      }
      return fixWired(parsed.output);
    }
    ctx.write('custom', { status: 'idle', settings: loadSettings(), played: 0, label: null });

    const refuse = (command: 'custom:open' | 'custom:set' | 'custom:play', reason: 'locked' | 'bad_settings' | 'no_puzzle') =>
      ctx.emit('custom:refused', { command, reason });
    /** the other boards open first (progress.varietyOpen); without a progress module everything is open */
    const locked = () => {
      const p = ctx.read('progress');
      return p !== undefined && p.varietyOpen !== true;
    };

    const nameOf = (s: CustomSettings, lights: number) =>
      s.grid === 'hex' ? fmt(copy.name.hex, { lights })
        : s.grid === 'cube' ? fmt(copy.name.cube, { n: s.cubeSide })
          : fmt(copy.name.square, { cols: s.cols, rows: s.rows });
    const labelOf = (s: CustomSettings, lights: number) =>
      [nameOf(s, lights), s.twist === 'none' ? '' : copy.twists[s.twist], copy.difficulties[s.difficulty]].filter(Boolean).join(copy.sep);

    ctx.on('custom:open', () => {
      if (locked()) return refuse('custom:open', 'locked');
      ctx.emit('nav:go', { screen: 'custom' });
    });

    ctx.on('custom:set', (p) => {
      const cur = state();
      const patch = p?.settings;
      if (!patch || typeof patch !== 'object') return refuse('custom:set', 'bad_settings');
      const merged = { ...cur.settings, ...patch };
      // asking for wired on hex or cube is a mistake; picking hex or cube while wired turns wired off
      if (patch.twist === 'wired' && merged.grid !== 'square') {
        ctx.log.warn('Wired needs the square grid', { settings: patch });
        return refuse('custom:set', 'bad_settings');
      }
      const parsed = v.safeParse(CustomSettingsSchema, fixWired(merged));
      if (!parsed.success) {
        ctx.log.warn('Refused custom settings', { settings: patch, problem: parsed.issues[0]?.message });
        return refuse('custom:set', 'bad_settings');
      }
      const settings = parsed.output;
      if (same(settings, cur.settings)) return;
      ctx.write('custom', { status: cur.status === 'error' ? 'idle' : cur.status, settings, played: cur.played, label: cur.label });
      if (storage && !storage.set(STORE_KEY, { version: 1, settings })) ctx.log.info('Custom settings are kept only for this session');
    });

    ctx.on('custom:play', () => {
      if (locked()) return refuse('custom:play', 'locked');
      const cur = state();
      const s = cur.settings;
      const t0 = performance.now();
      let shape: Shape;
      let made: ReturnType<typeof tangle>;
      let target: number;
      try {
        // one draw from the session rng per puzzle: replays make the same puzzle
        const r = rng.seeded(rng.int(2 ** 31));
        shape = puzzleShape(tuning, s, r);
        target = parTarget(tuning, cellCount(shape), s.difficulty);
        made = tangle(shape, target, r, solver, { readable: s.difficulty === 'easy' ? 1 : 0, maxTries: tuning.maxTries });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.log.error('Couldn\'t make a custom puzzle', { settings: s, message });
        ctx.write('custom', { status: 'error', settings: s, played: cur.played, label: cur.label, error: copy.error });
        return refuse('custom:play', 'no_puzzle');
      }
      const label = labelOf(s, cellCount(shape));
      const played = cur.played + 1;
      last = { label, target, par: made.par, readable: made.readable, tries: made.tries, ms: Math.round(performance.now() - t0) };
      ctx.log.info('Made a custom puzzle', last);
      ctx.emit('board:load', { levelId: CUSTOM_LEVEL_ID, cells: made.cells, par: made.par, shape });
      ctx.write('custom', { status: 'playing', settings: s, played, label });
      ctx.emit('custom:started', { par: made.par, label, puzzle: played });
      ctx.emit('nav:go', { screen: 'play' });
    });

    // ---- the screen: built once, repainted in place ----
    const region = view.region('screen:custom');
    region.classList.add('custom');
    const words: Record<OptionKey, Record<string, string>> = { grid: copy.grids, twist: copy.twists, difficulty: copy.difficulties };
    const radios = {} as Record<OptionKey, HTMLElement[]>;
    const WIRED_NOTE_ID = 'custom-wired-note';

    const group = (key: OptionKey, after: HTMLElement | null = null) => {
      const labelId = `custom-${key}-label`;
      radios[key] = OPTIONS[key].map((value) => h('button', {
        type: 'button', class: 'custom__opt', role: 'radio', 'data-custom-option': key, 'data-value': value,
        'aria-checked': 'false', tabindex: '-1',
      }, value === 'boss' ? skull() : null, h('span', {}, words[key][value]!)));
      return h('section', { class: 'section custom__section' },
        h('span', { class: 'eyebrow', id: labelId }, copy.sections[key]),
        h('div', { class: 'custom__seg', role: 'radiogroup', 'aria-labelledby': labelId, 'data-custom-group': key }, ...radios[key]),
        after);
    };

    const stepper = (key: SizeKey): Stepper => {
      const c = copy.sizes[key];
      const nameId = `custom-${key}-name`;
      const value = h('output', { class: 'custom__value num', 'data-custom-value': '', 'aria-live': 'polite' });
      const less = h('button', { type: 'button', class: 'btn btn--icon', 'data-step': '-1', 'aria-label': c.less }, icon(MINUS));
      const more = h('button', { type: 'button', class: 'btn btn--icon', 'data-step': '1', 'aria-label': c.more }, icon(PLUS));
      const el = h('div', { class: 'custom__stepper', role: 'group', 'aria-labelledby': nameId, 'data-custom-size': key },
        h('span', { class: 'custom__stepper-name', id: nameId }, c.name),
        h('div', { class: 'custom__stepper-row' }, less, value, more));
      return { el, value, less, more };
    };

    const glyph = h('span', { class: 'custom__glyph' });
    const name = h('strong', { class: 'custom__name', 'data-custom-name': '' });
    const summary = h('span', { class: 'custom__summary', 'data-custom-summary': '' });
    const steppers = Object.fromEntries(SIZE_KEYS.map((k) => [k, stepper(k)])) as Record<SizeKey, Stepper>;
    const lightsNote = h('span', { class: 'custom__lights', 'data-custom-lights': '' });
    const bigNote = h('p', { class: 'custom__note', 'data-custom-big': '', hidden: true }, copy.bigNote);
    const twistNote = h('span', { 'data-custom-note': '' });
    const wiredNote = h('span', { class: 'custom__wired-note', id: WIRED_NOTE_ID, 'data-custom-wired-note': '' }, copy.wiredNeedsSquare);
    const error = h('p', { class: 'custom__error', role: 'alert', 'data-custom-error': '', hidden: true });

    region.replaceChildren(
      h('header', { class: 'screen-header' },
        h('button', { class: 'btn btn--icon', type: 'button', 'data-action': 'custom-back', 'aria-label': copy.back }, icon(CHEVRON_LEFT)),
        h('div', { class: 'screen-header__title' }, h('span', { class: 'eyebrow' }, copy.eyebrow), h('strong', {}, copy.title)),
        h('div', { class: 'screen-header__end' })),
      h('div', { class: 'custom__body' },
        h('div', { class: 'custom__preview', 'data-custom-preview': '' }, glyph, h('div', { class: 'custom__preview-body' }, name, summary)),
        group('grid'),
        h('section', { class: 'section custom__section' },
          h('span', { class: 'eyebrow' }, copy.sections.size),
          h('div', { class: 'custom__sizes' }, ...SIZE_KEYS.map((k) => steppers[k].el), lightsNote), bigNote),
        group('twist', h('p', { class: 'custom__note' }, twistNote, ' ', wiredNote)),
        group('difficulty')),
      error,
      h('nav', { class: 'bar' },
        h('button', { class: 'btn btn--primary bar__main', type: 'button', 'data-action': 'custom-play' }, copy.play)),
    );

    let glyphKey = '';
    function paint(s: CustomState | undefined) {
      if (!s) return;
      const set = s.settings;
      for (const key of OPTION_KEYS) {
        for (const r of radios[key]) {
          const on = r.dataset.value === set[key];
          setAttr(r, 'aria-checked', String(on));
          setAttr(r, 'tabindex', on ? '0' : '-1');
        }
      }
      const noWires = set.grid !== 'square';
      const wired = radios.twist.find((r) => r.dataset.value === 'wired')!;
      setAttr(wired, 'aria-disabled', noWires ? 'true' : null);
      setAttr(wired, 'aria-describedby', noWires ? WIRED_NOTE_ID : null);
      wiredNote.hidden = !noWires;
      setText(twistNote, copy.twistNotes[set.twist]);

      const shape = baseShape(set);
      const lights = cellCount(shape);
      for (const key of SIZE_KEYS) {
        const st = steppers[key];
        st.el.hidden = !SHOWN[set.grid].includes(key);
        setText(st.value, String(set[key]));
        setAttr(st.less, 'aria-disabled', set[key] <= SIZES[key][0] ? 'true' : null);
        setAttr(st.more, 'aria-disabled', set[key] >= SIZES[key][1] ? 'true' : null);
      }
      lightsNote.hidden = set.grid === 'square';
      bigNote.hidden = set.grid !== 'square' || (set.cols <= BIG.cols && set.rows <= BIG.rows);
      setText(lightsNote, fmt(copy.lights, { n: lights }));

      setText(name, nameOf(set, lights));
      setText(summary, fmt(copy.summary[set.grid], { lights, par: parTarget(tuning, lights, set.difficulty) }));
      // the picture: the board's shape, lit more the harder the puzzle (easy a quarter, boss all of it)
      const key = `${set.grid}:${set.cols}x${set.rows}:${set.hexSide}:${set.cubeSide}:${set.difficulty}`;
      if (key !== glyphKey) {
        glyphKey = key;
        const g = roomGlyph({ shape, count: OPTIONS.difficulty.length }, OPTIONS.difficulty.indexOf(set.difficulty) + 1);
        // a honeycomb's odd rows sit half a light to the right
        if (set.grid === 'hex') [...g.children].forEach((dot, i) => { if (Math.floor(i / shape.cols) % 2) dot.setAttribute('data-odd', ''); });
        setAttr(glyph, 'data-grid', set.grid);
        glyph.replaceChildren(g);
      }

      error.hidden = s.status !== 'error';
      setText(error, s.status === 'error' ? s.error ?? copy.error : '');
    }

    function choose(radio: HTMLElement) {
      if (radio.getAttribute('aria-disabled') === 'true') return;
      const key = radio.dataset.customOption as OptionKey;
      const value = radio.dataset.value!;
      if (state().settings[key] !== value) ctx.emit('custom:set', { settings: { [key]: value } as Partial<CustomSettings> });
    }

    /** one step of a − / + button; false when it is at its end */
    const stepOf = (step: HTMLElement): boolean => {
      const key = step.closest<HTMLElement>('[data-custom-size]')?.dataset.customSize as SizeKey | undefined;
      if (!key || step.getAttribute('aria-disabled') === 'true') return false;
      const now = state().settings[key];
      const next = Math.min(SIZES[key][1], Math.max(SIZES[key][0], now + Number(step.dataset.step)));
      if (next === now) return false;
      ctx.emit('custom:set', { settings: { [key]: next } });
      return true;
    };
    // hold − or + to keep stepping (3 to 30 is a long way one tap at a time); the click after a hold does nothing
    let holding: (() => void) | null = null;
    let held = false;
    const stopHold = () => { holding?.(); holding = null; };
    region.addEventListener('pointerdown', (e) => {
      const step = (e.target as Element).closest<HTMLElement>('[data-step]');
      if (!step || e.button !== 0) return;
      stopHold();
      held = false;
      const tick = (wait: number) => {
        holding = clock.setTimeout(() => {
          held = true;
          if (stepOf(step)) tick(REPEAT_MS); else holding = null;
        }, wait);
      };
      tick(HOLD_MS);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) region.addEventListener(type, stopHold);

    // every tap goes through an event (custom:set / custom:play / nav), so replay reproduces it
    region.addEventListener('click', (e) => {
      const target = e.target as Element;
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'custom-back') return ctx.emit('nav:back', {});
      if (action === 'custom-play') return ctx.emit('custom:play', {});
      const radio = target.closest<HTMLElement>('[data-custom-option]');
      if (radio) return choose(radio);
      const step = target.closest<HTMLElement>('[data-step]');
      if (!step) return;
      if (held && e.detail !== 0) { held = false; return; } // a hold already stepped
      stepOf(step);
    });

    // arrow keys move (and choose) within a radiogroup, skipping what can't be chosen; Tab leaves the group
    region.addEventListener('keydown', (e) => {
      const radio = (e.target as Element).closest?.<HTMLElement>('[role="radio"]');
      const groupEl = radio?.closest('[role="radiogroup"]');
      if (!radio || !groupEl) return;
      const open = [...groupEl.querySelectorAll<HTMLElement>('[role="radio"]')].filter((r) => r.getAttribute('aria-disabled') !== 'true');
      const i = open.indexOf(radio);
      const n = open.length;
      const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? open[(i + 1) % n]
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? open[(i - 1 + n) % n]
          : e.key === 'Home' ? open[0] : e.key === 'End' ? open[n - 1] : undefined;
      if (!to) return;
      e.preventDefault();
      choose(to);
      to.focus();
    });

    ctx.watch('custom', paint);
    paint(state());

    return {
      start: () => paint(state()),
      debug: () => ({ ...state(), last }),
      commands: {
        open: () => { ctx.emit('custom:open', {}); return 'ok'; },
        play: () => { ctx.emit('custom:play', {}); return last ?? state().error ?? 'ok'; },
        /** custom.set cols=8 rows=12 difficulty=boss */
        set: (args) => {
          const patch: Record<string, string | number> = {};
          for (const a of args) {
            const [k, val = ''] = a.split('=');
            if (k) patch[k] = /^\d+$/.test(val) ? Number(val) : val;
          }
          ctx.emit('custom:set', { settings: patch as Partial<CustomSettings> });
          return state().settings;
        },
      },
    };
  },
};
export default custom;
