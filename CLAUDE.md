# Lights Out — working rules

Phone-first Lights Out: one menu of boards (Classic 5×5, Tall 5×6, Wide 6×6, Great hall 7×7, Cross, Ring, Diamond, and the extreme Ballroom 8×8, Cathedral 10×10, Tower 6×16), levels in bands of ten with a skull boss every 10th, 1–3 stars by moves vs par, one-tap hints that cost a star, a guide per board.
Ships as ONE self-contained HTML file: `dist/artifact.html` (published as a Claude artifact), `dist/index.html` (standalone, works offline from disk), and `dist-pwa/` (installable, offline via service worker).

## Principles
- **Experience first.** The architecture serves what the player touches. Green tests are not a good product: run the probe and look at the screen.
- **Simple:** few concepts, one obvious owner per responsibility, consistent behaviour, easy debugging.
- **Everything earns its place.** Add nothing without a clear payoff.
- **Find before you build.** Prefer mature libraries; check licence, maintenance and current version (look it up, never recall it).
- **Contracts first.** `src/contracts` is frozen; changes go through the lead in batches.
- **Bend a rule that hurts the product,** and say so.

## Architecture
- **Kernel** (`src/kernel`): registry, run-to-completion event bus, plain-data store with snapshots, dependency-ordered boot (`kernel:booted`, then `kernel:state_loaded`), logger, data loader that validates every module's data before any init. Nothing else belongs here.
- **Shell** (`src/shell`): entry point, the `view` and `env` services, module discovery (`import.meta.glob` over `src/modules/*/index.ts`), and the design system in `src/shell/styles` (tokens + one component per kind with all its states). Modules never hard-code colours or sizes.
- **Modules** (`src/modules/<name>/`): `index.ts` default-exports `{ manifest, init(ctx) }`; a `README.md` under 20 lines; a `<name>.test.ts` that boots the module alone with `bootModule()` from `test/fake-ctx.ts`; a `requests.md` for contract changes you need.
  - `ctx` is the only way out. Modules never import each other. They may import `src/contracts`, `src/lib` (pure helpers) and npm packages.
  - No module-level state: everything lives in the instance returned by `init` or in the store.
  - Declare every event you emit or listen to in the manifest (the kernel warns otherwise).
  - Deleting a module folder breaks nothing (`test/boot-all.test.ts` proves it for every module).
- **Contracts** (`src/contracts`): `entities.ts` (valibot schemas → types, one per entity/slice), `events.ts` (payloads), `services.ts`, `kernel.ts` (Manifest, Ctx), `dom.ts` (DOM hooks for views and tooling).
- **Events:** commands imperative (`board:press`), facts past tense (`board:pressed`). Handlers never depend on order; put what a reaction needs in the payload or react to the follow-up fact. A command emitted inside a handler runs after the current event finishes. A refused command emits `<module>:refused` with a reason.
- **State:** each slice has one writer (the module of the same name); anyone may read. Values are frozen plain data: replace, never mutate. Anything with a lifecycle has a `status`. Timers, DOM nodes and functions stay out of the store. Watchers run after the event completes.
- **Outside services** (browser storage, Web Audio, service worker): each wrapped by one module, with a mock/fallback mode that the UI states in plain words, a startup check reported via `ctx.report()`, and errors in the player's words.
- **Data** (`data/*.json`): rules and tuning in `rules.json`, every sentence in `copy.json`, switches in `flags.json`, one section per owning module, validated by the module's manifest schemas. Presentation stays in code. Module tests use the frozen copy in `test/fixtures/data`.
- **Replay:** seeded RNG (`rng`), `clock` service, seeded `ids`; snapshot + input log reproduces a session (`src/kernel/replay.ts`).
- **Debug console:** `#debug` in the URL (the artifact frame only passes a plain hash). `window.__lightsOut.debug` exists only then.
- No tick loop: nothing is real-time. Animation is CSS.

## Guardrails
- Stay small: no frameworks, no plugin system. A 50-line helper beats a dependency; a dependency beats a 500-line rewrite.
- One commit per integration; typecheck, tests, build and probe must pass (`npm run check`). Never build on red. Regenerate `ARCHITECTURE.md` with `npm run arch`.
- Every release bumps `package.json` version (minor for features, patch for fixes); home shows it at the bottom.
- Test behaviour, not structure: critical flows, recovery, data integrity, regressions.
- Ask the lead before: breaking kernel/contract changes, changing saved-data shapes (version + migrate), changing a decided behaviour (see DECISIONS.md), removing a feature, anything destructive.
- Git: commit with explicit paths, never `git add -A`. Builders change nothing outside their module folder (plus their own data sections).
- The page runs inside a sandboxed frame: no network at all (everything bundled), `localStorage` may throw (wrap in try/catch), no `alert/confirm/prompt`, no service worker except in the PWA build, sound only after a user gesture.

## Conventions
- Copy templates use `{name}` placeholders filled with `fmt()` from `src/lib/dom.ts`.
- DOM: views render the attributes in `src/contracts/dom.ts`; tooling relies on nothing else.
- Cells are indexed row-major over the board's grid (`row * cols + col`, gaps included); `true` = lit.
- Stars: 3★ at par, 2★ within par+3, 1★ any solve; each hint −1★, never below 1★ (numbers in `rules.json → progress`).
- Commands: `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`, `npm run build:pwa`, `npm run probe`, `npm run look -- --help`.
