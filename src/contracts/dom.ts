// DOM hooks shared by views, the experience probe and the look-at-your-work script.
// Views MUST render these attributes; tooling relies on nothing else.
//
// Screens and sheets (set by the shell on region containers):
//   [data-screen="home"|"play"]      visible screen has no [hidden]
//   [data-sheet="solved"|...]        open sheet has no [hidden]
//
// Play screen (play-view):
//   [data-board]                     the 5×5 grid; data-status="playing|solved"
//   [data-cell][data-index="0..24"][data-lit="true|false"]   one button per cell
//     data-hint="true"               on the hinted cell (hints slice)
//     data-pointer="true"            on the tutorial target (tutorial slice)
//   [data-moves]                     text content = moves so far (digits)
//   [data-par]                       text content = par (digits)
//   [data-level-label]               e.g. "Level 7"
//   [data-action="back"|"undo"|"restart"|"hint"]
//
// Home screen (home-view):
//   [data-action="continue"]         starts the suggested level
//   [data-level-tile][data-level="N"][data-stars="0..3"][data-locked="true|false"][data-current="true|false"]
//   [data-action="sound"]            toggles sound; aria-pressed reflects state
//   [data-action="reset"]            opens the reset confirmation
//
// Solved sheet (solved-sheet):
//   [data-sheet="solved"] [data-stars-earned="1..3"]  [data-result]  (e.g. "6 moves · par 5")
//   [data-action="next"|"replay"|"levels"]
//
// Learn screen (learn):  [data-screen="learn"]
//   [data-lesson-tile][data-lesson="<id>"][data-completed="true|false"]   lesson list
//   [data-lesson-view="<id>"]  [data-step="N"]   current lesson and step
//   [data-mini-board] [data-mini-cell][data-index][data-lit] (+ data-suggest="true")   practice board (NOT data-cell: that is the main board only)
//   [data-action="learn-back"|"learn-next"|"learn-prev"|"learn-practice"|"learn-assist"]
// Entry points: [data-action="learn"] on the home screen and in the play header → learn:open
//
// Tutorial copy line (tutorial):  [data-tutorial]
// Shell notices:                  [data-notice="<id>"][data-tone="info|warn|error"]
// Debug console (console):        [data-console]  (only with #debug)
//
// Performance marks (shell): 'lo:interactive' after the first screen paints.
// Test hook (shell, only with #debug or in tests): window.__lightsOut = { debug: DebugService }

export const SEL = {
  screen: (name: string) => `[data-screen="${name}"]`,
  sheet: (name: string) => `[data-sheet="${name}"]`,
  board: '[data-board]',
  cell: (i: number) => `[data-cell][data-index="${i}"]`,
  cells: '[data-cell]',
  moves: '[data-moves]',
  par: '[data-par]',
  action: (name: string) => `[data-action="${name}"]`,
  levelTile: (n: number) => `[data-level-tile][data-level="${n}"]`,
  tutorial: '[data-tutorial]',
  notice: (id: string) => `[data-notice="${id}"]`,
} as const;
