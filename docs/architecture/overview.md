# RPGraph Studio Overview

RPGraph Studio is a local-first desktop studio for building and running roleplay workflows as a node graph. The app combines a visual workflow editor, roleplay chat, a multi-app character phone, scheduled events, story data, session saves, provider management, voice playback, and optional image generation through ComfyUI.

This document is the first high-level map of the current codebase. It is intentionally broad: later documents can expand each section into deeper implementation notes.

## Contents

- [What The App Is](#what-the-app-is)
- [Main Interface](#main-interface)
- [Core User Flow](#core-user-flow)
- [Prompt Routing](#prompt-routing)
- [Prompt Actions](#prompt-actions)
- [Phone And JSON Outputs](#phone-and-json-outputs)
- [Workflow Graph](#workflow-graph)
- [Node Run Colors](#node-run-colors)
- [Chat, Phone, And Events](#chat-phone-and-events)
- [Story And Session Data](#story-and-session-data)
- [Providers And Model Connections](#providers-and-model-connections)
- [Built-in AI Assistant](#built-in-ai-assistant)
- [File Management](#file-management)
- [Node System](#node-system)
- [Execution Runtime](#execution-runtime)
- [Important Code Areas](#important-code-areas)

## What The App Is

RPGraph Studio is an Electron + React application for interactive roleplay workflows. A user edits a graph of connected nodes, writes or sends character messages through the chat panel, and runs the graph to produce roleplay output. The graph can include LLM prompts, storybook context, chat history, output routing, character statistics, event handling, and utility nodes.

The project describes itself in `package.json` as:

> Local-first node graph studio for roleplay workflows.

The current UI labels the product as `RPgraph Studio v0.4.9 Beta`.

## Main Interface

The main app shell is built in [`src/App.tsx`](../../src/App.tsx). It renders a full studio layout with these major areas:

- **Topbar**: brand/version, onboarding, options, provider management, assistant, system log, file manager, active save/workflow/storybook status, resource monitoring, and desktop window controls.
- **Graph panel**: the main React Flow canvas where workflow nodes are placed and connected.
- **Graph toolbar**: reset workflow, save workflow, save RP session, runtime report, workflow capability indicators, and system toast messages.
- **Node palette**: a side drawer of available node types grouped by purpose. Nodes can be dragged onto the graph, and favorite nodes can be added to the quick-add menu.
- **Chat drawer**: a resizable right panel with `Chat`, `Phone`, and `Events` tabs.
- **Dialogs**: options, files, providers, storybook creator, assistant, custom node assistant, output help, image preview, system log, and ComfyUI generated image preview.

## Core User Flow

At a high level, the app works like this:

1. The user opens or creates a workflow.
2. The workflow graph contains nodes such as `User Input`, `LLM Prompt`, `RP Output`, `RP Storybook V2`, and supporting context nodes.
3. The user selects who they are playing as in the chat panel.
4. The user sends a chat message, phone message, social-media action, event run, auto-turn, direct app action, or regeneration request.
5. `App.tsx` coordinates focused hooks such as `useGraphRun`, `useRoleplayPanelRuntime`, and `useRpgraphFiles`, which prepare the current session state and start the requested run.
6. The runtime resolves connected nodes, calls LLM or utility nodes as needed, and updates runtime node state.
7. The output is appended back into the chat/session timeline and shown in the UI.

The two bundled default workflows are ready-to-use roleplay graphs rather than minimal three-node examples. Both combine `User Input`, `RP Output`, `Chat History`, `Context Compression`, `Event Manager`, `RP Storybook V2`, an `LLM Prompt Switch`, text combiners, a workflow-variable input, and Wire Links. The Prompt Switch routes Normal RP, Messenger Apps, and Social Media runs into the matching `RP Output` inputs. It also provides an Autoplay output that can be connected to the dedicated RP Output Autoplay input. The classic `workflow.default_vNN.json` family keeps the single-pass prompts, while `workflow.default_planning_vNN.json` uses multistep planning for Normal RP and Messenger prompts. Shared graph and format changes are maintained in both families.

## Prompt Routing

The central workflow router is usually the `LLM Prompt Switch`. Chat buttons and panel choices do not directly choose a prompt by name; they become routing values that travel through the graph.

`runGraph` derives two key numbers for each turn:

- **Message Format**: `0` = Normal RP, `1` = Messenger Apps, `2` = Social Media, `3` = Autoplay.
- **Turn Mode / Prompt Slot**: `0` = with image, `1` = no image, `2` = AutoTurn, `3` = event, `4` = narrator, `5` = narrator AutoTurn.

Social Media reuses the prompt-slot number for app-specific actions: `0` = Fotogram post, `1` = OnlyFriends post, `2` = Fotogram comment thread, `3` = OnlyFriends comment thread, `4` = Fotogram DM, and `5` = OnlyFriends DM. Autoplay uses slot `0` for Local Activity and slot `1` for Remote Activity.

The bundled Autoplay prompts create exactly one optional background beat after a completed non-Autoplay run: Local Activity keeps the beat in or immediately around the player's current scene, Remote Activity sets it entirely elsewhere. The chat UI selects exactly one mode for automatic runs, and each mode can also be triggered manually. Its private English control input identifies the player-controlled character, bypasses input translation, and is not appended to visible chat history. The dedicated RP Output Autoplay input uses the same plain RP and embedded phone/app parsers as Normal RP without sharing its graph port. Autoplay turns never schedule another Autoplay turn.

The `User Input` node exposes these as `Message Format` and `Turn Mode` outputs. When those outputs are connected to an `LLM Prompt Switch`, they select the switch's output channel and prompt slot. The switch then combines the selected prompt-before text, the incoming graph text, and the selected prompt-after text, calls the configured LLM provider, and emits only on the selected output channel.

A prompt slot can additionally be split into a chain of freely named steps with standalone marker lines `@step:<name>` (case-insensitive; letters, digits, `_`, `-`). Steps run in the order their names first appear; the last step is the output step whose reply is streamed as the visible result, every earlier step runs first as a separate intermediate LLM pass. Text before the first marker belongs to the output step, so prompts without markers keep the classic single-pass behavior. Everything an intermediate LLM pass sees is visible, editable prompt text inside its section, nothing is appended from code. Each intermediate step's output replaces every `@output:<name>` token in later steps (or is prepended to the top of the next step when no later step references it), so the prompt author writes their own lead-in text around the token; an `@output` token that does not name an earlier step is removed with a warning. The multistep workflow uses this with a `planning` step ahead of the `main` output step: its planning instruction asks for a rough direction plus one to three bullets — certain developments are plain statements, uncertain ones are either/or rolls that state the success outcome with an explicit chance marker like `(chance: 80%)` and an `otherwise: ...` part for failure. The app dices every line of an intermediate output that carries a `(chance: NN%)` marker (high roll good) and replaces the marker with one of four binding results — clear success, success, failed (the otherwise-part happens), badly failed — without exposing the raw roll; bare percentages without the `chance:` keyword (dates, prices, battery levels) and lines without a marker pass through untouched, and a missing-rolls warning appears only when the step's own prompt mentions `chance:`. An intermediate step can also consume pre-reply image actions itself: an action request in the step output runs the follow-up and the action, then the step reruns with the result, so a planned phone image is fetched or created before the output pass and is never rolled; the multistep prompts request phone images exclusively in the planning step, and the main step only attaches the imageId named in the plan. Afterwards the normal output pass — including actions, commands, and streaming — runs unchanged. The splitting and dice logic lives in `src/nodes/shared/promptSteps.ts`; the multistep Normal RP and Messenger prompts use the planning step.

That means UI actions such as normal chat send, phone send, AutoTurn, narrator mode, event run, social post, comment, DM, or output-action button all enter the graph with explicit routing values and can land on different prompt variants and output ports.

Direct app actions bypass prompt routing. The `User Input` node exposes a `Direct Actions` output, and `RP Output` has a matching input. A direct-only run starts at that RP Output input, so Text, Image, Message Format, Turn Mode, translation, and the LLM Prompt Switch are not evaluated. Direct Actions accepts the same JSON commands as Output Actions plus the manual phone-app commit payloads, and it is exclusive to direct-only runs: normal, phone, social, autoplay, and auto-turn runs never evaluate the Direct Actions path, even when the typed chat text is valid action JSON.

## Prompt Actions

Prompt Actions are internal helper calls that can be inserted into an LLM prompt with `@action` tokens. Pre-reply image actions use a focused three-LLM-pass flow so their full instructions do not permanently consume context:

1. In the normal prompt, each available pre-reply action expands only to a compact request hint. The model requests one by returning its action name and a short plan.
2. RPGraph keeps the same text input but replaces the normal prompt-after text with that action's full follow-up template. The plan is inserted into this focused pass, and the model returns the complete action parameters.
3. RPGraph executes the action internally, then replays the original prompt with the same `@action` location replaced by the result, such as found image IDs or a generated ComfyUI image ID.
4. The final model pass writes the visible roleplay or phone response using those returned results. Unused actions remain compact hints, so the model can request another action when necessary.

After-reply caption actions remain separate focused passes because their instructions depend on the already completed visible reply.

This makes actions feel like normal prompt context to the model, while the app controls the real side effects. Image-list actions read Storybook image libraries and identify earlier recipients of each match so the model does not resend the same photo to them. Caption actions return a compact JSON record for the latest incoming phone image, and Create character phone image actions generate and store a new outgoing character phone image through ComfyUI before replaying the prompt.

## Phone And JSON Outputs

The `RP Output` node has separate inputs for `Normal RP`, `Messenger Apps`, `Social Media`, `Output Actions`, `Highlighting Context`, and `Direct Actions`. These are final output formats: the model or direct app action has already produced its result, and the app now parses it into chat, phone, social, banking, or UI state.

Private messages share one LLM-facing array shape with `from`, `to`, and `message`. The enclosing key selects the app: `whatsUpApp`, `fotogramApp`, or `onlyFriendsApp`. WhatsUp additionally applies optional `isVoiceMessage` and `sendImageId`; the social apps currently ignore those two fields. Each parsed message becomes a real entry in that app's conversation history.

Before a Prompt Switch output can create a Fotogram or OnlyFriends message, both participants are resolved by exact app handle or display name. Known Storybook characters without an account in that app are blocked, so the model cannot silently invent a missing account for them. Unknown display names and usernames are accepted as new story NPCs and become dynamic social-directory entries after their first delivered message. The node discards an invalid known-character message and retries once with a small private correction context; a second invalid result remains blocked.

Normal RP output is mostly prose for the Chat tab, but it can also embed one of the three messenger-app objects when a story beat includes private messages. Its image and no-image prompts normally send one message, but narrator-style input that directs a back-and-forth may produce a complete two-to-four-message exchange. WhatsUp, Fotogram, and OnlyFriends conversations are shown as app-specific message cards inside the originating chat bubble while the same messages also appear in their app histories. Selecting an embedded message opens its app conversation under the available participant's character view and highlights the linked message.

`Output Actions` is a separate RP Output input for extra app commands. It can create phone messages, chat messages, choice buttons, info boxes, progress bars, context-capacity bars, or controls such as `setTab` and `setPlayer`. Choice buttons can also feed routing values such as `messageFormat` / output channel and `turnMode` / prompt slot back into the next graph run.

`Direct Actions` accepts the same command shapes without requiring an LLM result, plus strictly validated `createdPhoneNotes` and `simulatedAiChats` commit payloads. Banking transfers, manually written Notes, and finished ChatGPD chats all run through this route (via `useDirectAppActions` / `runDirectAppAction`), so each persistent phone-app action becomes a real turn with history, turn trace, undo, and regeneration instead of a silent app-state write.

`Social Media` handles generated Fotogram and OnlyFriends reactions. It applies likes and comments to posts, records thread activity, and can add incoming private messages through the same messenger-app arrays. Direct replies use the matching `fotogramApp` or `onlyFriendsApp` key.

## Workflow Graph

The workflow editor is built on `@xyflow/react` / React Flow. Nodes and edges are stored in React state and rendered through a custom workflow node renderer and custom workflow edge type.

The graph supports:

- Dragging new nodes from the node palette.
- Right-click quick-add for favorite node types.
- Connecting compatible ports.
- Reconnecting edges.
- Deleting and restoring recently deleted nodes.
- Runtime status display on nodes.
- Port value previews.
- Node-specific actions exposed through context providers.

## Node Run Colors

Node header colors and outgoing wire colors show the current execution state:

- **Blue**: fresh, not completed yet, or actively running on the visible response path.
- **Green**: completed successfully for the current turn.
- **Orange**: prepared state for the next turn, usually from post-output work after the RP response has already been delivered.
- **Red**: execution error.

During execution, `executeGraph` sets `runActive`, `runCompleted`, `runPrepared`, and `runError` on node data. Card rendering converts those flags into CSS classes, and edge rendering colors outgoing wires from the source node state.

LLM-capable node cards show a compact route heading followed by aligned call rows for input tokens, output tokens, reasoning tokens, and duration. Prompt Switch calls use short stage labels such as `Step: Planning`, `Step: Main`, `Action: Create character phone image`, and `Command: Bank transfer` instead of repeating the selected output and prompt titles on every row. While a roleplay run is active, the Chat tab temporarily replaces the composer with a compact progress island containing the current node or LLM sub-step, a green elapsed-time clock, an activity animation, and a Cancel button. It disappears when the run finishes or is cancelled, restoring the collapsed composer so the resulting story, phone, banking, or information cards remain the focus.

## Chat, Phone, And Events

The right-side chat drawer has three user-facing modes:

- **Chat**: the main roleplay conversation view. It supports character selection, narrator mode, drafts, image attachments, reference images, editing/regeneration, output actions, dialogue highlighting, phone-message display inside chat, and turn controls.
- **Phone**: a character-owned phone desktop with WhatsUp, Gallery, Camera, Banking, Fotogram, OnlyFriends, and Notes apps.
- **Events**: a view for upcoming scheduled roleplay events. Events can be selected, cancelled, or run through the workflow.

These UI panels are backed by chat parsing, phone message parsing, timeline selectors, event entities, and session runtime state.

WhatsUp supports contact lists, unread conversations, replies, text and voice messages, images, gallery selection, emoji insertion, and per-character viewing. Gallery and Camera connect Storybook images, uploads, and the image-generation assistant. Banking shows character accounts, contacts, balances, statements, and transfers. Fotogram and OnlyFriends share a private social feed implementation with accounts, posts, comments, likes, direct messages, and app-specific prompts. Each app has its own bundled 100-user directory, and generated background comments reuse exact identities from the corresponding catalog. Both apps also show cosmetic catalog posts on every account's home page; these discovery posts do not imply a saved social connection. Each app's shuffled catalog is divided evenly across the current player characters, with overlap only when equal-sized partitions require reusing the pool remainder. The catalogs contain 25 posts in total: 15 Fotogram posts and 10 OnlyFriends posts. Fotogram includes 13 bundled 4:5 portrait JPEG posts and two text-only posts. The 10 OnlyFriends posts contain no bundled images and therefore use locked or placeholder frames. Real generated posts remain private to their author and connected viewers. Storybook pairs are mutual Phone + Fotogram contacts by default; hiding a pair removes that default display without blocking messages. A real Fotogram conversation establishes the mutual visible contact again, including feed access, and manually adding a Storybook account adds the reverse contact too. OnlyFriends and non-default Fotogram accounts remain hidden until added. Searches begin after three characters and include matching Storybook accounts plus NPC identities discovered in phone or social history. OnlyFriends additionally supports a wallet, DM tips, paid post unlocks, and creator accounts. Notes provides character-specific editable cards with gentle automatic colors and a manual color picker.

## Story And Session Data

The app separates the workflow graph from roleplay session data.

- **Workflow**: graph nodes, graph edges, viewport, defaults, and optional bundled storybook data.
- **Session / RP save**: timeline, messages, entities, runtime state, undo checkpoints, selected UI state, debug state, phone read state, banking contacts, social likes, per-character social connections, discovered NPC social identities, OnlyFriends purchases, and recent emoji state. Phone, banking, social-post, comment, and DM records are stored on the canonical timeline. Generated dialogue, narration, and phone voice clips keep media references on their timeline messages while their base64 audio lives once in the shared session media pool. Chat bubbles retain links to their embedded WhatsUp, Fotogram, and OnlyFriends messages across save and reload. Bundled social catalogs remain application data and are not duplicated into saves.
- **Storybook**: structured roleplay story data, characters, opening history, images, and formatted context output. Opening History explicitly carries added social connections, dynamic NPC identities, and generated dialogue/narration/phone voice clips so a new session restores the same private social graph and playable history. Opening History messages reference a deduplicated Storybook voice-media pool instead of embedding repeated audio payloads.

Current session data uses a `rpgraph-session` format. Workflow data uses a `rpgraph-workflow` format. Storybook has its own version file.

## Providers And Model Connections

The app supports saved provider connections for LLM and ComfyUI usage.

LLM providers are represented as connection presets. Built-in presets cover LM Studio, Ollama, llama.cpp router mode, OpenRouter, and Google Gemini. The default is a local LM Studio connection at `http://localhost:1234/v1`.

ComfyUI providers are used for image and voice generation. Each ComfyUI preset has a role (`image` or `voice`) chosen when the preset is created. Bundled ComfyUI workflows are split by role and shape: `comfy-workflows/api-workflows-with-variables/` contains the API JSON files that RPGraph can run, while `comfy-workflows/normal-comfyui-workflows/` is reserved for regular ComfyUI setup workflows that users open in ComfyUI first. Voice presets clone a character voice from an MP3 sample stored in the storybook (`characters[].voiceConfig`); the sample is uploaded to the ComfyUI server before each run, and generated audio is fetched back as a data URL. With the voice preset's cleanup option on (the default), the sample is uploaded to the ComfyUI temp directory (referenced via the `name [temp]` annotation) and core audio save nodes are rerouted to `PreviewAudio`, so the generated clips land in the temp directory too — ComfyUI empties that directory itself, and stock ComfyUI offers no HTTP route to delete files. Clips a custom save node still writes to the output directory get a verified delete attempt, and failures warn at most twice per provider and session. Image presets have the same temp-folder option (`comfyDeleteImageOutputs`, on by default): core `SaveImage` nodes are rerouted to `PreviewImage`, so generated images land in the temp directory instead of the output directory. A voice preset also holds a narrator voice sample (`comfyNarratorVoice`) used to read narration text aloud. New or previously unconfigured voice presets receive the bundled RPGraph narrator MP3 by default, and the user can replace or remove it.

The chat supports four voice playback modes (speaker dialog in the composer, stored as `dialogueVoiceMode` in the settings): generate on click, preload voices (clips for the latest turn are generated ahead of time in reading order), read aloud automatically (narrator plus character voices play the whole output sequentially; requires the narrator sample and a voice sample for every storybook character), and narrator only. The dialog explains both API narrator and cloned-character setup and links directly to provider management. Narrator-only playback reads each complete output bubble with either the narrator sample from a ComfyUI voice preset or a speech-only OpenRouter model. Stored clips are historical audio owned by their messages; changing a provider or reference sample clears only the shared generation cache, so old messages keep their sound while new messages use the new voice. API narration can start as soon as the final RP Output text is available, while ComfyUI narration waits for the local run to finish. Gemini 3.1 TTS can optionally stream its PCM response for playback while the remaining audio is still generated. The logic lives in `src/chat/VoicePlaybackDialog.tsx`, `src/chat/useDialogueVoice.ts`, `src/chat/dialogueVoiceSegments.ts`, and `src/chat/ttsNarratorPrompt.ts`.

The ComfyUI voice model stays loaded between clips. It is freed lazily in the Electron main process right before the next local LLM request (plus a short settle delay so the VRAM is released before the LLM loads), and eagerly after a preload or read-aloud queue finishes.

WhatsUp messages support an optional `isVoiceMessage` flag in the LLM JSON (`whatsUpApp` array and Output Actions). When the sender has a stored voice sample and a ComfyUI voice provider exists, the Phone tab renders the message as a WhatsApp-style voice bar (`src/components/PhoneVoiceMessage.tsx`) that generates and plays the clip on demand; otherwise the message falls back to plain text. The flag is stored as `phone.voiceMessage` in the session timeline. Fotogram and OnlyFriends currently ignore voice and image fields in their shared message arrays.

Provider management includes:

- Saved connections.
- Provider presets.
- Model list loading.
- Health checks.
- Vision capability detection.
- Local model load/unload helpers for LM Studio, Ollama, and llama.cpp router mode. llama.cpp model discovery reads text/vision capabilities and explicit load states from `/models`; RPGraph waits for confirmed load/unload completion when sharing GPU memory with ComfyUI. The provider's Reasoning setting is translated to llama.cpp chat-template controls, so short structured helper calls can disable hidden thinking tokens reliably.
- ComfyUI workflow inspection and repair (role-aware placeholders for image and voice workflows).
- ComfyUI model memory management around image and voice generation.

## Built-in AI Assistant

The built-in assistant helps explain workflows, inspect nodes, and debug recent runs from inside the editor.

It has two modes:

- **Workflow mode**: opened from the topbar `Assistant` button or by pressing `F1` with no node selected. It sees the app overview, a compact workflow snapshot, recent system-log warnings/errors, available node types, chat history with the assistant, and any debug snapshots it has requested.
- **Node mode**: opened by selecting a graph node and pressing `F1`. It focuses on that node and can include its source code, current configuration/state JSON, recent system log, and selected debug snapshots.

The assistant uses lazy context loading. If it needs more detail, it can request exactly one context item with a JSON command in its own response. The app then loads that context and continues the conversation. Supported requests include selected-node code/state, workflow node context, node-type context, and debug snapshots such as timeline, phone, events, app state, workflow nodes, workflow edges, last run, prompt switch debug, event manager debug, or full system log.

## File Management

Files are handled through the Electron bridge exposed as `window.rpgraph`. The React side coordinates file UI state in `useRpgraphFiles`, while the Electron side reads, writes, validates, and encrypts the actual JSON files.

The app uses four user-facing file shapes:

- **RP Save**: a complete playable session. It stores an embedded workflow snapshot plus timeline messages, entities, undo checkpoints, UI state, debug state, and current runtime state.
- **Workflow File**: a reusable graph blueprint. It stores graph nodes, edges, viewport, defaults, and persisted node configuration. It can optionally include Storybook node data.
- **Storybook File**: standalone story data that can be opened globally from `Files` or loaded into an individual `RP Storybook V2` node.
- **RP Storybook Editor node** (`rp-storybook-editor`): a standalone, non-singleton editor for storybook documents. It reuses the RP Storybook data model and the same three outputs (`JSON`, `Formatted Text`, `Character Info`), but exposes editable Formatted Text and Raw JSON views (writer- and developer-oriented respectively) plus simple tools (JSON beautify/validate, minify, copy, revert). Editing is deterministic (no LLM): Raw JSON prunes/restores Opening History and rehydrates redacted binaries by id on apply; Formatted Text is a non-destructive prose merge. It is a document editor, not the live-story container, so it carries none of the running-story guards.
- **Character Card** (`*.rpgraph-character.json`, format `rpgraph-character`): one self-contained storybook character with images, voice sample, and phone/banking/social setup. Exported per character from the storybook editor and imported into any storybook (same id or name replaces that character, otherwise it is added; image ids are re-namespaced on collision). Managed cards are stored in the `characters` user-data directory next to `files` and selected through the dedicated Characters dialog. A card placed directly in `files` still appears in the global Files dialog. Logic lives in `src/storybook/characterCard.ts` and `electron/characterCardFormat.cjs`.

Saving can produce either readable **Plain JSON** or a password/PIN protected encrypted envelope for every file type. Encrypted character cards expose only the character name and card format version as character metadata; the full character content stays encrypted. Compatibility is checked through format versions before loading. Workflow and session files use exact-match versions and are rejected when incompatible. Storybook and character card versions are semver-compared (`electron/storybookFormat.cjs`, `rpStorybookVersionStatus` in the storybook model): files newer than the build are rejected with an update hint, while older files stay loadable — legacy storybooks are routed into the conversion panel (`src/storybook/conversion.ts`, `src/storybook/StorybookConversionPanel.tsx`), a per-section checklist showing what was carried over or filled with defaults before the converted storybook is applied and re-saved. Encrypted legacy storybooks unlock with their password first and then enter the same conversion flow.

Loading a Storybook file starts a fresh story session: current chat and phone-app runtime state are cleared, and the loaded Storybook fully replaces the previous node content. In-editor changes still retain image-usage and running-story identity protections.

Important file actions:

- `openFiles` lists stored files and opens the file manager.
- `saveSession` writes an RP save and marks the active workflow as an embedded snapshot.
- `saveNamedWorkflow` exports a reusable workflow file.
- `saveStorybook` writes the active storybook as its own file.
- `openStoredFile`, `requestOpenFile`, and `loadStoredFile` route plain or encrypted loads through the correct unlock path.
- `resetWorkflow` reloads the active workflow file, restores an embedded workflow snapshot, or restores both bundled workflow families and opens the planning workflow.

Bundled workflow names are versioned independently in the classic `workflow.default_vNN.json` and multistep `workflow.default_planning_vNN.json` families. On startup the Electron layer imports every bundled filename not already recorded in `workflow-state.json`. It never overwrites an existing local file, so an updated classic or planning workflow appears alongside previously imported versions. On a fresh installation the planning family is selected as the primary default; an existing installation keeps its last active workflow.

## Node System

Nodes are registered through a central registry. Each core node definition includes a type id, version, label, menu description, port definitions, React component, execution function, creation defaults, and persistence handlers.

Node palette groups in the current UI:

- **Input & Output**: `input`, `last-user-input`, `last-rp-output`, `history`, `output`, `text-preview`, `load-text`
- **LLM & Logic**: `custom`, `llm-prompt`, `llm-prompt-switch`, `llm-decision`, `context-compression`, `event-manager`, `character-stats`
- **Text & Values**: `note`, `group`, `combiner`, `memory-slot`, `phone-message-router`, `text-selector`, `write-text`, `fixed-number`, `fixed-bool`, `settings-value`
- **Story Context**: `rp-storybook`, `rp-storybook-editor`, `context-builder`

Singleton nodes are `User Input`, `Chat History`, `Event Manager`, `RP Storybook V2`, and `RP Output`.

## Execution Runtime

Graph execution is centered in [`src/graph/executeGraph.ts`](../../src/graph/executeGraph.ts). It receives the current graph, chat/session context, provider APIs, runtime callbacks, settings values, reference images, and cancellation signal.

The runtime:

- Resolves node outputs recursively from the requested output node.
- Memoizes node results per node and output handle.
- Detects cycles.
- Tracks runtime port values.
- Marks LLM-capable nodes as active during calls.
- Runs node-specific `execute` functions from the registry.
- Maintains runtime workflow variables.
- Handles post-output nodes.
- Emits warnings and format diagnostics.
- Streams output text when enabled.
- Coordinates ComfyUI image creation and storybook image updates.

## Important Code Areas

- [`src/App.tsx`](../../src/App.tsx): main orchestration shell that connects graph state, focused app hooks, panels, and dialogs.
- [`src/app`](../../src/app): graph-run orchestration, roleplay-panel state, provider connections, file workflows, runtime patching, lifecycle handling, debug snapshots, and workflow hydration/snapshots.
- [`src/components`](../../src/components): reusable UI panels and dialogs, including Chat, Phone, Banking, Gallery, Social Media, voice playback controls, and image generation.
- [`src/dialogs`](../../src/dialogs): larger studio dialog surfaces such as options, files, and provider configuration.
- [`src/nodes`](../../src/nodes): core node definitions, node UI cards, node execution logic, persistence, custom nodes, and shared node helpers.
- [`src/graph`](../../src/graph): graph execution, edges, port compatibility, and edge rendering.
- [`src/chat`](../../src/chat): chat input transformation, phone/social parsing, banking and OnlyFriends wallet rules, output parsing, voice handling, structured commands, turn records, reference images, and phone replies.
- [`src/storybook`](../../src/storybook): storybook runtime extraction, image library handling, opening history, and storybook actions.
- [`src/data-management`](../../src/data-management): session data model, timeline/event/entity stores, selectors, validation, formatting, and debug context.
- [`src/comfy`](../../src/comfy): ComfyUI API and workflow compatibility helpers.
- [`src/llm`](../../src/llm): LLM API wrapper and token metrics.
- [`electron`](../../electron): desktop main process, preload bridge, file formats, encryption, and OS/provider integrations.
