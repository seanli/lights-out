# variety requests

1. **Design system: a legend strip.** The star legend under a board's first grid (`.variety__legend`, `.variety__legend-item`,
   `.variety__sep`, moved here from home) is the mockup's `.legend`. Tokens only; could move to `components.css` as `.legend`.
2. **Short landscape level grid:** `.variety .level-grid` goes 10 wide (rooms 6) under `(orientation: landscape) and (max-height: 540px)`
   so a 20-level chapter is two rows instead of four stretched ones. Could live in `components.css` next to `.level-grid`.
3. **`src/lib`: one board tally.** See home-view/requests.md #5 (`tally()` is duplicated in both modules).
4. **Design system: the level tile with a boss.** `variety.css` lays `.level-tile` out as a 3-row grid (number dead centre, a boss's
   `.skull` above, Play or stars below) and dims the skull on locked tiles. Could move into `components.css` as the tile's own layout
   with `[data-boss="true"]` states (open / current / solved / locked).
5. **Board notes as data.** See home-view/requests.md #7 ("scrolls" on the Tower is copy keyed by pack id).
