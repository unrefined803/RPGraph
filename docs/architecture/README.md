# Architecture

Component-level design references for RPGraph Studio. Strict and declarative — design and mechanism only, no narrative.

## Documents

| Document | Scope |
| --- | --- |
| [account-privacy.md](account-privacy.md) | File encryption, filename protection, settings and credential boundaries. |
| [character-container-v2.md](character-container-v2.md) | Shared payload, registry precedence, runtime revisions, account links and relationships. |
| [character-creator.md](character-creator.md) | Container creation, blob-free editing, media assignments and portrait tools. |
| [diagnostics.md](diagnostics.md) | Turn traces, prompt captures and workflow assistant context. |
| [local-accounts.md](local-accounts.md) | Account creation, workspace roots, sign-in, and automatic file encryption. |
| [chatgpt-provider.md](chatgpt-provider.md) | Reusable ChatGPT profiles, workspace storage, browser OAuth, model selection and Responses requests. |
| [character-colors.md](character-colors.md) | Stable per-RP color slots, paired playable/NPC palettes and promotion behavior. |
| [character-search.md](character-search.md) | Isolated LLM character discovery through the Ask character information prompt action. |
| [app-profile-names.md](app-profile-names.md) | Canonical app profile names, terminology, legacy migration and container persistence. |
| [image-generation.md](image-generation.md) | Image provider selection, OpenRouter generation, and shared gallery integration. |
| [overview.md](overview.md) | Full architecture map: UI shell, prompt routing, node system, execution runtime, data model, providers. |
| [npc-agency-tags.md](npc-agency-tags.md) | Character-level tags, social reaction audiences and private context. |
| [npc-in-game-assistant.md](npc-in-game-assistant.md) | In-app character editor, assistant authoring, media assignments and local saving. |
| [nodes.md](nodes.md) | Node subsystem: definition/registry model, data union, rendering dispatch, ports, sizing, persistence, versioning, registration points. |

## Conventions

- Reference code by file and symbol, not line number.
- One document per subsystem; keep documents flat under `docs/architecture/`.
- Update the relevant document in the same change that alters the architecture it describes.

## Documentation scope

Keep current behavior, formats, operating instructions and concrete limitations.
Remove completed task lists, implementation diaries, historical review findings
and refactoring plans. Update information in place when behavior changes.
