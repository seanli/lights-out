# Lights Out

The classic 5×5 puzzle for phones: a tap flips a light and its neighbours, and you turn every light off. It has 50 levels in three chapters and earns 1–3 stars by moves against par. One-tap hints cost a star. Learn teaches the patterns that solve any board, and the in-game Patterns panel keeps the chase table next to your board.

- **Play offline / install:** https://seanli.github.io/lights-out/ (on a phone: Share → Add to Home Screen). It opens with no connection after the first visit.
- **Standalone file:** `npm run build` → `dist/index.html` plays from disk with no network.

## Develop

```sh
npm install
npm run dev          # local dev server
npm test             # unit + whole-game tests (Vitest)
npm run typecheck    # TypeScript 7
npm run build        # dist/index.html (standalone) + dist/artifact.html
npm run build:pwa    # dist-pwa/ + lights-out-offline.zip (manifest, icons, service worker)
npm run probe        # scripted player: 14 experience targets on the built page
npm run look -- --state play:7 --widths 375,768,1440   # screenshots of a state
```

Add `#debug` to the URL for the debug console (state, events, log, modules, services, snapshots, commands such as `levels.start 12`, `board.win`, `progress.unlock 20`).

## How it's built

There is a tiny kernel (event bus, store, boot order, data loader), and every feature is a module in `src/modules/<name>/` that talks to the rest only through `ctx`. Rules, tuning and every sentence live in `data/*.json`. See `CLAUDE.md` for the rules, `ARCHITECTURE.md` (generated) for who owns and reacts to what, and `DECISIONS.md` for why things are the way they are.

**Adding a feature** means adding a module:
1. Create `src/modules/<name>/index.ts` exporting `{ manifest, init(ctx) }` (copy `src/modules/nav`).
2. Declare its events in the manifest and any new payloads in `src/contracts/events.ts`; add a slice to `src/contracts/entities.ts` if it owns state.
3. Put its tunables and copy in its own section of `data/*.json` (mirror to `test/fixtures/data`).
4. Write `<name>.test.ts` with `bootModule()` from `test/fake-ctx.ts`, plus a README under 20 lines.
5. `npm run check`. The shell finds the module by its folder; deleting the folder removes it cleanly.

Fonts: Fraunces and Manrope (SIL OFL 1.1), subset and bundled.
