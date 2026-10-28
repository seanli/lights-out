// sound: device feedback. Soft synthesized tones (Web Audio, started after a tap) and short haptic ticks
// (navigator.vibrate where it exists). One on/off switch for both.
import * as v from 'valibot';
import type { ModuleDef } from '../../contracts';

const ms = v.pipe(v.number(), v.minValue(0));
const unit = v.pipe(v.number(), v.minValue(0), v.maxValue(1));
const Rules = v.object({
  volume: unit,
  lowpassHz: v.pipe(v.number(), v.minValue(200)),
  lowpassQ: v.pipe(v.number(), v.minValue(0)),
  /** a tap: pitch glides down by `glide` over glideMs; edge columns detune by ±detuneCents and pan to ±pan */
  tap: v.object({ ms, gain: unit, glide: unit, glideMs: ms, detuneCents: v.number(), pan: unit }),
  /** the winning tap plays these pentatonic-scale semitones instead of a blip, stepMs apart */
  win: v.object({ steps: v.array(v.number()), stepMs: ms, ms, gain: unit }),
  restart: v.object({ steps: v.array(v.number()), stepMs: ms, ms, gain: unit }),
  /** one ping per earned star, timed to the solved sheet's stars */
  stars: v.object({ startMs: ms, stepMs: ms, ms, gain: unit }),
  haptics: v.object({ tap: ms, hint: ms, solved: v.array(ms) }),
});
type RulesT = v.InferOutput<typeof Rules>;
const Flags = v.object({ defaultOn: v.boolean() });

// pentatonic steps so any run of taps sounds musical; it descends toward the solve
const STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const BASE_HZ = 220;
const hz = (step: number) => BASE_HZ * 2 ** (step / 12);

type AudioCtor = typeof AudioContext;
interface Voice { at?: number; dur: number; gain: number; type?: OscillatorType; glide?: number; detune?: number; pan?: number }

const sound: ModuleDef = {
  manifest: {
    name: 'sound',
    emits: ['sound:changed'],
    listens: [
      'sound:set', 'board:loaded', 'board:pressed', 'board:undone', 'board:restarted', 'board:solved',
      'hints:shown', 'levels:started', 'progress:level_completed', 'nav:changed',
    ],
    owns: ['sound'],
    optional: ['storage', 'clock', 'view'],
    data: { rules: Rules, flags: Flags },
  },
  init(ctx) {
    const rules = ctx.data.rules as RulesT;
    const { defaultOn } = ctx.data.flags as v.InferOutput<typeof Flags>;
    const storage = ctx.service('storage');
    const view = ctx.service('view');
    const saved = storage?.get('sound');
    const enabled = typeof saved === 'object' && saved !== null && typeof (saved as { enabled?: unknown }).enabled === 'boolean'
      ? (saved as { enabled: boolean }).enabled
      : defaultOn;
    const Ctor: AudioCtor | undefined = typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext);
    let audio: AudioContext | null = null;
    let out: AudioNode | null = null;
    /** one panner per pan position, made once and reused, so a tap only allocates its oscillator and envelope */
    const panners = new Map<number, AudioNode>();
    /** the board being played: columns and real-cell count (from board:loaded; absent shape = classic 5×5) */
    let cols = 5;
    let cellCount = 25;
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

    // ---- audio ----
    /** created after a tap (levels:started or the first board tap), so the browser allows it */
    function ensure(): AudioContext | null {
      const st = ctx.read('sound')!;
      if (!st.enabled || st.status === 'unavailable') return null;
      if (audio) {
        if (audio.state === 'suspended') void audio.resume().catch(() => {});
        return audio;
      }
      try {
        audio = new Ctor!();
        const master = audio.createGain();
        master.gain.value = rules.volume;
        // a gentle lowpass takes the edge off the triangle wave: warm, not beepy
        const warm = audio.createBiquadFilter();
        warm.type = 'lowpass';
        warm.frequency.value = rules.lowpassHz;
        warm.Q.value = rules.lowpassQ;
        master.connect(warm).connect(audio.destination);
        out = master;
        ctx.write('sound', { ...st, status: 'ready' });
        ctx.report({ service: 'audio', mode: 'live', ok: true, detail: 'Sound is playing through Web Audio.' });
        return audio;
      } catch (err) {
        audio = null;
        ctx.write('sound', { ...st, status: 'unavailable' });
        ctx.report({ service: 'audio', mode: 'mock', ok: false, detail: 'This browser blocked sound, so the game plays silently.' });
        ctx.log.warn('Audio unavailable', err);
        return null;
      }
    }

    function panner(a: AudioContext, pan: number): AudioNode {
      let node = panners.get(pan);
      if (!node) {
        if (typeof a.createStereoPanner !== 'function') return out!; // older Safari: centred
        const p = a.createStereoPanner();
        p.pan.value = pan;
        p.connect(out!);
        node = p;
        panners.set(pan, node);
      }
      return node;
    }

    function blip(freq: number, o: Voice) {
      const a = ensure();
      if (!a || !out) return;
      const t = a.currentTime + (o.at ?? 0);
      const osc = a.createOscillator();
      const env = a.createGain();
      osc.type = o.type ?? 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (o.glide) osc.frequency.exponentialRampToValueAtTime(freq * (1 - o.glide), t + rules.tap.glideMs / 1000);
      if (o.detune) osc.detune.value = o.detune;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(o.gain, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      osc.connect(env).connect(o.pan ? panner(a, o.pan) : out);
      osc.start(t);
      osc.stop(t + o.dur + 0.02);
    }

    const phrase = (steps: readonly number[], p: { stepMs: number; ms: number; gain: number }, at = 0) =>
      steps.forEach((s, k) => blip(hz(s), { at: at + (k * p.stepMs) / 1000, dur: p.ms / 1000, gain: p.gain }));

    // Starting audio costs tens of milliseconds on some phones. Do it right after the tap that opens a
    // level (still inside the browser's user-activation window), so no board tap ever pays for it.
    const clock = ctx.service('clock');
    ctx.on('levels:started', () => {
      if (audio || !ctx.read('sound')!.enabled) return;
      if (clock) clock.setTimeout(() => { ensure(); }, 0);
    });

    ctx.on('board:loaded', ({ shape }) => {
      cols = shape?.cols ?? 5;
      cellCount = shape ? (shape.mask ? shape.mask.filter(Boolean).length : shape.cols * shape.rows) : 25;
    });

    ctx.on('board:pressed', ({ index, litCount }) => {
      if (litCount === 0) return; // the winning tap plays the solve phrase instead (board:solved)
      buzz(rules.haptics.tap);
      const centre = (cols - 1) / 2;
      const side = centre > 0 ? ((index % cols) - centre) / centre : 0; // -1 (left edge) … 1 (right edge)
      const step = STEPS[Math.min(STEPS.length - 1, Math.round((litCount * (STEPS.length - 1)) / cellCount))]!;
      const { tap } = rules;
      blip(hz(step), { dur: tap.ms / 1000, gain: tap.gain, type: 'triangle', glide: tap.glide, detune: side * tap.detuneCents, pan: Math.round(side * tap.pan * 100) / 100 });
    });
    ctx.on('board:solved', () => {
      buzz(rules.haptics.solved);
      phrase(rules.win.steps, rules.win);
    });
    ctx.on('board:undone', () => blip(hz(0), { dur: 0.05, gain: 0.3 }));
    ctx.on('board:restarted', () => phrase(rules.restart.steps, rules.restart));
    ctx.on('hints:shown', () => {
      buzz(rules.haptics.hint);
      blip(hz(19), { dur: 0.12, gain: 0.25 });
      blip(hz(24), { at: 0.06, dur: 0.16, gain: 0.2 });
    });

    // ---- star pings: one per earned star as the solved sheet shows them (either event may come first) ----
    const reduced = () => (view ? view.reducedMotion() : typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const maybePing = () => {
      if (!completed || completed.pinged || ctx.read('nav')?.sheet !== 'solved') return;
      const board = ctx.read('board');
      if (board && board.levelId !== null && board.levelId !== completed.levelId) return;
      completed.pinged = true;
      if (reduced()) return; // the stars appear all at once then, so nothing to keep time with
      const { stars } = rules;
      for (let k = 0; k < completed.stars; k++) blip(hz(24 + 2 * k), { at: (stars.startMs + k * stars.stepMs) / 1000, dur: stars.ms / 1000, gain: stars.gain });
    };
    ctx.on('progress:level_completed', ({ levelId, stars }) => { completed = { levelId, stars, pinged: false }; maybePing(); });
    ctx.on('nav:changed', ({ sheet }) => { if (sheet === 'solved') maybePing(); });

    ctx.on('sound:set', ({ enabled: on }) => {
      const st = ctx.read('sound')!;
      if (st.enabled === on) return;
      ctx.write('sound', { ...st, enabled: on });
      storage?.set('sound', { enabled: on });
      if (!on && audio && audio.state === 'running') void audio.suspend().catch(() => {});
      ctx.emit('sound:changed', { enabled: on });
      if (on) blip(hz(12), { dur: 0.08, gain: 0.3, type: 'triangle' });
    });

    return {
      stop() { void audio?.close().catch(() => {}); },
      debug: () => ({ cols, cellCount, haptics: canVibrate, panners: panners.size }),
      commands: { test: () => { blip(hz(12), { dur: 0.07, gain: 0.5, type: 'triangle' }); buzz(rules.haptics.tap); return ctx.read('sound'); } },
    };
  },
};
export default sound;
