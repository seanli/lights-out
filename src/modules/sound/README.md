# sound

Device feedback: synthesized tones (Web Audio) and haptic ticks (`navigator.vibrate`). Owns the `sound` slice: `{ enabled, status: 'idle' | 'ready' | 'unavailable' }`. One switch for both.

- Tones go through a 2.4kHz lowpass, so they read as warm glass rather than beeps. A tap is a triangle blip that glides down 4%. Its pitch follows the share of lights still on, so the line descends toward the solve. Detune and pan follow the column (`board:loaded` shape, absent = 5 columns), with one panner per column made once.
- The winning tap plays the arpeggio instead of a blip. Restart plays two soft falling notes; undo a low click; a hint a chime.
- Star pings: when the solved sheet is open (`nav:changed`) and `progress:level_completed` has been seen, in either order, one ping per earned star, timed from `rules.json → sound.stars`. They are skipped under reduced motion, because the stars appear at once then.
- Haptics: tap 8ms, hint 6ms, solve pattern (`rules.json → sound.haptics`). Nothing for undo/restart. Silent where `vibrate` is missing (iOS, desktop); `ctx.report('haptics')` says which.
- The AudioContext is created right after `levels:started` (decision 26) or on the first tap. `sound:set {enabled}` toggles and remembers (storage key `sound`), then emits `sound:changed`.
- Default from `flags.json → sound.defaultOn`. If the browser refuses audio, status becomes `unavailable` and the game stays silent.

Optional services: `storage`, `clock`, `view` (reduced motion).
