// sound: soft synthesized clicks and a small chord on a solve. Web Audio only starts after a tap.
import * as v from 'valibot';
import type { ModuleDef } from '../../contracts';

const Rules = v.object({ volume: v.pipe(v.number(), v.minValue(0), v.maxValue(1)) });
const Flags = v.object({ defaultOn: v.boolean() });

// pentatonic steps so any run of taps sounds musical
const STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const BASE_HZ = 220;
const hz = (step: number) => BASE_HZ * 2 ** (step / 12);

type AudioCtor = typeof AudioContext;

const sound: ModuleDef = {
  manifest: {
    name: 'sound',
    emits: ['sound:changed'],
    listens: ['sound:set', 'board:pressed', 'board:undone', 'board:solved', 'hints:shown', 'levels:started'],
    owns: ['sound'],
    optional: ['storage', 'clock'],
    data: { rules: Rules, flags: Flags },
  },
  init(ctx) {
    const { volume } = ctx.data.rules as v.InferOutput<typeof Rules>;
    const { defaultOn } = ctx.data.flags as v.InferOutput<typeof Flags>;
    const storage = ctx.service('storage');
    const saved = storage?.get('sound');
    const enabled = typeof saved === 'object' && saved !== null && typeof (saved as { enabled?: unknown }).enabled === 'boolean'
      ? (saved as { enabled: boolean }).enabled
      : defaultOn;
    const Ctor: AudioCtor | undefined = typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext);
    let audio: AudioContext | null = null;
    let master: GainNode | null = null;

    ctx.write('sound', { enabled, status: Ctor ? 'idle' : 'unavailable' });

    /** created lazily inside a tap's handler, so the browser allows it */
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
        master.gain.value = volume;
        master.connect(audio.destination);
        ctx.write('sound', { ...st, status: 'ready' });
        ctx.report({ service: 'audio', mode: 'live', ok: true, detail: 'Sound is playing through Web Audio.' });
        return audio;
      } catch (err) {
        ctx.write('sound', { ...st, status: 'unavailable' });
        ctx.report({ service: 'audio', mode: 'mock', ok: false, detail: 'This browser blocked sound, so the game plays silently.' });
        ctx.log.warn('Audio unavailable', err);
        return null;
      }
    }

    function blip(freq: number, at = 0, dur = 0.07, gain = 0.5, type: OscillatorType = 'triangle') {
      const a = ensure();
      if (!a || !master) return;
      const t = a.currentTime + at;
      const osc = a.createOscillator();
      const env = a.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(gain, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(env).connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }

    // Starting audio costs tens of milliseconds on some phones. Do it right after the tap that opens a
    // level (still inside the browser's user-activation window), so no board tap ever pays for it.
    const clock = ctx.service('clock');
    ctx.on('levels:started', () => {
      if (audio || !ctx.read('sound')!.enabled) return;
      if (clock) clock.setTimeout(() => { ensure(); }, 0);
    });

    ctx.on('board:pressed', ({ litCount }) => blip(hz(STEPS[Math.min(STEPS.length - 1, Math.round(litCount / 2.5))]!)));
    ctx.on('board:undone', () => blip(hz(0), 0, 0.05, 0.3, 'sine'));
    ctx.on('hints:shown', () => { blip(hz(19), 0, 0.12, 0.25, 'sine'); blip(hz(24), 0.06, 0.16, 0.2, 'sine'); });
    ctx.on('board:solved', () => [12, 16, 19, 24].forEach((s, i) => blip(hz(s), 0.09 * i, 0.35, 0.35, 'sine')));
    ctx.on('sound:set', ({ enabled: on }) => {
      const st = ctx.read('sound')!;
      if (st.enabled === on) return;
      ctx.write('sound', { ...st, enabled: on });
      storage?.set('sound', { enabled: on });
      if (!on && audio && audio.state === 'running') void audio.suspend().catch(() => {});
      ctx.emit('sound:changed', { enabled: on });
      if (on) blip(hz(12), 0, 0.08, 0.3);
    });

    return {
      stop() { void audio?.close().catch(() => {}); },
      commands: { test: () => { blip(hz(12)); return ctx.read('sound'); } },
    };
  },
};
export default sound;
