# nav

Owns the `nav` slice: `{ screen: 'home' | 'play' | 'learn', sheet: null | 'solved' | 'confirm_reset' | 'complete', previous }`.
The shell watches this slice and shows the matching `screen:*` and `sheet:*` regions.

- `nav:go {screen}` → switches screen, closes any sheet, remembers where you came from.
- `nav:back` → returns to the remembered screen (home if none). Learn uses it so a level in progress resumes.
- `nav:open_sheet {sheet}` / `nav:close_sheet` → opens or closes a sheet over the current screen.
- `levels:started` → shows the play screen with no sheet.
- Emits `nav:changed` only when something actually changed.

No data, no services. Delete it and the shell stays on the home screen.
