# Architecture

Component-level design references for RPGraph Studio. Strict and declarative — design and mechanism only, no narrative.

## Documents

| Document | Scope |
| --- | --- |
| [character-search.md](character-search.md) | Isolated LLM character discovery through the Ask character information prompt action. |
| [app-profile-names.md](app-profile-names.md) | Canonical app profile names, terminology, legacy migration and container persistence. |
| [overview.md](overview.md) | Full architecture map: UI shell, prompt routing, node system, execution runtime, data model, providers. |
| [npc-agency-tags.md](npc-agency-tags.md) | Implemented agency tag schema and app roles; planned reaction context and phased expansion to 50 NPCs. |
| [npc-in-game-assistant.md](npc-in-game-assistant.md) | Proposed in-app character editor, chat assistant, media assignments and hidden agency. |
| [nodes.md](nodes.md) | Node subsystem: definition/registry model, data union, rendering dispatch, ports, sizing, persistence, versioning, registration points. |

## Conventions

- Reference code by file and symbol, not line number.
- One document per subsystem; keep documents flat under `docs/architecture/`.
- Update the relevant document in the same change that alters the architecture it describes.
