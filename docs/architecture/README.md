# Architecture

Component-level design references for RPGraph Studio. Strict and declarative — design and mechanism only, no narrative.

## Documents

| Document | Scope |
| --- | --- |
| [local-accounts.md](local-accounts.md) | Account creation, workspace roots, sign-in, and automatic file encryption. |
| [character-colors.md](character-colors.md) | Stable per-RP color slots, paired playable/NPC palettes and promotion behavior. |
| [character-search.md](character-search.md) | Isolated LLM character discovery through the Ask character information prompt action. |
| [app-profile-names.md](app-profile-names.md) | Canonical app profile names, terminology, legacy migration and container persistence. |
| [image-generation.md](image-generation.md) | Image provider selection, OpenRouter generation, and shared gallery integration. |
| [overview.md](overview.md) | Full architecture map: UI shell, prompt routing, node system, execution runtime, data model, providers. |
| [npc-agency-tags.md](npc-agency-tags.md) | Implemented agency tag schema and app roles; planned reaction context and phased expansion to 50 NPCs. |
| [npc-in-game-assistant.md](npc-in-game-assistant.md) | Proposed in-app character editor, chat assistant, media assignments and hidden agency. |
| [nodes.md](nodes.md) | Node subsystem: definition/registry model, data union, rendering dispatch, ports, sizing, persistence, versioning, registration points. |

## Conventions

- Reference code by file and symbol, not line number.
- One document per subsystem; keep documents flat under `docs/architecture/`.
- Update the relevant document in the same change that alters the architecture it describes.
