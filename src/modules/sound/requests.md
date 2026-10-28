# Requests for the lead

1. **Page weight cap (probe target 13).** The synthesised switch adds +9.1KB raw / +2.9KB gzip (synth 6.6KB, data 2.4KB minified). `dist/artifact.html` is 288.5KB (gzip 103.9KB); the base (8f44aca) was 279.4KB, 0.6KB under the 280KB raw cap. The gzip cap (105KB) still passes. Proposal: raise the raw cap to 300KB and keep gzip ≤ 105KB, since gzip is what travels.
2. **DECISIONS.md row 16** still says "pentatonic blips by lit count, chord on solve". Proposed text: "Sound on by default; a synthesised wall switch (on brighter than off, neighbour ticks), relays and a warm swell on solve, glass ticks for stars and hints; mute remembered."
