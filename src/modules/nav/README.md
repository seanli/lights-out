# nav

Owns the `nav` slice: `{ screen: 'home' | 'variety' | 'play' | 'learn', sheet: null | 'solved' | 'confirm_reset' | 'complete', previous }`.
The shell watches this slice and shows the matching `screen:*` and `sheet:*` regions.

- `nav:go {screen}` → switches screen, closes any sheet, adds the old screen to the trail (or, going to a screen already
  on the trail, drops what came after it). `previous` is the trail's last screen; the trail lives in the instance.
- `nav:back` → walks the trail back one screen (home when it is empty): menu → board → level → Learn and back again.
- `nav:open_sheet {sheet}` / `nav:close_sheet` → opens or closes a sheet over the current screen.
- `levels:started` → shows the play screen with no sheet.
- Emits `nav:changed` only when something actually changed.

No data, no services. Delete it and the shell stays on the home screen.
