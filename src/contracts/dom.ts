// DOM hooks shared by views, the experience probe and the look-at-your-work script.
// Views MUST render these attributes; tooling relies on nothing else.
//
// Screens and sheets (set by the shell on region containers):
//   [data-screen="home"|"play"]      visible screen has no [hidden]
//   [data-sheet="solved"|...]        open sheet has no [hidden]
//
// Play screen (play-view):
//   [data-board]                     the grid; data-status="playing|solved", data-cols, data-rows
//   [data-cell][data-index="0..48"][data-lit="true|false"]   one button per REAL cell (index over the whole grid)
//   gaps of a shaped board render as an element with [data-gap] and NO data-cell (never a button)
//     data-hint="true"               on the hinted cell (hints slice)
//     data-pointer="true"            on the tutorial target (tutorial slice)
//   [data-moves]                     text content = moves so far (digits)
//   [data-par]                       text content = par (digits)
//   [data-level-label]               e.g. "Level 7"
//   [data-action="back"|"undo"|"restart"|"hint"]
//   [data-action="reference"]        header book button: toggles the in-game pattern reference; aria-expanded
//   [data-screen="play"][data-reference="open"|"closed"]   play layout makes room for the panel; the board stays playable
//
// In-game pattern reference (learn fills it, play-view places it): view.region('slot:reference')
//   [data-reference]                 root inside the slot
//   [data-reference-bottom] [data-mini-cell][data-index][data-lit]   live copy of the board's bottom row
//   [data-pattern-row][data-pattern="0,1,2"][data-match="true|false"]   the 7 bottom-row → top-row rows
//   [data-reference-status="chase|match|nomatch|clear"]   which advice is showing
//   [data-action="learn"] inside it  → learn:open {} (full lessons; Back returns to the level)
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
// Variety screen (variety):  [data-screen="variety"]
//   [data-room-tile][data-room="<pack id>"][data-stars="N"][data-solved="N"]   room list
//   [data-room-view="<pack id>"]  level tiles reuse [data-level-tile][data-level="<id>"][data-stars][data-locked][data-current]
//   [data-action="variety-back"]   back to the room list, or nav:back from the list
// Entry point: [data-action="variety"] on the home screen (disabled with a reason until it opens) → variety:open
//
// Learn screen (learn):  [data-screen="learn"]
//   [data-lesson-tile][data-lesson="<id>"][data-completed="true|false"]   lesson list
//   [data-lesson-view="<id>"]  [data-step="N"]   current lesson and step
//   [data-mini-board] [data-mini-cell][data-index][data-lit] (+ data-suggest="true")   practice board (NOT data-cell: that is the main board only)
//   [data-action="learn-back"|"learn-next"|"learn-prev"|"learn-practice"|"learn-assist"]
// Entry points: [data-action="learn"] on the home screen and inside the in-game reference → learn:open
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
