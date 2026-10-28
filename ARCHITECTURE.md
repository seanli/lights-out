# Architecture

_Generated from the module manifests by `npm run arch`. Do not edit by hand._

Kernel: registry · run-to-completion event bus · plain-data store with snapshots · dependency-ordered boot · logger · data loader.
Shell: `src/shell` (entry, view service, design system in `src/shell/styles`). Contracts: `src/contracts`.

| Module | Owns | Provides | Uses | Emits | Listens | Data |
|---|---|---|---|---|---|---|
| **nav** | `nav` | — | — | `nav:changed` | `nav:go`, `nav:open_sheet`, `nav:close_sheet`, `levels:started` | — |

## Who reacts to what

- `nav:changed`: nav → (nobody yet)
