# Nodes

## Model

- No class inheritance. Node types are plain-object definitions held in a registry and rendered by one component.
- Two shared spines: a definition interface (behavior) and a discriminated-union data type (state).
- Every graph node is React Flow `type: 'workflow'`. Node-type identity lives in `data.nodeType`.

## Definition

Type: `NodeCreationDefinition` (`src/nodes/types.ts`). Core nodes use the narrowed `CoreNodeCreationDefinition` (`type: CoreNodeType`, `origin: 'core'`).

| Field | Type | Role |
| --- | --- | --- |
| `type` | `NodeTypeId` | Registry key. |
| `dataVersion` | `` `${number}.${number}.${number}` `` | Node data version. |
| `label`, `description`, `menuDescription` | `string` | Display + palette text. |
| `origin` | `'core' \| 'plugin'` | Provenance. |
| `ports` | `(data) => PortDefinition[]` | Ports, computed per render. |
| `create` | `(ctx) => WorkflowNode` | New-instance factory. |
| `Component` | `ComponentType<NodeProps<WorkflowNode>>` | Per-type card. |
| `execute` | `(node, ctx) => Promise<string>` | Runtime behavior. |
| `saveData` / `hydrateData` | `(data[, ctx]) => data` | Persistence normalizers. |
| `hydrateStyle?` | `(node) => node.style` | Layout normalization on load. |
| `singleton?` | `boolean` | Max one instance. |
| `usesLlm?` | `boolean` | Node issues LLM calls. |
| `contributesToTokenCalibration?` | `boolean` | Feeds token metrics. |
| `requiresPostOutputPermission?` | `boolean` | Gated in post-output runs. |
| `requiresPreparedInputEdge?` | `boolean` | Prepared only with a qualifying input edge. |
| `passiveRuntime?` | `boolean` | Not blocked by pending user input. |

Core definitions are object literals in `coreNodeCreationDefinitions` (`src/nodes/coreDefinitions.ts`). `saveData`/`hydrateData` are attached from `corePersistence` (`src/nodes/corePersistence.ts`) to produce the exported `coreNodeDefinitions`.

## Registry

`src/nodes/registry.ts` — `Map<NodeTypeId, NodeCreationDefinition>`.

- `registerNode(def)` validates then inserts. Rejections (throw):
  - `dataVersion` not `MAJOR.MINOR.PATCH`.
  - `origin: 'plugin'` without a namespaced `owner/name` type id.
  - Duplicate `type` id.
- `registerCoreNodes()` is idempotent; registers `coreNodeDefinitions` at module load.
- Lookups: `getRegisteredNode`, `getRegisteredCoreNode`, `getRegisteredCoreNodes`.

## Instance

`WorkflowNode = Node<WorkflowNodeData>` (React Flow). Validated by `isWorkflowNode` (`src/workflow/validation.ts`).

Top-level fields: `id`, `type: 'workflow'`, `position {x,y}`, `style?`, `width?`/`height?`, `measured?`, `selected?`/`dragging?`/`resizing?`, `data`.

## Data

Type: `WorkflowNodeData` (`src/types.ts`). Discriminated union.

Discriminants:
- `nodeType` — string literal.
- `kind` — `undefined` for core nodes; `'missing-plugin-node'` or `'incompatible-core-node'` for placeholders.

Base: `WorkflowNodeCommonFields` — one flat interface.
- Required: `label`, `description`, `preview`.
- Optional (~112 fields): run state (`runActive`, `runVisionActive`, `runCompleted`, `runPrepared`, `runError`, `runtimePortValues`), version (`nodeDataVersion`, `currentNodeVersion`), `portsSnapshot`, and every per-feature field (e.g. `llmPromptBefore`, `textReplaceEntries`, `combinerInputCount`, `storybookJson`).

Core variant shape:
```
CoreWorkflowNodeCommonFields = WorkflowNodeCommonFields & { kind?: undefined; storedData?: undefined }
<XxxNodeData>              = CoreWorkflowNodeCommonFields & { nodeType: 'xxx' }
```
- Variants add only the `nodeType` discriminant. Exceptions: `memory-slot` requires `memorySlotName`/`memorySlotText`/`memorySlotMode`; `last-user-input`/`last-rp-output` re-declare `includeRpDateTime`.
- Union of all core variants: `ConcreteCoreWorkflowNodeData`.

Placeholder variants:
- `MissingNodeWorkflowData` — `kind: 'missing-plugin-node'`, `storedData`, `portsSnapshot`.
- `IncompatibleCoreNodeWorkflowData` — `kind: 'incompatible-core-node'`, `nodeDataVersion`, `currentNodeVersion`, `storedData`.

Full union:
```
WorkflowNodeData = ConcreteCoreWorkflowNodeData | MissingNodeWorkflowData | IncompatibleCoreNodeWorkflowData
```

`NodeCreationDefinition` uses the runtime `WorkflowNodeData` (`src/types.ts`)
for creation, rendering, execution, and persistence.

## Ports

Resolution — `nodePorts` (`src/graph/portCompatibility.ts`):
- `kind === undefined` (core): `getRegisteredNode(nodeType).ports(data)` — computed.
- `kind !== undefined` (plugin/placeholder): `data.portsSnapshot` — stored.

`PortDefinition = PortSnapshot = { id, direction: 'input' | 'output', valueType, label, multiple? }`.

Compatibility — `arePortTypesCompatible` (`src/graph/portCompatibility.ts`):
- `image` connects to `image` only.
- `mixed` input accepts `text`/`json`/`mixed`/`number`/`boolean`.
- Equal types connect.

## Rendering

Single React Flow node type: `nodeTypes = { workflow: WorkflowNodeRenderer }` (`src/App.tsx`).

Dispatch — `WorkflowNodeRenderer` (`src/nodes/WorkflowNodeRenderer.tsx`):
1. `kind: 'incompatible-core-node'` → `IncompatibleCoreNodeCard`.
2. `kind: 'missing-plugin-node'` or unregistered type → `MissingNodeCard`.
3. Otherwise → `definition.Component`.

Shared card behavior (composition): `useNodeLayoutSync`, `runStateClassName`, `LlmCallMetrics` (`src/nodes/shared/CardView.tsx`); contexts `useNodeActions`, `useNodeView`.

## Sizing

Two boxes per node:
- Painted card: `.workflow-node` and `.workflow-node.<type>-node` (`src/styles.css`). Base width 365px; per-type override by class.
- Interaction wrapper (React Flow node element): sized by persisted `style.width/height` when present, else measured size.

Size sources (independent):
- `coreNodeLayout` constants (`src/nodes/coreDefinitions.ts`) — seeded into `style` at `create`; re-applied by `hydrateStyle`.
- Per-type CSS rule (`src/styles.css`).
- Persisted `node.style`.
- Measured size (React Flow ResizeObserver via `useNodeLayoutSync` → `updateNodeInternals`).

Reconciliation:
- `hydrateStyle` (optional) re-derives `style` from constants on load. Defined for: `llm-prompt`, `llm-prompt-switch`, `load-text`, `text-preview`, `context-builder`, `context-compression`.
- `useNodeLayoutSync` re-measures the card; does not write back to `style`.
- Placeholder nodes: hydration strips saved `width`/`height`/`measured` (`src/app/workflowHydration.ts`); the wrapper re-measures to the card.

## Persistence

- `create()` returns a full node with a `data` literal.
- `saveData`/`hydrateData`: per-type normalizers in `corePersistence` (`src/nodes/corePersistence.ts`). `baseData`/`preservedData` rebuild `data` from `{nodeType, label, description, preview}` plus type-relevant fields; stamp `nodeDataVersion = definition.dataVersion`.
- Routing — `persistentNodeData`/`hydrateNodeData` (`src/workflow/persistence.ts`): placeholder nodes clone `storedData`; core nodes dispatch to the definition.
- Validation — `isWorkflowNodeData` (`src/workflow/validation.ts`), single guard. Order:
  1. Base fields (`label`/`description`/`preview`/`nodeType`/`nodeDataVersion`).
  2. Unknown type → missing-plugin (requires valid `portsSnapshot`).
  3. Core but version-incompatible → preserved as-is.
  4. Otherwise validate optional fields by shape.

## Versioning

- `dataVersion`: `MAJOR.MINOR.PATCH`. Current values: `currentCoreNodeVersions` (`src/nodes/nodeVersion.ts`).
- Compatibility — `areNodeVersionsCompatible` (`src/nodes/nodeVersion.ts`): MAJOR and MINOR must match; PATCH ignored.
- Incompatible stored version → `kind: 'incompatible-core-node'`; `storedData` preserved for upgrade.
- Core type ids: `coreNodeTypes` tuple (`src/nodes/coreNodeTypes.ts`).

## Registration points (per new core node type)

Compile-enforced:
- `coreNodeTypes` tuple (`src/nodes/coreNodeTypes.ts`).
- `currentCoreNodeVersions` (`src/nodes/nodeVersion.ts`).
- `corePersistence` record (`src/nodes/corePersistence.ts`).
- Data union variant in `ConcreteCoreWorkflowNodeData` (`src/types.ts`).
- Creation definition in `coreNodeCreationDefinitions` (`src/nodes/coreDefinitions.ts`).

Not compile-enforced:
- Palette entry (`src/app/useNodePalette.ts`).
- `fullText` dialog whitelist, if the node opens one (`src/dialogs/StudioDialogs.tsx`).
- CSS class (`src/styles.css`).
- New data fields in `isWorkflowNodeData` (`src/workflow/validation.ts`).

## Prompt image availability

`runActionAwarePrompt` evaluates gallery availability from current connected input
images, independently of vision support. Historical reference images do not disable
search. The `getImageId` runtime option `disableWhenImageAttached` defaults to true,
including older settings; users can turn it off in the action options. Unavailable
actions contribute neither prompt hints nor executable calls. Caption actions keep
their image-input and vision requirements. Image creation remains available for
custom workflows but is not referenced by the bundled V33 prompts.

Normal RP input uses slot 1 with or without images; slot 0 is empty in the bundled
V33 workflows. Messenger input retains slot 0 with images and slot 1 without images.
Narrator and Narrator AutoTurn retain slots 4 and 5.

### Social comment image context

Fotogram and OnlyFriends thread actions resolve the target post's gallery image
in `useGraphRun` before executing the graph. This covers initial comment loading,
load-more, user comments, and regeneration, including initial character posts.
The lookup uses the post's app, ID, and author account/character; it does not depend
on the history-image lookback. The image follows the same input path as a new
social post, and prompt execution omits pixels when vision is unavailable.

### Prompt Switch image diagnostics

The Image Input port continues to show only the connected image wire. A separate
summary uses the current run's prompt-pass diagnostics: for example, `false`
alongside `2 injected` means no wired input image, but two distinct images were
attached to prompts through history or actions. The tooltip lists unique image
counts by source and attachment counts for each request, including planning,
replays, and image-search calls. Repeated images count once in the totals; images
used only in earlier steps remain visible. These are prompt attachment diagnostics,
not confirmation that a model successfully processed a request. The summary clears
with the run's debug state and does not change image routing.

### Historical reference images

`collectRecentReferenceImages` (`src/chat/referenceImages.ts`) uses fixed application
rules: direct RP images remain eligible for five global turns; phone and social
message-card images shown in the RP timeline remain eligible for three. Embedded
and standalone cards resolve to the same persisted messages and image IDs, so an
image is attached only once and viewing a card does not restart its lifetime.
Messenger conversations use ten global turns, plus images in their latest two
messages even beyond that window. Other messenger pairs never qualify.
Automatic references are limited to three images, newest first. Social runs
retain their separate app/direct-message scope; unknown app initiatives attach
no automatic references. Vision capability is still required.

Manual selections and replied-to images bypass the age and automatic count limit,
but belong to the current view/conversation. Switching conversations clears manual
selection; `additionalImageScope` also prevents a selection captured in one view
from leaking into a run for another. Reply targets must match the conversation.
`useGraphRun` supplies the actual run scope and `App.tsx` supplies the preview scope.
The Reference Images options tab has been removed. Legacy saved settings remain
readable but no longer control these rules and are omitted on subsequent saves.

## Invariants

- Load validates fully, then commits atomically; incompatible or corrupt nodes are preserved as placeholders, never coerced.
- Node data media URLs use the `data:` scheme only.
- Custom-node code runs in a Web Worker inside a sandboxed iframe (opaque origin, deny-all CSP, no file/network/Electron access, postMessage only) — `src/nodes/custom-node/sandbox.ts`.
- Plugin node type ids are namespaced `owner/name`.
- `singleton` node types allow one instance; the constraint is enforced at add time.

## Reference files

| Concern | File |
| --- | --- |
| Definition & port types | `src/nodes/types.ts` |
| Core definitions | `src/nodes/coreDefinitions.ts` |
| Registry | `src/nodes/registry.ts` |
| Core type ids | `src/nodes/coreNodeTypes.ts` |
| Versions & compatibility | `src/nodes/nodeVersion.ts` |
| Persistence table | `src/nodes/corePersistence.ts` |
| Data union | `src/types.ts` |
| Renderer & dispatch | `src/nodes/WorkflowNodeRenderer.tsx`, `src/App.tsx` |
| Shared card behavior | `src/nodes/shared/CardView.tsx` |
| Ports & compatibility | `src/graph/portCompatibility.ts` |
| Persistence routing | `src/workflow/persistence.ts` |
| Validation | `src/workflow/validation.ts` |
| Hydration & size strip | `src/app/workflowHydration.ts` |
| Styles | `src/styles.css` |
