// Switch sounds, synthesised as plain sample math into Float32Arrays. The module renders them once at
// warm-up, so a tap only plays a finished buffer. Pure: no Web Audio, no DOM; the caller passes the
// random source. Every `decayMs` is the time a part takes to fall 60 dB.
import * as v from 'valibot';

const pos = v.pipe(v.number(), v.minValue(0));
const hz = v.pipe(v.number(), v.minValue(20), v.maxValue(20000));
const gain = v.pipe(v.number(), v.minValue(0), v.maxValue(4));
const unit = v.pipe(v.number(), v.minValue(0), v.maxValue(1));
/** a finished sound's peak; nothing may be louder than -6 dBFS */
const peakDb = v.pipe(v.number(), v.maxValue(-6));

/** a ringing resonance (the plastic, the box) */
const Mode = v.object({ hz, decayMs: pos, gain });
/** a switch click: a filtered-noise snap with its plastic modes, a low body thump, a mid box resonance, a soft thud, sometimes a latch tick */
export const ClickSchema = v.object({
  peakDb: v.optional(peakDb),
  snap: v.object({ hp: hz, lp: hz, attackMs: pos, decayMs: pos, gain, modes: v.array(Mode) }),
  /** starts `drop` sharp and settles within a few ms */
  body: v.optional(v.object({ hz, decayMs: pos, drop: pos, gain })),
  box: v.optional(Mode),
  thud: v.optional(v.object({ lp: hz, decayMs: pos, gain })),
  latch: v.optional(v.object({ chance: unit, minMs: pos, maxMs: pos, hp: hz, lp: hz, decayMs: pos, gain })),
});
/** the faint ticks of the neighbours flipping, mixed into each tap take */
export const TicksSchema = v.object({ atMs: v.array(pos), gain, hp: hz, lp: hz, decayMs: pos, box: v.optional(Mode) });
/** a glass tick: a tiny transient and inharmonic partials */
export const GlassSchema = v.object({
  hz: v.pipe(v.array(hz), v.minLength(1)),
  partials: v.array(v.object({ ratio: pos, gain, decayMs: pos })),
  tick: gain, tickHp: hz, tickLp: hz, attackMs: pos, peakDb,
});
/** the win: relay clicks spreading with the sweep, then a warm chord swelling up */
export const WinSchema = v.object({
  relays: v.pipe(v.number(), v.integer(), v.minValue(1)),
  startMs: pos, spanMs: pos, curve: pos, jitterMs: pos,
  relayGain: v.tuple([gain, gain]),
  /** relays tune up by this share from the first to the last */
  rise: pos,
  pan: unit,
  chord: v.pipe(v.array(hz), v.minLength(1)),
  voiceGain: v.array(gain),
  partials: v.array(v.object({ ratio: pos, gain })),
  detuneCents: pos,
  swellAtMs: pos, attackMs: pos, decayMs: pos, lp: hz, swellGain: gain, peakDb,
});
export const UndoSchema = v.object({ revMs: pos, lp: hz, peakDb });
export const RestartSchema = v.object({ flicks: v.array(v.object({ click: v.picklist(['on', 'off']), atMs: pos, db: v.number() })), peakDb });

export type Click = v.InferOutput<typeof ClickSchema>;
export type Ticks = v.InferOutput<typeof TicksSchema>;
export type Glass = v.InferOutput<typeof GlassSchema>;
export type Win = v.InferOutput<typeof WinSchema>;
export type Undo = v.InferOutput<typeof UndoSchema>;
export type Restart = v.InferOutput<typeof RestartSchema>;
export type Rnd = () => number;
/** mono, or [left, right] */
export type Sound = Float32Array | [Float32Array, Float32Array];

const TAU = Math.PI * 2;
const LN1000 = Math.log(1000); // e^(-t/tau) is 60 dB down at t = tau * ln(1000)
export const db2a = (db: number) => 10 ** (db / 20);

/** RBJ biquad lowpass / highpass, in place */
function biquad(x: Float32Array, type: 'lp' | 'hp', f: number, q: number, sr: number) {
  const w = (TAU * Math.min(f, sr * 0.45)) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  const a0 = 1 + al;
  const b0 = (type === 'lp' ? (1 - c) / 2 : (1 + c) / 2) / a0, b1 = (type === 'lp' ? 1 - c : -(1 + c)) / a0, b2 = b0;
  const a1 = (-2 * c) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i], y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = y;
    x[i] = y;
  }
  return x;
}
export function peakOf(x: Float32Array) {
  let p = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; }
  return p;
}
function scaleTo(x: Float32Array, peak: number) {
  const p = peakOf(x);
  if (p > 0) { const k = peak / p; for (let i = 0; i < x.length; i++) x[i] *= k; }
  return x;
}
function mixInto(out: Float32Array, src: Float32Array, at: number, g: number) {
  const n = Math.min(src.length, out.length - at);
  for (let i = 0; i < n; i++) out[at + i] += src[i] * g;
}

/** a band of noise: near-instant attack, exponential decay, scaled to peak `g` */
function noiseBurst(sr: number, o: { hp?: number; lp?: number; attackMs: number; decayMs: number; gain: number }, rnd: Rnd) {
  const ta = o.attackMs / 1000, td = o.decayMs / 1000 / LN1000;
  const b = new Float32Array(Math.ceil(sr * (ta + o.decayMs / 1000 + 0.004)));
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    b[i] = (rnd() * 2 - 1) * (t < ta ? t / ta : Math.exp(-(t - ta) / td));
  }
  if (o.hp) biquad(b, 'hp', o.hp, 0.707, sr);
  if (o.lp) biquad(b, 'lp', o.lp, 0.707, sr);
  return scaleTo(b, o.gain);
}

/** a damped sine; `drop` starts it that share sharp, settling over ~4ms (a thump's pitch falls) */
function modeInto(out: Float32Array, sr: number, at: number, f: number, decayMs: number, g: number, o: { attackMs?: number; drop?: number; phase?: number } = {}) {
  const n = Math.min(out.length - at, Math.ceil((sr * decayMs) / 1000));
  const td = decayMs / 1000 / LN1000, ta = (o.attackMs ?? 0.05) / 1000, drop = o.drop ?? 0;
  const k = Math.exp(-1 / (sr * td)), kd = Math.exp(-1 / (sr * 0.004)); // per-sample decays: the level, the pitch drop
  const w = (TAU * f) / sr, attack = Math.ceil(ta * sr);
  let ph = o.phase ?? 0, env = 1, sharp = drop;
  for (let i = 0; i < n; i++) {
    ph += w * (1 + sharp);
    sharp *= kd;
    out[at + i] += g * (i < attack ? 0.5 - 0.5 * Math.cos((Math.PI * i) / attack) : 1) * env * Math.sin(ph);
    env *= k;
  }
}

/** DC block, then the ceiling: two 2-pole lowpasses, so nothing harsh sits above it */
function shape(x: Float32Array, sr: number, ceilingHz: number) {
  biquad(x, 'hp', 30, 0.707, sr);
  biquad(x, 'lp', ceilingHz, 0.707, sr);
  return biquad(x, 'lp', ceilingHz, 0.707, sr);
}
/** cut the tail once it stays 70 dB under the peak, with a 1.5ms fade */
function trim(x: Float32Array, sr: number) {
  const floor = peakOf(x) * db2a(-70);
  let last = x.length - 1;
  while (last > 0 && Math.abs(x[last]) < floor) last--;
  const end = Math.min(x.length, last + Math.ceil(sr * 0.002));
  const y = x.slice(0, end), f = Math.min(end, Math.ceil(sr * 0.0015));
  for (let i = 0; i < f; i++) y[end - 1 - i] *= i / f;
  return y;
}

/** run a sliced render to the end in one go */
export function drain<T>(g: Generator<void, T, void>): T {
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

/**
 * One click, peak 1, in a few slices (the warm-up yields between them). `tune` scales every frequency;
 * `vary` jitters filters and resonances by up to that share.
 */
export function* clickParts(sr: number, c: Click, rnd: Rnd, ceilingHz: number, o: { tune?: number; vary?: number; ticks?: Ticks } = {}): Generator<void, Float32Array, void> {
  const tune = o.tune ?? 1, vary = o.vary ?? 0;
  const j = (f: number, amt = vary) => f * tune * (1 + (rnd() * 2 - 1) * amt);
  const s = c.snap, t = o.ticks, l = c.latch;
  // as long as the longest part (plus filter ringing), not a fixed length: the filters run over every sample
  const endMs = Math.max(
    s.attackMs + s.decayMs, ...s.modes.map((m) => m.decayMs), c.body?.decayMs ?? 0, c.box?.decayMs ?? 0, c.thud?.decayMs ?? 0,
    l ? l.maxMs + l.decayMs : 0, t ? Math.max(0, ...t.atMs) + Math.max(t.decayMs, t.box?.decayMs ?? 0) : 0,
  );
  const out = new Float32Array(Math.ceil((sr * (endMs + 8)) / 1000));
  mixInto(out, noiseBurst(sr, { hp: j(s.hp), lp: j(s.lp), attackMs: s.attackMs, decayMs: s.decayMs, gain: s.gain }, rnd), 0, 1);
  for (const m of s.modes) modeInto(out, sr, 0, j(m.hz, vary * 0.6), m.decayMs, m.gain, { phase: rnd() * TAU });
  yield;
  if (c.body) modeInto(out, sr, 0, j(c.body.hz, vary * 0.6), c.body.decayMs, c.body.gain, { attackMs: 0.6, drop: c.body.drop });
  if (c.box) modeInto(out, sr, 0, j(c.box.hz), c.box.decayMs, c.box.gain, { attackMs: 0.3, phase: rnd() * TAU });
  if (c.thud) mixInto(out, noiseBurst(sr, { lp: j(c.thud.lp), attackMs: 0.4, decayMs: c.thud.decayMs, gain: c.thud.gain }, rnd), 0, 1);
  yield;
  if (l && rnd() < l.chance) {
    const at = Math.round((sr * (l.minMs + (l.maxMs - l.minMs) * rnd())) / 1000);
    mixInto(out, noiseBurst(sr, { hp: j(l.hp), lp: j(l.lp), attackMs: 0.08, decayMs: l.decayMs, gain: l.gain }, rnd), at, 1);
  }
  if (t) t.atMs.forEach((ms, k) => {
    const at = Math.round((sr * ms) / 1000), g = t.gain * (1 - 0.18 * k);
    mixInto(out, noiseBurst(sr, { hp: j(t.hp), lp: j(t.lp), attackMs: 0.08, decayMs: t.decayMs, gain: g }, rnd), at, 1);
    if (t.box) modeInto(out, sr, at, j(t.box.hz), t.box.decayMs, g * t.box.gain, { attackMs: 0.2 });
  });
  yield;
  return trim(scaleTo(shape(out, sr, ceilingHz), 1), sr);
}
export const renderClick = (...a: Parameters<typeof clickParts>) => drain(clickParts(...a));

/** a tap take: a varied click (with the neighbours' ticks), at the click's peak level */
export function* takeParts(sr: number, c: Click, rnd: Rnd, ceilingHz: number, vary: number, ticks?: Ticks): Generator<void, Float32Array, void> {
  return scaleTo(yield* clickParts(sr, c, rnd, ceilingHz, { vary, ticks }), db2a(c.peakDb ?? -12));
}
export const renderTake = (...a: Parameters<typeof takeParts>) => drain(takeParts(...a));

/** a glass tick at `f` (partials 1 : 2.32 : 4.25 are a small glass) */
export function renderGlass(sr: number, g: Glass, f: number, rnd: Rnd, ceilingHz: number) {
  const out = new Float32Array(Math.ceil((sr * (Math.max(0, ...g.partials.map((p) => p.decayMs)) + 12)) / 1000));
  if (g.tick) mixInto(out, noiseBurst(sr, { hp: g.tickHp, lp: g.tickLp, attackMs: 0.05, decayMs: 1.2, gain: g.tick }, rnd), 0, 1);
  for (const p of g.partials) modeInto(out, sr, 0, f * p.ratio, p.decayMs, p.gain, { attackMs: g.attackMs });
  return trim(scaleTo(shape(out, sr, ceilingHz), db2a(g.peakDb)), sr);
}

/** undo: the off click cut short and played backwards, so it swells into its snap; darker */
export function renderUndo(sr: number, u: Undo, off: Click, rnd: Rnd, ceilingHz: number) {
  const c = renderClick(sr, { ...off, latch: undefined }, rnd, ceilingHz);
  const n = Math.min(c.length, Math.round((sr * u.revMs) / 1000)), fade = Math.ceil(sr * 0.003);
  const out = new Float32Array(n + Math.ceil(sr * 0.008));
  for (let i = 0; i < n; i++) out[n - 1 - i] = c[i] * Math.min(1, (n - 1 - i) / fade);
  biquad(out, 'lp', u.lp, 0.707, sr);
  return trim(scaleTo(out, db2a(u.peakDb)), sr);
}

/** restart: a quick double flick */
export function renderRestart(sr: number, r: Restart, clicks: { on: Click; off: Click }, rnd: Rnd, ceilingHz: number) {
  const out = new Float32Array(Math.ceil((sr * (Math.max(0, ...r.flicks.map((f) => f.atMs)) + 140)) / 1000));
  for (const f of r.flicks) mixInto(out, renderClick(sr, clicks[f.click], rnd, ceilingHz), Math.round((sr * f.atMs) / 1000), db2a(f.db));
  return trim(scaleTo(out, db2a(r.peakDb)), sr);
}

/**
 * The win, in slices: one relay per step, then the swell `chunk` samples per step, so building it never
 * holds the main thread for long. Stereo: the relays spread outward, the swell sits in the middle.
 */
export function* renderWin(sr: number, w: Win, relay: Click, rnd: Rnd, ceilingHz: number, chunk = 512): Generator<void, [Float32Array, Float32Array], void> {
  const n = Math.ceil((sr * (w.swellAtMs + w.attackMs + w.decayMs + 40)) / 1000);
  const left = new Float32Array(n), right = new Float32Array(n);
  for (let k = 0; k < w.relays; k++) {
    const u = w.relays > 1 ? k / (w.relays - 1) : 0;
    const ms = w.startMs + w.spanMs * u ** w.curve + (k ? (rnd() * 2 - 1) * w.jitterMs : 0);
    const c = yield* clickParts(sr, relay, rnd, ceilingHz, { tune: 1 + w.rise * u, vary: 0.03 });
    const g = w.relayGain[0] + (w.relayGain[1] - w.relayGain[0]) * u;
    const a = (((k % 2 ? 1 : -1) * w.pan * u + 1) * Math.PI) / 4; // equal-power pan
    const at = Math.max(0, Math.round((sr * ms) / 1000));
    mixInto(left, c, at, g * Math.cos(a));
    mixInto(right, c, at, g * Math.sin(a));
    yield;
  }
  // every partial is a rotating phasor (no sin() per sample) under one shared envelope
  const osc: { c: number; s: number; x: number; y: number; amp: number }[] = [];
  w.chord.forEach((f0, voice) => [-1, 1].forEach((d) => w.partials.forEach((p) => {
    const f = f0 * p.ratio * 2 ** ((d * w.detuneCents) / 2400);
    if (f >= sr * 0.45) return;
    const step = (TAU * f) / sr, ph = rnd() * TAU;
    osc.push({ c: Math.cos(step), s: Math.sin(step), x: Math.cos(ph), y: Math.sin(ph), amp: (w.voiceGain[voice] ?? w.voiceGain[w.voiceGain.length - 1] ?? 1) * p.gain });
  })));
  const swell = new Float32Array(n), start = Math.round((sr * w.swellAtMs) / 1000);
  const attack = Math.round((sr * w.attackMs) / 1000), k = Math.exp(-LN1000 / ((sr * w.decayMs) / 1000));
  let env = 1;
  for (let i = start; i < n; i += chunk) {
    const end = Math.min(n, i + chunk);
    for (let s = i; s < end; s++) {
      const t = s - start;
      let e: number;
      if (t < attack) e = 0.5 - 0.5 * Math.cos((Math.PI * t) / attack);
      else { e = env; env *= k; }
      let sum = 0;
      for (const o of osc) {
        const x = o.x * o.c - o.y * o.s;
        o.y = o.x * o.s + o.y * o.c;
        o.x = x;
        sum += o.amp * o.y;
      }
      swell[s] = sum * e;
    }
    yield;
  }
  // the tail runs once, so it goes through the helpers the clicks have already made hot, a step each
  scaleTo(biquad(swell, 'lp', w.lp, 0.707, sr), w.swellGain);
  yield;
  mixInto(left, swell, 0, Math.SQRT1_2);
  mixInto(right, swell, 0, Math.SQRT1_2);
  yield;
  const scale = db2a(w.peakDb) / Math.max(peakOf(left), peakOf(right), 1e-9);
  scaleTo(left, peakOf(left) * scale);
  scaleTo(right, peakOf(right) * scale);
  return [left, right];
}
