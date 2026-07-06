# RPGraph Studio Overview

RPGraph Studio is a local-first desktop studio for building and running roleplay workflows as a node graph. The app combines a visual workflow editor, a roleplay chat interface, phone-style character messaging, scheduled events, story data, session saves, provider management, and optional image generation through ComfyUI.

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

The current UI labels the product as `RPgraph Studio v0.4.4 Beta`.

## Main Interface

The main app shell is built in [`src/App.tsx`](src/App.tsx). It renders a full studio layout with these major areas:

- **Topbar**: brand/version, onboarding, options, provider management, assistant, system log, file manager, active save/workflow/storybook status, and desktop window controls.
- **Graph panel**: the main React Flow canvas where workflow nodes are placed and connected.
- **Graph toolbar**: reset workflow, save workflow, save RP session, runtime report, workflow capability indicators, and system toast messages.
- **Node palette**: a side drawer of available node types grouped by purpose. Nodes can be dragged onto the graph, and favorite nodes can be added to the quick-add menu.
- **Chat drawer**: a resizable right panel with `Chat`, `Phone`, and `Events` tabs.
- **Dialogs**: options, files, providers, storybook creator, assistant, custom node assistant, output help, image preview, system log, and ComfyUI generated image preview.

## Core User Flow

At a high level, the app works like this:

1. The user opens or creates a workflow.
2. The workflow graph contains nodes such as `User Input`, `LLM Prompt`, `RP Output`, `RP Storybook V1`, and supporting context nodes.
3. The user selects who they are playing as in the chat panel.
4. The user sends a chat message, phone message, event run, auto-turn, or regeneration request.
5. `App.tsx` prepares the current session state and calls the graph execution runtime.
6. The runtime resolves connected nodes, calls LLM or utility nodes as needed, and updates runtime node state.
7. The output is appended back into the chat/session timeline and shown in the UI.

The bundled initial workflow is minimal: `User Input -> LLM Prompt -> RP Output`.

## Prompt Routing

The central workflow router is usually the `LLM Prompt Switch`. Chat buttons and panel choices do not directly choose a prompt by name; they become routing values that travel through the graph.

`runGraph` derives two key numbers for each turn:

- **Message Format**: `0` = RP chat, `1` = phone message, `2` = output actions.
- **Turn Mode / Prompt Slot**: `0` = with image, `1` = no image, `2` = AutoTurn, `3` = event, `4` = narrator, `5` = narrator AutoTurn.

The `User Input` node exposes these as `Message Format` and `Turn Mode` outputs. When those outputs are connected to an `LLM Prompt Switch`, they select the switch's output channel and prompt slot. The switch then combines the selected prompt-before text, the incoming graph text, and the selected prompt-after text, calls the configured LLM provider, and emits only on the selected output channel.

That means UI actions such as normal chat send, phone send, AutoTurn, narrator mode, event run, or output-action buttons all enter the same graph path, but can land on different prompt variants and output ports.

## Prompt Actions

Prompt Actions are internal helper calls that can be inserted into an LLM prompt with `@action` tokens. At runtime, `runActionAwarePrompt` replaces those tokens with the configured action instructions before the first LLM call.

The action flow is two-pass:

1. The first prompt pass shows the model an available action, such as `get_image_id`, `update_phone_image_caption`, or `create_image`.
2. If the model returns only the expected JSON action object, RPGraph executes the action internally.
3. The prompt is replayed with the same `@action` location replaced by the action result, such as found image IDs, a recorded incoming-image caption decision, or a generated ComfyUI image ID.
4. The final model pass writes the visible roleplay or phone response using those returned results.

This makes actions feel like normal prompt context to the model, while the app controls the real side effects. Image-list actions read Storybook image libraries, caption actions return a compact JSON record for the latest incoming phone image, and Create character phone image actions generate and store a new outgoing character phone image through ComfyUI before replaying the prompt.

## Phone And JSON Outputs

The `RP Output` node has separate inputs for `Normal RP`, `Phone Message`, and `Output Actions`. These are final output formats: the model has already finished its prompt run, and the app now parses the result into chat, phone, or UI state.

The core JSON output is a phone message. The dedicated `Phone Message` input expects one small JSON object with `from`, `to`, `message`, and optional `sendImageId`. RPGraph parses that object, adds it to the Phone tab, links it into the session timeline, and can attach the referenced stored Storybook or phone-history image.

Normal RP output is mostly prose for the Chat tab, but it can also embed a `phoneMessages` JSON object when a story beat includes texts or calls. Those embedded phone messages are extracted and shown as linked phone activity while the remaining prose stays visible as the chat bubble.

`Output Actions` is a separate RP Output input for extra app commands. It can create phone messages, chat messages, choice buttons, info boxes, progress bars, context-capacity bars, or controls such as `setTab` and `setPlayer`. Choice buttons can also feed routing values such as `messageFormat` / output channel and `turnMode` / prompt slot back into the next graph run.

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

## Chat, Phone, And Events

The right-side chat drawer has three user-facing modes:

- **Chat**: the main roleplay conversation view. It supports character selection, narrator mode, drafts, image attachments, reference images, editing/regeneration, output actions, dialogue highlighting, phone-message display inside chat, and turn controls.
- **Phone**: a phone-style messaging surface for character-to-character conversations. It supports contact lists, unread conversations, replies, images, gallery images, emoji insertion, and per-character viewing.
- **Events**: a view for upcoming scheduled roleplay events. Events can be selected, cancelled, or run through the workflow.

These UI panels are backed by chat parsing, phone message parsing, timeline selectors, event entities, and session runtime state.

## Story And Session Data

The app separates the workflow graph from roleplay session data.

- **Workflow**: graph nodes, graph edges, viewport, defaults, and optional bundled storybook data.
- **Session / RP save**: timeline, messages, entities, runtime state, undo checkpoints, selected UI state, and debug state.
- **Storybook**: structured roleplay story data, characters, opening history, images, and formatted context output.

Current session data uses a `rpgraph-session` format. Workflow data uses a `rpgraph-workflow` format. Storybook has its own version file.

## Providers And Model Connections

The app supports saved provider connections for LLM and ComfyUI usage.

LLM providers are represented as connection presets. The default is a local LM Studio connection at `http://localhost:1234/v1`.

ComfyUI providers are used for image and voice generation. Each ComfyUI preset has a role (`image` or `voice`) chosen when the preset is created. Bundled ComfyUI workflows are split by role and shape: `comfy-workflows/api-workflows-with-variables/` contains the API JSON files that RPGraph can run, while `comfy-workflows/normal-comfyui-workflows/` is reserved for regular ComfyUI setup workflows that users open in ComfyUI first. Voice presets clone a character voice from an MP3 sample stored in the storybook (`characters[].voiceConfig`); the sample is uploaded to the ComfyUI input directory before each run, and generated audio is fetched back as a data URL. With the voice preset's delete option on (the default), the uploaded sample and the generated audio are deleted from the ComfyUI server after each run; deletion is verified with an existence check, and failures warn at most twice per provider and session. A voice preset also holds a narrator voice sample (`comfyNarratorVoice`) used to read narration text aloud. New or previously unconfigured voice presets receive the bundled RPGraph narrator MP3 by default, and the user can replace or remove it.

The chat supports four voice playback modes (speaker dialog in the composer, stored as `dialogueVoiceMode` in the settings): generate on click, preload voices (clips for the latest turn are generated ahead of time in reading order), read aloud automatically (narrator plus character voices play the whole output sequentially; requires the narrator sample and a voice sample for every storybook character), and narrator only. The dialog explains both API narrator and cloned-character setup and links directly to provider management. Narrator-only playback reads each complete output bubble with either the narrator sample from a ComfyUI voice preset or a speech-only OpenRouter model. API narration can start as soon as the final RP Output text is available, while ComfyUI narration waits for the local run to finish. Gemini 3.1 TTS can optionally stream its PCM response for playback while the remaining audio is still generated. The logic lives in `src/chat/VoicePlaybackDialog.tsx`, `src/chat/useDialogueVoice.ts`, `src/chat/dialogueVoiceSegments.ts`, and `src/chat/ttsNarratorPrompt.ts`.

The ComfyUI voice model stays loaded between clips. It is freed lazily in the Electron main process right before the next local LLM request (plus a short settle delay so the VRAM is released before the LLM loads), and eagerly after a preload or read-aloud queue finishes.

Phone messages support an optional `isVoiceMessage` flag in the LLM JSON (`phoneMessages` array, dedicated Phone Message output, and Output Actions). When the sender has a stored voice sample and a ComfyUI voice provider exists, the Phone tab renders the message as a WhatsApp-style voice bar (`src/components/PhoneVoiceMessage.tsx`) that generates and plays the clip on demand; otherwise the message falls back to plain text. The flag is stored as `phone.voiceMessage` in the session timeline.

Provider management includes:

- Saved connections.
- Provider presets.
- Model list loading.
- Health checks.
- Vision capability detection.
- Local model load/unload helpers for LM Studio and Ollama.
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

The app uses three user-facing file shapes:

- **RP Save**: a complete playable session. It stores an embedded workflow snapshot plus timeline messages, entities, undo checkpoints, UI state, debug state, and current runtime state.
- **Workflow File**: a reusable graph blueprint. It stores graph nodes, edges, viewport, defaults, and persisted node configuration. It can optionally include Storybook node data.
- **Storybook File**: standalone story data that can be opened globally from `Files` or loaded into an individual `RP Storybook V1` node.

Saving can produce either readable **Plain JSON** or a password/PIN protected encrypted envelope. Compatibility is checked through format versions before loading; incompatible workflow, session, or storybook files are rejected with a status message instead of being silently converted.

Important file actions:

- `openFiles` lists stored files and opens the file manager.
- `saveSession` writes an RP save and marks the active workflow as an embedded snapshot.
- `saveNamedWorkflow` exports a reusable workflow file.
- `saveStorybook` writes the active storybook as its own file.
- `openStoredFile`, `requestOpenFile`, and `loadStoredFile` route plain or encrypted loads through the correct unlock path.
- `resetWorkflow` reloads the active workflow file, restores an embedded workflow snapshot, or falls back to the bundled default workflow.

## Node System

Nodes are registered through a central registry. Each core node definition includes a type id, version, label, menu description, port definitions, React component, execution function, creation defaults, and persistence handlers.

Node palette groups in the current UI:

- **Input & Output**: `input`, `last-user-input`, `last-rp-output`, `history`, `output`, `text-preview`, `load-text`
- **LLM & Logic**: `custom`, `llm-prompt`, `llm-prompt-switch`, `llm-decision`, `context-compression`, `event-manager`, `character-stats`
- **Text & Values**: `note`, `group`, `combiner`, `memory-slot`, `phone-message-router`, `text-selector`, `write-text`, `fixed-number`, `fixed-bool`, `settings-value`
- **Story Context**: `rp-storybook-v1`, `context-builder`

Important singleton nodes include `User Input`, `RP Output`, and `RP Storybook V1`.

## Execution Runtime

Graph execution is centered in [`src/graph/executeGraph.ts`](src/graph/executeGraph.ts). It receives the current graph, chat/session context, provider APIs, runtime callbacks, settings values, reference images, and cancellation signal.

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

- [`src/App.tsx`](src/App.tsx): main orchestration shell for UI state, graph state, chat/session flow, provider management, dialogs, and graph runs.
- [`src/components`](src/components): reusable UI panels and dialogs used by the main shell.
- [`src/dialogs`](src/dialogs): larger studio dialog surfaces such as options, files, and provider configuration.
- [`src/nodes`](src/nodes): core node definitions, node UI cards, node execution logic, persistence, custom nodes, and shared node helpers.
- [`src/graph`](src/graph): graph execution, edges, port compatibility, and edge rendering.
- [`src/chat`](src/chat): chat input transformation, phone parsing, output parsing, structured commands, turn records, reference images, and phone replies.
- [`src/storybook`](src/storybook): storybook runtime extraction, image library handling, opening history, and storybook actions.
- [`src/data-management`](src/data-management): session data model, timeline/event/entity stores, selectors, validation, formatting, and debug context.
- [`src/app`](src/app): app-level hooks and helpers extracted from `App.tsx`.
- [`src/comfy`](src/comfy): ComfyUI API and workflow compatibility helpers.
- [`src/llm`](src/llm): LLM API wrapper and token metrics.
- [`electron`](electron): desktop main process, preload bridge, file formats, encryption, and OS/provider integrations.
