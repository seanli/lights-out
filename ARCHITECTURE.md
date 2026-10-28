# Architecture

_Generated from the module manifests by `npm run arch`. Do not edit by hand._

Kernel: registry · run-to-completion event bus · plain-data store with snapshots · dependency-ordered boot · logger · data loader.
Shell: `src/shell` (entry, view service, design system in `src/shell/styles`). Contracts: `src/contracts`.

| Module | Owns | Provides | Uses | Emits | Listens | Data |
|---|---|---|---|---|---|---|
| **board** | `board` | — | `solver?` | `board:loaded`, `board:pressed`, `board:undone`, `board:restarted`, `board:solved`, `board:refused`, `board:load`, `board:press` | `board:load`, `board:press`, `board:undo`, `board:restart` | — |
| **console** | — | — | `view`, `debug`, `env`, `clock?` | — | — | `rules`, `copy`, `flags` |
| **hints** | `hints` | — | `solver`, `rng` | `hints:shown`, `hints:cleared`, `hints:refused` | `hints:request`, `board:pressed`, `board:undone`, `board:restarted`, `board:loaded`, `board:solved` | `rules`, `flags` |
| **home-view** | — | — | `view`, `env?` | `levels:start`, `sound:set`, `learn:open`, `variety:open`, `nav:open_sheet`, `nav:close_sheet`, `progress:clear` | — | `copy` |
| **learn** | `learn` | — | `view`, `solver`, `rng`, `storage?`, `clock?` | `learn:lesson_opened`, `learn:lesson_completed`, `learn:practice_solved`, `learn:refused`, `nav:go`, `nav:back`, `learn:open`, `learn:step`, `learn:press`, `learn:new_practice`, `learn:set_assist` | `learn:open`, `learn:step`, `learn:press`, `learn:new_practice`, `learn:set_assist` | `rules`, `copy` |
| **levels** | `levels` | — | `solver`, `rng` | `levels:start`, `levels:generated`, `levels:started`, `levels:refused`, `board:load` | `levels:start` | `rules`, `copy` |
| **nav** | `nav` | — | — | `nav:changed` | `nav:go`, `nav:back`, `nav:open_sheet`, `nav:close_sheet`, `levels:started` | — |
| **offline** | `offline` | — | `env?`, `view?`, `clock?` | `offline:status_changed` | — | `copy` |
| **play-view** | — | — | `view`, `clock?` | `board:press`, `board:undo`, `board:restart`, `hints:request`, `nav:back` | — | `copy` |
| **progress** | `progress` | — | `clock`, `storage?`, `view?` | `progress:loaded`, `progress:level_completed`, `progress:cleared`, `progress:save_failed`, `progress:clear` | `progress:clear`, `levels:started`, `levels:generated`, `hints:shown`, `board:solved` | `rules`, `copy` |
| **solved-sheet** | — | — | `view`, `clock` | `nav:open_sheet`, `nav:close_sheet`, `nav:go`, `levels:start`, `variety:open` | `board:solved`, `progress:level_completed`, `levels:started`, `board:loaded`, `board:restarted`, `kernel:state_loaded` | `rules`, `copy` |
| **solver** | — | `solver` | — | — | — | — |
| **sound** | `sound` | — | `rng`, `storage?`, `clock?`, `view?` | `sound:changed` | `sound:set`, `board:loaded`, `board:pressed`, `board:undone`, `board:restarted`, `board:solved`, `hints:shown`, `levels:started`, `progress:level_completed`, `nav:changed` | `rules`, `flags` |
| **storage** | `storage` | `storage` | `view?` | `storage:checked` | — | `rules`, `copy` |
| **tutorial** | `tutorial` | — | `solver?`, `storage?`, `view?` | `tutorial:step_shown`, `tutorial:finished` | `board:loaded`, `board:pressed`, `board:undone`, `board:restarted`, `board:solved`, `tutorial:skip` | `rules`, `flags`, `copy` |
| **variety** | `variety` | — | `view` | `variety:opened`, `variety:refused`, `nav:go`, `nav:back`, `levels:start`, `learn:open` | `variety:open`, `progress:level_completed` | `copy` |

## Who reacts to what

- `board:load`: board, levels → board
- `board:loaded`: board → hints, solved-sheet, sound, tutorial
- `board:press`: board, play-view → board
- `board:pressed`: board → hints, sound, tutorial
- `board:refused`: board → (nobody yet)
- `board:restart`: play-view → board
- `board:restarted`: board → hints, solved-sheet, sound, tutorial
- `board:solved`: board → hints, progress, solved-sheet, sound, tutorial
- `board:undo`: play-view → board
- `board:undone`: board → hints, sound, tutorial
- `hints:cleared`: hints → (nobody yet)
- `hints:refused`: hints → (nobody yet)
- `hints:request`: play-view → hints
- `hints:shown`: hints → progress, sound
- `learn:lesson_completed`: learn → (nobody yet)
- `learn:lesson_opened`: learn → (nobody yet)
- `learn:new_practice`: learn → learn
- `learn:open`: home-view, learn, variety → learn
- `learn:practice_solved`: learn → (nobody yet)
- `learn:press`: learn → learn
- `learn:refused`: learn → (nobody yet)
- `learn:set_assist`: learn → learn
- `learn:step`: learn → learn
- `levels:generated`: levels → progress
- `levels:refused`: levels → (nobody yet)
- `levels:start`: home-view, levels, solved-sheet, variety → levels
- `levels:started`: levels → nav, progress, solved-sheet, sound
- `nav:back`: learn, play-view, variety → nav
- `nav:changed`: nav → sound
- `nav:close_sheet`: home-view, solved-sheet → nav
- `nav:go`: learn, solved-sheet, variety → nav
- `nav:open_sheet`: home-view, solved-sheet → nav
- `offline:status_changed`: offline → (nobody yet)
- `progress:clear`: home-view, progress → progress
- `progress:cleared`: progress → (nobody yet)
- `progress:level_completed`: progress → solved-sheet, sound, variety
- `progress:loaded`: progress → (nobody yet)
- `progress:save_failed`: progress → (nobody yet)
- `sound:changed`: sound → (nobody yet)
- `sound:set`: home-view → sound
- `storage:checked`: storage → (nobody yet)
- `tutorial:finished`: tutorial → (nobody yet)
- `tutorial:step_shown`: tutorial → (nobody yet)
- `variety:open`: home-view, solved-sheet → variety
- `variety:opened`: variety → (nobody yet)
- `variety:refused`: variety → (nobody yet)
