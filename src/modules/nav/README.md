# nav

Owns the `nav` slice: `{ screen: 'home' | 'play', sheet: null | 'solved' | 'confirm_reset' | 'complete' }`.
The shell watches this slice and shows the matching `screen:*` and `sheet:*` regions.

- `nav:go {screen}` → switches screen and closes any sheet.
- `nav:open_sheet {sheet}` / `nav:close_sheet` → opens or closes a sheet over the current screen.
- `levels:started` → shows the play screen with no sheet.
- Emits `nav:changed` only when something actually changed.

No data, no services. Delete it and the shell stays on the home screen.
