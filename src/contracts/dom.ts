// DOM hooks shared by views, the experience probe and the look-at-your-work script.
// Views MUST render these attributes; tooling relies on nothing else.
//
// Screens and sheets (set by the shell on region containers):
//   [data-screen="home"|"play"]      visible screen has no [hidden]
//   [data-sheet="solved"|...]        open sheet has no [hidden]
//
// Play screen (play-view):
//   [data-board]                     the grid; data-status="playing|solved", data-cols, data-rows
//     data-scroll="true"             the board is taller than the screen (the Tower): it scrolls, a swipe never presses,
//                                    a press lands on release; data-more-above / data-more-below="true" where there is
//                                    more to scroll (that edge fades)
//     data-aim="true"                touch slots are under the tap minimum (10×10, 8×8 on narrow phones): press-and-hold
//                                    shows [data-aim-bubble] magnifying the target; slide to adjust; lift to press
//   [data-boss="true"]               on the play header when the level is a boss (skull shown)
//   [data-cell][data-index="0..159"][data-lit="true|false"]   one button per REAL cell (index over the whole grid)
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
//   [data-reference-bottom] [data-mini-cell][data-index][data-lit]   live copy of the board's bottom row (classic and every
//                                    full rectangle; real grid indexes)
//   [data-pattern-row][data-match="true|false"][data-pattern="0,1,2"]   classic: the live row → its top taps (data-pattern
//                                    names the matched table row; the full table lives in lesson 4, not the panel)
//   [data-reference-status="chase|match|nomatch|clear"]   which advice is showing
//   [data-reference-kind="classic|rect|shaped"]  [data-reference-rule]  the one-line rule beside the match
//   [data-action="learn"] inside it  → learn:open {} (full lessons; Back returns to the level)
//
// Home screen (home-view): one menu, every board its own row (The Good Sudoku pattern)
//   [data-action="continue"]         starts the suggested level (the board last played, else classic)
//   [data-room-tile][data-room="<pack id>"][data-solved="N"][data-stars="N"][data-locked="true|false"]
//                                    one row per pack in levels.packs order, classic first → variety:open {room}
//   [data-group="boards|shapes|extreme"]  the menu section holding a pack's row (from Pack.group)
//   [data-action="learn"]            → learn:open {}
//   [data-action="sound"]            toggles sound; aria-pressed reflects state
//   [data-action="reset"]            opens the reset confirmation
//
// Solved sheet (solved-sheet):
//   [data-sheet="solved"] [data-stars-earned="1..3"]  [data-result]  (e.g. "6 moves · par 5")
//     data-boss="true" on the sheet after a boss level
//   [data-action="next"|"replay"|"levels"]
//
// Board screen (variety): one board's levels, classic included  [data-screen="variety"]
//   [data-room-view="<pack id>"]     classic groups its tiles into chapters ([data-chapter]); rooms are one grid
//   [data-level-tile][data-level="<global id>"][data-stars="0..3"][data-locked="true|false"][data-current="true|false"]
//     data-boss="true"               every 10th level: drawn with a skull
//   [data-action="variety-back"]     → back to where the player came from (the menu)
//   [data-action="guide"]            → learn:open {lessonId: "guide-<pack id>"} (classic: learn:open {}); only while learn runs
//
// Learn screen (learn):  [data-screen="learn"]
//   [data-lesson-tile][data-lesson="<id>"][data-completed="true|false"]   lesson list
//   [data-lesson-view="<id>"]  [data-step="N"]   current lesson and step
//   [data-mini-board] [data-mini-cell][data-index][data-lit] (+ data-suggest="true")   practice board (NOT data-cell: that is the main board only)
//   [data-action="learn-back"|"learn-next"|"learn-prev"|"learn-practice"|"learn-assist"|"learn-demo"]
//   board guides on big boards: [data-mini-board="practice"][data-aim="true|false"] (aim bubble mode, src/lib/aim.ts),
//     [data-tall="true"] (the Tower: scrolls with the page, presses on release), [data-aimed="true"] on the aimed mini cell
//   lesson 4: [data-action="learn-echo"][data-col="0..4"] (pick a top cell), [data-action="learn-deeper"] (Go deeper),
//             [data-action="learn-drill"] with [data-drill="idle|asking|right|wrong|done"]
//   board guides: [data-lesson-tile][data-lesson="guide-<pack id>"] (one per room; classic's guide is the five lessons)
// Entry points: [data-action="learn"] on the home screen and inside the in-game reference → learn:open;
//               [data-action="guide"] on a board screen and inside the in-game reference → learn:open {lessonId}
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
  roomTile: (id: string) => `[data-room-tile][data-room="${id}"]`,
  tutorial: '[data-tutorial]',
  notice: (id: string) => `[data-notice="${id}"]`,
} as const;
