# App.tsx Refactoring Plan

## Goal

Turn `src/App.tsx` into an orchestration shell that connects focused controllers,
hooks, and presentation components. The file should describe the application at a
high level instead of implementing individual workflows.

Current baseline on `refactor/app-cleanup`:

- `src/App.tsx`: approximately 6,990 lines
- Workflow variable management: extracted to `src/app/useWorkflowVariables.ts`
- Workflow assistant snapshot preparation: extracted to
  `src/assistant/workflowSnapshot.ts`

The estimates below are directional. Some areas overlap, so their line counts must
not be added together as an exact total.

## Extraction Ranking by App.tsx Reduction

The ranking is ordered from the largest likely reduction to the smallest.

| Rank | Area | Estimated App.tsx reduction | Proposed destination | Main code to extract |
|---:|---|---:|---|---|
| 1 | Rendered application shell and overlays | 1,250-1,400 lines | `src/app/AppWorkspace.tsx`, `src/app/AppOverlays.tsx` | Main React layout, graph panel, chat drawer, phone panel, Storybook creator, assistants, reports, previews, and studio dialogs |
| 2 | Roleplay interaction actions | 700-850 lines | `src/app/useRoleplayActions.ts` | Regeneration, undo, edit-and-retry, chat submission, output-action choices, social posts, social threads, direct messages, phone submissions, event runs, and AutoTurn |
| 3 | Workspace persistence and hydration | 600-750 lines | `src/app/useWorkspaceLifecycle.ts` | Session snapshots, save payloads, session clearing, locked startup clearing, file application, workflow preparation, hydration, reset behavior, and flow initialization |
| 4 | Storybook and phone-image pipeline | 450-550 lines | `src/storybook/useStorybookPhoneImages.ts` | Phone contact changes, wallpapers, social usernames, image lookup, image copying, caption propagation, external-image pruning, and phone-image action application |
| 5 | Custom node assistant controller | 400-470 lines | `src/app/useCustomNodeAssistant.ts` | Assistant history, diagnostics, prompt submission, generated definition application, reset, structure checks, security review, test-button execution, and dialog opening |
| 6 | Graph editor interaction controller | 350-450 lines | `src/app/useGraphEditorController.ts` | Node deletion history, edge restoration, copy and paste, keyboard shortcuts, selection handling, panel resize behavior, and React Flow initialization |
| 7 | Debug snapshot assembly | 250-320 lines | `src/app/useDebugSnapshots.ts` | Full debug snapshot construction, assistant debug sections, Storybook image-description lookup, and memoized snapshot refresh |
| 8 | Translation and displayed-output analysis | 230-300 lines | `src/app/useOutputProcessing.ts` | Speaker attribution, output analysis, input/output translation, emoji shielding, recent-history context, and streamed translated text |
| 9 | Voice provider and playback coordination | 200-270 lines | `src/app/useVoiceRuntime.ts` | Narrator and clone-provider options, provider warnings, voice-mode availability, playback lifecycle, close cleanup, and run-transition cleanup |
| 10 | Opening-message and history synchronization | 170-230 lines | `src/chat/useOpeningHistorySync.ts` | Opening-message insertion, replacement, timeline synchronization, node preview updates, and derived history text refresh |
| 11 | Application-level utility clusters | 100-160 lines | Focused files under `src/app`, `src/chat`, and `src/utils` | Phone notification audio, loaded-message seen state, event character resolution, assistant connection persistence, and other domain-specific helpers |

## Important Ranking Note

Rank 1 produces the largest visible line reduction, but it should not be implemented
first. Moving the current JSX immediately would create one or two components with a
very large prop list and would merely move the coupling elsewhere.

The presentation split becomes valuable after the controllers in ranks 2 through 9
provide smaller, domain-shaped interfaces.

## Recommended Implementation Order

### Phase 1: Extract contained controllers

1. Extract the custom node assistant controller.
2. Extract the Storybook and phone-image pipeline.
3. Extract debug snapshot assembly.

These areas have recognizable boundaries and can be moved without changing file
formats or the graph execution contract.

### Phase 2: Separate workspace and user actions

4. Extract workspace persistence and hydration.
5. Extract roleplay interaction actions.
6. Extract graph editor interactions.
7. Extract translation and displayed-output analysis.
8. Extract voice provider and playback coordination.
9. Extract opening-message and history synchronization.

These controllers must preserve the current immediate-ref update behavior. Async
continuations rely on refs such as `nodesRef`, `messagesRef`, and workflow-variable
refs seeing state changes before the next React render.

### Phase 3: Split the rendered shell

10. Create `AppWorkspace` for the top bar, graph area, chat drawer, phone panel, and
    events panel.
11. Create `AppOverlays` for dialogs, assistants, reports, previews, and onboarding.
12. Keep only app-wide composition, shared providers, and controller wiring in
    `App.tsx`.

## Target Shape

A realistic target is an `App.tsx` between 1,500 and 2,500 lines. Reaching a smaller
number is not useful if it requires a single replacement component or hook with an
equally large parameter list.

The final file should primarily contain:

- app-wide settings and graph state ownership;
- focused controller and hook composition;
- context-provider composition;
- the small set of values shared across multiple domains; and
- high-level rendering of `AppWorkspace` and `AppOverlays`.

## Extraction Rules

Each refactoring step should follow these rules:

1. Preserve behavior before improving behavior.
2. Do not change workflow, session, Storybook, or node formats during structural
   extraction.
3. Keep immediate ref writes where asynchronous code depends on them.
4. Prefer a focused controller API over dozens of individual component props.
5. Move domain helpers with their controller instead of leaving private helper logic
   in `App.tsx`.
6. Avoid creating a new catch-all `appUtils` or `useAppController` module.
7. Run ESLint on touched files, `npm run build`, and `npm run check:unused` after each
   completed extraction.
8. Update this document when an area is completed or its estimated boundary changes.

## Completed Work

| Status | Area | Result |
|---|---|---|
| Complete | Workflow variable management | Variable discovery, resolution, editing, command updates, and runtime refs moved to `src/app/useWorkflowVariables.ts`. |
| Complete | Workflow assistant snapshot preparation | Snapshot sanitization, truncation, filtering, and serialization moved to `src/assistant/workflowSnapshot.ts`. |
| Complete | Workflow capability detection | Capability calculation moved to `src/app/useWorkflowCapabilities.ts`, with the visual strip in `src/components/WorkflowCapabilityStrip.tsx`. |
| Complete | Custom node assistant controller | Assistant state, diagnostics, definition checks, security review, test execution, and dialog control moved to `src/app/useCustomNodeAssistant.ts`. |
| Complete | Storybook and phone-image pipeline | Contact settings, image-library updates, caption propagation, LLM image actions, and external-image pruning moved to `src/storybook/useStorybookPhoneImages.ts`. |
