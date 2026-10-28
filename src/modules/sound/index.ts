// sound: device feedback. A light switch, close-miked and dry: each tap is a click (brighter switching on,
// duller switching off) with faint ticks as the neighbours flip. Plus short haptic ticks (navigator.vibrate
// where it exists). One on/off switch for both.
// The sounds are synthesised once, after a level starts, in short steps (synth.ts); a tap only plays a
// finished buffer: one buffer source and one gain into a shared master gain.
import * as v from 'valibot';
import type { ModuleDef } from '../../contracts';
import {
  ClickSchema, GlassSchema, RestartSchema, TicksSchema, UndoSchema, WinSchema,
  db2a, renderGlass, renderRestart, renderTake, renderUndo, renderWin, takeParts, type Sound,
} from './synth';

const ms = v.pipe(v.number(), v.minValue(0));
const unit = v.pipe(v.number(), v.minValue(0), v.maxValue(1));
const Rules = v.object({
  volume: unit,
  seed: v.number(),
  /** pre-made takes per tap sound (on, off); a tap plays one at random, never the same twice in a row */
  takes: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(12)),
  /** filter: per take; pitch (share) and db: per tap */
  vary: v.object({ filter: unit, pitch: v.pipe(v.number(), v.minValue(0), v.maxValue(0.2)), db: v.pipe(v.number(), v.minValue(0), v.maxValue(3)) }),
  /** the edge columns pan this far; the same on any board width */
  pan: unit,
  ceilingHz: v.pipe(v.number(), v.minValue(1000), v.maxValue(20000)),
  on: ClickSchema,
  off: ClickSchema,
  neighbours: TicksSchema,
  /** the win's relay clicks */
  relay: ClickSchema,
  win: WinSchema,
  /** a boss level's win: these values over `win` */
  bossWin: v.partial(WinSchema),
  /** one glass tick per earned star, timed to the solved sheet's stars */
  stars: v.object({ ...GlassSchema.entries, startMs: ms, stepMs: ms }),
  hint: GlassSchema,
  undo: UndoSchema,
  restart: RestartSchema,
  haptics: v.object({ tap: ms, hint: ms, solved: v.array(ms) }),
});
type RulesT = v.InferOutput<typeof Rules>;
const Flags = v.object({ defaultOn: v.boolean() });

type AudioCtor = typeof AudioContext;
type Once = 'win' | 'bossWin' | 'undo' | 'restart' | 'hint';
/** one warm-up job: run() advances it one short step; put() files the finished buffer; rate = its sample rate if not the device's */
interface Job { name: string; run: Iterator<void, Sound>; put(b: AudioBuffer): void; rate?: number }
/** The win holds nothing above the 7kHz ceiling (its swell sits under 1.6kHz), so it is built at 24kHz:
 *  a quarter of the work at warm-up; the browser resamples it on playback. */
const WIN_RATE = 24000;
/** swell samples per warm-up step: under a millisecond even before the code is optimised */
const WIN_CHUNK = 512;
function* once(make: () => Sound): Generator<void, Sound> { return make(); }

const sound: ModuleDef = {
  manifest: {
    name: 'sound',
    emits: ['sound:changed'],
    listens: [
      'sound:set', 'board:loaded', 'board:pressed', 'board:undone', 'board:restarted', 'board:solved',
      'hints:shown', 'levels:started', 'progress:level_completed', 'nav:changed',
    ],
    owns: ['sound'],
    uses: ['rng'],
    optional: ['storage', 'clock', 'view'],
    data: { rules: Rules, flags: Flags },
  },
  init(ctx) {
    const rules = ctx.data.rules as RulesT;
    const { defaultOn } = ctx.data.flags as v.InferOutput<typeof Flags>;
    const storage = ctx.service('storage');
    const view = ctx.service('view');
    const clock = ctx.service('clock');
    const rng = ctx.need('rng');
    const build = rng.seeded(rules.seed); // the takes: the same every session
    const vary = rng.seeded(rules.seed + 1); // per-tap choices
    const buildRnd = () => build.next();
    const jitter = (amount: number) => (vary.next() * 2 - 1) * amount;
    const saved = storage?.get('sound');
    const enabled = typeof saved === 'object' && saved !== null && typeof (saved as { enabled?: unknown }).enabled === 'boolean'
      ? (saved as { enabled: boolean }).enabled
      : defaultOn;
    const Ctor: AudioCtor | undefined = typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext);
    let audio: AudioContext | null = null;
    let master: GainNode | null = null;
    /** one panner per pan position, made once and reused */
    const panners = new Map<number, AudioNode>();
    const takes = { on: [] as AudioBuffer[], off: [] as AudioBuffer[] };
    const lastTake = { on: -1, off: -1 };
    const built = new Map<Once, AudioBuffer>();
    const stars: AudioBuffer[] = [];
    let queue: Job[] = [];
    let cancelStep: (() => void) | null = null;
    let steps = 0;
    /** columns of the board being played (board:loaded; absent shape = classic 5×5) */
    let cols = 5;
    /** the level being played, when it's a boss */
    let bossLevel: number | null = null;
    /** the last level completion, until its stars have pinged */
    let completed: { levelId: number; stars: number; pinged: boolean } | null = null;

    ctx.write('sound', { enabled, status: Ctor ? 'idle' : 'unavailable' });

    // ---- haptics ----
    const canVibrate = typeof navigator !== 'undefined' && typeof (navigator as { vibrate?: unknown }).vibrate === 'function';
    ctx.report(canVibrate
      ? { service: 'haptics', mode: 'live', ok: true, detail: 'Taps give a short vibration on this device.' }
      : { service: 'haptics', mode: 'mock', ok: true, detail: "This device can't vibrate from a web page, so taps are felt through sound only." });
    const buzz = (pattern: number | number[]) => {
      if (!canVibrate || !ctx.read('sound')!.enabled) return;
      try { navigator.vibrate(pattern); } catch { /* a refused vibration is never worth a message */ }
    };

    // ---- the sounds, built in short steps so no tap waits on them ----
    const toBuffer = (a: AudioContext, s: Sound, rate = a.sampleRate) => {
      const chans = Array.isArray(s) ? s : [s];
      const b = a.createBuffer(chans.length, chans[0]!.length, rate);
      chans.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
      return b;
    };
    const take = (sr: number, side: 'on' | 'off') => takeParts(sr, rules[side], buildRnd, rules.ceilingHz, rules.vary.filter, rules.neighbours);
    const winJob = (name: 'win' | 'bossWin', over: Partial<RulesT['win']> = {}): Job => ({
      name, rate: WIN_RATE, put: (b) => built.set(name, b),
      run: renderWin(WIN_RATE, { ...rules.win, ...Object.fromEntries(Object.entries(over).filter(([, x]) => x !== undefined)) }, rules.relay, buildRnd, rules.ceilingHz, WIN_CHUNK),
    });
    /** taps first (one of each side before the rest), the win last */
    function plan(sr: number): Job[] {
      const jobs: Job[] = [];
      for (let k = 0; k < rules.takes; k++) {
        for (const side of ['on', 'off'] as const) jobs.push({ name: `${side} take`, run: take(sr, side), put: (b) => takes[side].push(b) });
      }
      const single = (name: Once, make: () => Sound): Job => ({ name, run: once(make), put: (b) => built.set(name, b) });
      jobs.push(
        single('hint', () => renderGlass(sr, rules.hint, rules.hint.hz[0]!, buildRnd, rules.ceilingHz)),
        single('undo', () => renderUndo(sr, rules.undo, rules.off, buildRnd, rules.ceilingHz)),
        single('restart', () => renderRestart(sr, rules.restart, rules, buildRnd, rules.ceilingHz)),
        ...rules.stars.hz.map((f): Job => ({ name: 'star', run: once(() => renderGlass(sr, rules.stars, f, buildRnd, rules.ceilingHz)), put: (b) => stars.push(b) })),
        winJob('win'),
      );
      if (bossLevel !== null) jobs.push(winJob('bossWin', rules.bossWin));
      return jobs;
    }
    /** taps own the frames right after them: warm-up steps wait out this quiet window after each press */
    const QUIET_MS = 150;
    let quietUntil = 0;
    const now = () => (clock ? clock.now() : Date.now());
    const later = (fn: () => void) => {
      const wait = Math.max(0, quietUntil - now());
      if (clock) return clock.setTimeout(fn, wait);
      const id = setTimeout(fn, wait);
      return () => clearTimeout(id);
    };
    function step() {
      cancelStep = null;
      const job = queue[0];
      if (!job || !audio) return;
      try {
        const r = job.run.next();
        if (r.done) { queue.shift(); job.put(toBuffer(audio, r.value, job.rate)); }
      } catch (err) {
        queue.shift(); // one sound that fails to build stays silent; the rest still build
        ctx.log.warn(`Could not build the ${job.name} sound`, err);
      }
      steps++;
      if (queue.length) cancelStep = later(step);
    }
    const kick = () => { if (!cancelStep && queue.length) cancelStep = later(step); };

    // ---- audio ----
    /** created after a tap (just after levels:started, or on the first board tap), so the browser allows it */
    function ensure(): AudioContext | null {
      const st = ctx.read('sound')!;
      if (!st.enabled || st.status === 'unavailable') return null;
      if (audio) {
        if (audio.state === 'suspended') void audio.resume().catch(() => {});
        return audio;
      }
      try {
        audio = new Ctor!();
        master = audio.createGain();
        master.gain.value = rules.volume;
        master.connect(audio.destination);
        ctx.write('sound', { ...st, status: 'ready' });
        ctx.report({ service: 'audio', mode: 'live', ok: true, detail: 'Sound is playing through Web Audio.' });
        queue = plan(audio.sampleRate);
        kick();
        return audio;
      } catch (err) {
        audio = null;
        master = null;
        ctx.write('sound', { ...st, status: 'unavailable' });
        ctx.report({ service: 'audio', mode: 'mock', ok: false, detail: 'This browser blocked sound, so the game plays silently.' });
        ctx.log.warn('Audio unavailable', err);
        return null;
      }
    }

    function panner(a: AudioContext, pan: number): AudioNode {
      if (!pan || typeof a.createStereoPanner !== 'function') return master!; // older Safari: centred
      let node = panners.get(pan);
      if (!node) {
        const p = a.createStereoPanner();
        p.pan.value = pan;
        p.connect(master!);
        node = p;
        panners.set(pan, node);
      }
      return node;
    }
    function play(buf: AudioBuffer | undefined, o: { at?: number; rate?: number; db?: number; pan?: number } = {}) {
      const a = ensure();
      if (!a || !buf) return;
      const src = a.createBufferSource();
      src.buffer = buf;
      if (o.rate && o.rate !== 1) src.playbackRate.value = o.rate;
      const g = a.createGain();
      g.gain.value = db2a(o.db ?? 0);
      src.connect(g).connect(panner(a, o.pan ?? 0));
      src.start(a.currentTime + (o.at ?? 0));
    }
    /** a tap: one of the side's takes (never the last one again), a touch of pitch and level variation */
    function click(on: boolean, pan = 0) {
      const a = ensure();
      if (!a) return;
      const side = on ? 'on' : 'off';
      const list = takes[side];
      if (!list.length) list.push(toBuffer(a, renderTake(a.sampleRate, rules[side], buildRnd, rules.ceilingHz, rules.vary.filter, rules.neighbours))); // only a tap before warm-up made one
      let k = vary.int(list.length);
      if (list.length > 1 && k === lastTake[side]) k = (k + 1) % list.length;
      lastTake[side] = k;
      play(list[k], { rate: 1 + jitter(rules.vary.pitch), db: jitter(rules.vary.db), pan });
    }

    // Starting audio costs tens of milliseconds on some phones. Do it right after the tap that opens a
    // level (still inside the browser's user-activation window), so no board tap ever pays for it.
    ctx.on('levels:started', ({ levelId, boss }) => {
      bossLevel = boss ? levelId : null;
      if (boss && audio && !built.has('bossWin') && !queue.some((j) => j.name === 'bossWin')) {
        queue.push(winJob('bossWin', rules.bossWin));
        kick();
      }
      if (audio || !ctx.read('sound')!.enabled) return;
      later(() => { ensure(); });
    });

    ctx.on('board:loaded', ({ shape }) => { cols = shape?.cols ?? 5; });

    ctx.on('board:pressed', ({ index, cells }) => {
      quietUntil = now() + QUIET_MS;
      buzz(rules.haptics.tap);
      const centre = (cols - 1) / 2;
      const side = centre > 0 ? ((index % cols) - centre) / centre : 0; // -1 (left edge) … 1 (right edge)
      click(cells[index] === true, Math.round(side * rules.pan * 20) / 20);
    });
    // the winning tap has clicked off already; the relays start just after it
    ctx.on('board:solved', ({ levelId }) => {
      buzz(rules.haptics.solved);
      play((levelId === bossLevel && built.get('bossWin')) || built.get('win'));
    });
    ctx.on('board:undone', () => play(built.get('undo')));
    ctx.on('board:restarted', () => play(built.get('restart')));
    ctx.on('hints:shown', () => {
      buzz(rules.haptics.hint);
      play(built.get('hint'));
    });

    // ---- star ticks: one per earned star as the solved sheet shows them (either event may come first) ----
    const reduced = () => (view ? view.reducedMotion() : typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const maybePing = () => {
      if (!completed || completed.pinged || ctx.read('nav')?.sheet !== 'solved') return;
      const board = ctx.read('board');
      if (board && board.levelId !== null && board.levelId !== completed.levelId) return;
      completed.pinged = true;
      if (reduced()) return; // the stars appear all at once then, so nothing to keep time with
      for (let k = 0; k < completed.stars; k++) {
        play(stars[Math.min(k, stars.length - 1)], { at: (rules.stars.startMs + k * rules.stars.stepMs) / 1000 });
      }
    };
    ctx.on('progress:level_completed', ({ levelId, stars: n }) => { completed = { levelId, stars: n, pinged: false }; maybePing(); });
    ctx.on('nav:changed', ({ sheet }) => { if (sheet === 'solved') maybePing(); });

    ctx.on('sound:set', ({ enabled: on }) => {
      const st = ctx.read('sound')!;
      if (st.enabled === on) return;
      ctx.write('sound', { ...st, enabled: on });
      storage?.set('sound', { enabled: on });
      if (!on && audio && audio.state === 'running') void audio.suspend().catch(() => {});
      ctx.emit('sound:changed', { enabled: on });
      if (on) click(true); // the switch you just flipped
    });

    return {
      stop() {
        cancelStep?.();
        queue = [];
        void audio?.close().catch(() => {});
      },
      debug: () => ({
        cols, haptics: canVibrate, panners: panners.size, boss: bossLevel !== null,
        takes: { on: takes.on.length, off: takes.off.length }, built: [...built.keys()], stars: stars.length,
        building: queue.map((j) => j.name), steps,
      }),
      commands: { test: () => { click(true); buzz(rules.haptics.tap); return ctx.read('sound'); } },
    };
  },
};
export default sound;
