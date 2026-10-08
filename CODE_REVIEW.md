# Code Review: v0.7.4 (main, bb7e64e)

Date: 2026-10-08

## Scope and method

Twenty review agents each searched one area of the codebase for defects. Every
entry below was then checked a second time by reading the cited code. Nothing
was reproduced in the running application, so each entry describes what the
code does, not an observed failure. Two regex findings (items 21 and 22) were
additionally confirmed with a one-line Node evaluation.

Only defects with real user impact are listed: lost work, corrupted state,
broken privacy guarantees, stuck runs, and wrong results without any warning.
Cosmetic issues, hardening ideas, crash-timing durability gaps and findings
whose trigger could not be established are left out. `src/styles.css` and the
test files were not reviewed.

Line numbers refer to commit bb7e64e.

## Status

Updated 2026-10-08 on branch `Review-Fixes-v0.7.4`. Only defects with one
clear, low-risk correction were fixed. Fixes were checked with `tsc -b`,
ESLint and the unit test suite; none was exercised in the running application.

| Item | Status |
| --- | --- |
| 1, 2, 3, 5, 10, 14, 15, 17, 18, 20, 22, 23, 26, 27 | Fixed |
| 9 | Closed. Maintainer confirmed the current behavior is intended |
| 24 | Not a code defect. See the entry |
| 25 | Closed. Maintainer confirmed the current behavior is intended |
| 4, 12, 16 | Deferred. The fix involves a choice of behavior |
| 6, 7, 8, 11, 13, 19, 21, 28 | Deferred. No single correction was clearly right; see notes below |

Notes on the deferred items without a behavior decision:

- 6: a run and a concurrent user edit both change the definition state; which
  one wins has to be decided.
- 7: the check derives capability fields from the model selected when it
  started; merging them onto a connection edited in the meantime needs rules
  per field.
- 8: `runGraph` also returns `false` after a failed run, so restoring the draft
  on `false` would change behavior after errors as well.
- 11: the narrow fix needs a fallback speaker name; the general fix moves the
  `try` across about 800 lines.
- 13: the error payload shapes of the providers were not verified.
- 19: a plan bullet is designed as one either/or roll; rolling several markers
  on one line needs a rule for the shared otherwise-part.
- 21: the correct speaker-label format in history text was not established.
- 28: the message state after a cancelled run was not traced.

## Lost or overwritten user data

### 1. Describing a character image overwrites concurrent Storybook changes

- Where: `src/components/AppDialogs.tsx` `describeImage` (1568-1607) and
  `describeImages` (1609-1649).
- Defect: the next Storybook is built from `images` and `activeStorybook`
  captured before `await onDescribeCharacterImage`, then written with
  `onUpdateStorybook`, which replaces the whole Storybook.
- Trigger: start Describe, then click Add Images, remove an image, save a
  caption, or describe a second image while the model is running. Add Images is
  not disabled, and only the same image's Describe button is.
- Impact: images added in the meantime are gone. Their bytes existed only in
  Storybook state, so they cannot be recovered. Other edits are reverted.

### 2. SillyTavern import deletes characters added during the request

- Where: `src/storybook/useStorybookActions.ts` `importSillyTavernCharacter`
  (1179-1212).
- Defect: `currentStorybook` is read before `await nodeLlm.complete`, and the
  result is committed without the "Storybook changed while the assistant was
  working" guard that the creator path has at 462-469.
- Trigger: add a character or edit fields while the import request is running.
- Impact: the commit treats the newer character as removed and deletes it
  without a message; other edits are reverted.
- Related: `validateSillyTavernImportResult`
  (`src/storybook/sillyTavernImport.ts` 99-111) accepts any patch path under
  `/characters/`, so the model can also modify existing characters during an
  import, which the import instruction forbids.

### 3. Undo beyond 50 turns removes messages but keeps the turn's state changes

- Where: `src/data-management/budgets.ts` (`maxCheckpoints: 50`),
  `src/data-management/checkpointStore.ts` `trimCheckpoints` (269-271),
  `src/chat/useTurnRecordState.ts` `applyTurnCheckpointRuntime` (419-425).
- Defect: turns are never trimmed, checkpoints are capped at 50, and a missing
  checkpoint falls back to an empty one, so nothing is restored. Undo is
  enabled whenever any turn exists.
- Trigger: undo a turn whose checkpoint was trimmed, in a session with more
  than 50 turns, including one loaded from a save.
- Impact: the turn's messages disappear while its events, stats, memory,
  Storybook and workflow-variable changes stay. Session state no longer
  matches the transcript.
- Decision (maintainer): keep the cap of 50 checkpoints, because every
  checkpoint stores the before and after state of the nodes a turn changed and
  adds to the save size. Undo is locked once the last turn has no checkpoint.
- Fixed: `turnUndoAvailable` in `checkpointStore.ts` gates the undo button and
  `undoLastTurn`. Opening History turns stay removable.

### 4. Context Compression measures its budget from the wrong start

- Where: `src/nodes/context-compression/execute.ts` (189-199, 223-228).
- Defect: `currentTokens` is measured on the compressed input (summary plus
  remainder), but when it reaches `maxTokens` the cut is computed with
  `prefixEndForTokenBudget(inputValue, maxTokens)`, measured from the start of
  the raw input, including the already summarized prefix.
- Trigger: a cached raw prefix longer than `maxTokens`, which a long RP reaches
  as the cache grows, combined with a turn that pushes the compressed input to
  the limit.
- Impact: the cut falls inside the summarized prefix. The slice length at 227
  becomes negative, so `slice(0, negative)` drops the tail of the new text, and
  the retained suffix repeats text the summary already covers. The model
  receives duplicated or misplaced context with no error. The report also
  describes a stall variant where each turn spends an LLM call and then fails
  with "result is still too large"; that variant was not traced.

### 5. Deleted-node undo stack survives loading another workflow

- Where: `src/App.tsx` `deletedNodeRestoreStack` (1853, 2354-2447).
- Defect: the stack is only pushed, shifted and popped. Loading a workflow,
  Reset and New/Clear workspace never clear it.
- Trigger: delete a node in workflow A, open workflow B, press Ctrl+Z or the
  restore button.
- Impact: nodes and edges from A are inserted into B. Edges attach to any B
  node with a matching ID, and bundled workflows reuse fixed IDs.

### 6. Custom Node writes back the definition captured at run start

- Where: `src/nodes/custom-node/execute.ts` (25, 82-86);
  `src/app/useCustomNodeAssistant.ts` (150-165).
- Defect: the run ends with `customNodeDefinition: { ...definition, state }`,
  where `definition` was read before the asynchronous run. The assistant path
  applies its result to the definition read before the LLM call. The card's
  controls, Reset, Apply JSON and Paste stay enabled meanwhile.
- Trigger: change a slider or toggle, or apply or reset a definition, while a
  Custom Node run or an assistant request is in flight.
- Impact: the change is reverted when the run or request finishes.

### 7. Provider connection edits are reverted when a model check returns

- Where: `src/app/useProviderConnections.ts` `loadConnectionModels`
  (1535-1542, 1595-1601); same pattern at 1706 and 2024.
- Defect: `connection` is copied from `editingConnection` before the network
  call. For every provider kind except `openai-compatible`, the updater at
  1596 returns that old copy and discards the current editing state.
- Trigger: type an API key or model ID while a model list request is pending.
  Pasting a base URL or focusing the model field starts such a request. A
  ComfyUI test generation holds the window open for up to 180 seconds.
- Impact: the typed value disappears. Closing the connection manager persists
  the reverted state, so the key is lost.

### 8. The chat input is cleared before the run can be refused

- Where: `src/App.tsx` `submitMessage` (4824-4856);
  `src/components/CommandPillComposer.tsx` (399-402);
  `src/app/useGraphRun.ts` (529-536, 564-566).
- Defect: `setDraft('')` runs before `runGraph`, and Enter submits regardless
  of `canRunChat`, which only disables the button. `runGraph` returns `false`
  without running when the graph has no RP Output or User Input node, no
  Storybook character, or no selectable character.
- Impact: the typed message is discarded and only a warning appears.

## Broken privacy guarantees

### 9. Game protection is not enforced while an account is signed in

- Where: `electron/main.cjs` `workspace:protection` (5633-5636);
  `electron/workspaceProtection.cjs`; `src/app/useRpgraphFiles.ts` (128).
- Defect: the handler calls `workspaceProtection.activate('')` whenever an
  account is active, so every `workspaceProtection.require` check in the save
  handlers passes. The renderer sets `encryptionRequired` to false when an
  account password exists, so Plain JSON stays selectable.
- Trigger: sign in, load a game-password-protected RP save, then Save As with
  Plain JSON.
- Impact: chat history, Storybook and runtime state of a protected game are
  written as readable JSON.
- Conflict with documentation: `docs/architecture/npc-in-game-assistant.md`
  (157-161) states that protected games "cannot select Plain JSON" and that the
  Electron write handlers reject plain writes. `account-privacy.md` (14-16)
  says the same for signed-in accounts.
- Decision (maintainer): the current behavior is intended. With an account
  signed in, the user chooses between Plain JSON and encryption. No code
  change. The two documents still describe the stricter rule and should be
  aligned with this decision.

### 10. Choose Save Location deletes a same-named save without confirmation

- Where: `electron/main.cjs` `file:save-to-path` (5841-5868) with
  `storedSaveTarget` (744-754).
- Defect: the replace confirmation runs only when `previousFilePath` is unset.
  The branch that sets it, converting a legacy `1xQ` name or re-keying a file
  not owned by the account, is the one that later unlinks the existing file.
  The comment above the check describes the opposite intent.
- Trigger: with encrypted names on, save to a folder that already contains a
  legacy-named or foreign save with the same display name.
- Impact: the older save is deleted after the new file is written, with no
  prompt. The in-app save path returns a conflict in the same situation.

## Runs that hang or fail without a visible reason

### 11. An exception early in `runGraph` leaves the app stuck in "running"

- Where: `src/app/useGraphRun.ts` (642-653, 1131-1134, 1450, 3280-3281).
- Defect: `activeRun.current` and `setIsRunning(true)` are set at 642-653, but
  the `try` whose `finally` calls `finishRun()` starts at 1450. A throw in
  between skips cleanup.
- Trigger found in that window: `inputCharacter!.name` at 1134 when the input
  message has no `speakerName` and no character resolves, for example when
  regenerating a turn from an older save with the narrator selected.
- Impact: `isRunning` stays true, every later run returns at line 498, and
  Stop has nothing to cancel. Only a restart recovers. The call is
  `void runGraph(...)`, so no error is shown.

### 12. Real provider errors are reported as user cancellation

- Where: `src/app/runOrchestration.ts` `isRunCancelledError` (74-82);
  `src/components/AssistantDialog.tsx` (584-592).
- Defect: any error whose message contains "aborted" or "cancelled" counts as
  a user cancel. The assistant dialog does the same for "cancel".
- Trigger: a timeout from `AbortSignal.timeout` ("The operation was aborted due
  to timeout") or a provider message with one of these words.
- Impact: the run ends with "Run cancelled." and the error text is lost. In the
  assistant dialog an empty reply bubble remains with no error.

### 13. Error events inside a streamed response are ignored

- Where: `electron/main.cjs` `consumeLine` (5213-5244), return at 5261-5267;
  same pattern in the composite, Venice and Gemini stream paths.
- Defect: chunks shaped like `{"error": ...}` are skipped, and `finish_reason`
  is recorded but only used when no text arrived.
- Trigger: a provider reports an error mid-stream after sending some content.
  The exact payload shapes per provider were not verified.
- Impact: a truncated reply is returned as a successful turn.

### 14. ComfyUI memory release before a local LLM request never runs

- Where: `electron/main.cjs` `freeComfyMemoryForLocalLlm` (3427-3441) and
  `requestLlmResponse` (2584).
- Defect: the helper passes `{ signal }` as the abort handle.
  `requestLlmResponse` calls `abort.onCancel(destroy)`, which does not exist on
  that object. The resulting TypeError is swallowed by the `catch {}` at 3438.
- Impact: the `/free` request is never sent and the pending marker is never
  cleared, so ComfyUI models stay in VRAM when a local LLM loads. The request
  object is created before the throw and never gets an `error` listener, so a
  refused connection may additionally raise an unhandled error in the main
  process; this second effect was not verified.

### 15. One invalid JSON object in RP Output Actions discards the whole turn

- Where: `src/chat/outputActions.ts` `parseJsonSequence` (615-628), called from
  the `catch` at 733-737.
- Defect: each balanced range is passed to `JSON.parse` without a `try`. The
  call sits inside a `catch` block, so the throw escapes to the run's outer
  error handler.
- Trigger: two or more action objects where one is invalid, for example a
  trailing comma. A single invalid object only produces a warning.
- Impact: the turn is rolled back with "Graph error" after the LLM call was
  already paid for.

## Wrong results without a warning

### 16. LLM Decision turns unreadable output into `false`

- Where: `src/nodes/llm-decision/execute.ts` (36-47, 95-100).
- Defect: when `parseLooseJsonObject` returns nothing, the outputs default to
  `false`, `''` and `0` with no warning and no retry. `booleanValue` also maps
  strings such as `"true."` and `"Yes, definitely"` to `false`.
- Impact: routing takes the false branch whenever the model answers in prose.
  The history node, by comparison, retries and reports format errors.

### 17. An empty number selects option 0

- Where: `src/nodes/text-selector/execute.ts` `selectedNumber` (16-25);
  `src/nodes/phone-message-router/execute.ts` (17-27).
- Defect: `Number('')` is 0, so an empty or whitespace value selects index 0
  instead of nothing.
- Impact: a Text Selector with no number connected outputs "Number 0 Text"; a
  Phone Message Router sends text to its first output when the model returns
  an empty number.

### 18. Action JSON is missed after an unpaired quote

- Where: `src/nodes/shared/promptActions.ts` `jsonObjectRanges` (1237-1279).
- Defect: string state toggles on every `"`, including quotes in prose before
  the JSON. One unpaired quote inverts the state, and the braces of the
  following object are not counted.
- Trigger: a reply with an opening quote that is closed in a later paragraph,
  followed by an action object.
- Impact: the action is not recognized, no warning is raised, and the raw JSON
  appears in the visible reply.

### 19. Only the first probability marker on a line is rolled

- Where: `src/nodes/shared/promptSteps.ts` `rollPlanOutcomes` (170-190),
  pattern at 99.
- Defect: the pattern has no global flag and the line is replaced once.
- Trigger: two markers on one line, such as
  `picks the lock (chance: 70%) and slips past (chance: 40%)`.
- Impact: the second outcome reaches the next pass undecided.

### 20. Event Manager overwrites an event because of a generated ID collision

- Where: `src/nodes/event-manager/execute.ts` (224, 329-365).
- Defect: the fallback ID is `<turn>-event-<index + 1>`, with `index` counted
  separately in the update list and the add list.
- Trigger: the model omits `id` on an update entry that matches no existing
  event, and also adds an event.
- Impact: both get `<turn>-event-1`; the added event replaces the updated one.

### 21. Image context is inserted in the middle of message text

- Where: `src/workflow/textHelpers.ts` `includeImageContext` (71-81).
- Defect: the speaker-prefix pattern `^([^:\n]+:\s*)` matches the first colon
  on the first line, whether or not it ends a speaker label.
- Example: `At 10:30 the bell rang.` becomes
  `At 10:[Image: ...] 30 the bell rang.` in the history sent to the model.
  `**Narrator:** text` has the marker inserted inside the bold markup.

### 22. Context Builder labels capitalize letters after umlauts

- Where: `src/workflow/nodeHelpers.ts` `titleCaseField` (289-294).
- Defect: `\b\w` is ASCII-only, so a word boundary appears after a non-ASCII
  letter.
- Example: `größe` becomes `GrößE`. The label is shown in the UI and sent to
  the model.

## Phone and social apps

### 23. Phone threads merge people who share a first name

- Where: `src/chat/phoneMessages.ts` `phoneNamesMatch` (155-167);
  `src/data-management/selectors.ts` `phoneMessagesBetween` (226-242).
- Defect: two names match when their first names are equal, and threads are
  selected with that comparison. Unread counts use the full normalized name.
- Trigger: "Lena Meyer" and "Lena Brandt" both exchange messages with the same
  contact.
- Impact: one person's messages appear in the other's thread, according to the
  report as that person's own outgoing bubbles, with no unread badge.
- Decision (maintainer): a phone participant is identified by an account link
  or the full name. A first name alone must not match.
- Fixed: `phoneNamesMatch` now compares full names and treats `First Last`,
  `First_Last` and `First.Last` as equal. Messages that an older save stored
  under a first name alone no longer join the character's thread; they appear
  under a temporary contact with that name. `canonicalPhoneName`, which only
  resolves bank transfer parties and accepts nicknames by design, is unchanged.

### 24. A wallet withdrawal credits the bank only partially

- Where: `src/chat/moneyLedger.ts` (135-138).
- Defect: the bank is credited with `min(amount, wallet)`.
  `docs/architecture/money-ledger.md` (35-37) says the wallet is debited only
  by what it holds and "the recipient is always credited in full".
- Trigger: the wallet balance at replay time is lower than at booking time, for
  example after the tip that funded the withdrawal was deleted or undone.
- Impact: the bank balance and the Banking statement disagree, because the
  statement shows the full amount.
- Correction after the review: the partial credit is intended. The test
  "moves withdrawals back to the bank without creating money" in
  `src/chat/moneyLedger.test.ts` asserts it. The code is right; the sentence
  "the recipient is always credited in full" in `money-ledger.md` is too broad
  for withdrawals, and the Banking statement still shows the full amount.

### 25. A retained NPC revision is hidden by a same-named Storybook character

- Where: `src/characters/registry.ts` (161-188).
- Defect: on a name collision every non-Storybook entry is hidden, including
  the `snapshot` tier that holds retired RP revisions.
  `docs/architecture/character-container-v2.md` limits this rule to library
  characters (76-78) and says retired revisions "remain available to app
  histories" (319-321).
- Trigger: make a character an NPC, then add a new Storybook character with the
  same name. The commit only warns.
- Impact: the earlier character leaves the effective registry, so its accounts
  and retained messages no longer resolve, and bare-name references go to the
  new character.
- Decision (maintainer): intended. Two characters cannot share a name, so the
  older one is hidden. No code change. The sentence in
  `character-container-v2.md` that limits the rule to library characters is
  narrower than the behavior.

## Voice playback

### 26. Narrator audio plays after Stop or over the next turn

- Where: `src/chat/useDialogueVoice.ts` `generateAndPlayApiNarration`
  (571-593).
- Defect: the clip is played as soon as the TTS request resolves. The function
  takes no token or abort signal, and `stopDialogueVoice` cannot cancel a
  request in flight.
- Trigger: press Stop or submit a new message while an OpenRouter or Gemini
  narration request is running.
- Impact: the narration starts after Stop or over the new run.

### 27. OpenRouter narration is silent after switching to a non-Gemini model

- Where: `src/chat/useDialogueVoice.ts` (572-591); `electron/main.cjs` (4236).
- Defect: the renderer selects the streaming path from `ttsStreamAudio` alone
  and then waits for PCM chunks without playing the returned clip. The main
  process streams only for `google/gemini-` models. According to the report,
  new OpenRouter TTS presets start with the flag on and the checkbox is shown
  only for Gemini models.
- Impact: the clip is generated and stored, nothing plays, and no error
  appears.

### 28. A cancelled or failed run re-reads the previous turn

- Where: `src/App.tsx` (1500-1516).
- Defect: when `isRunning` turns false, the effect starts voice playback for
  `latestOutputTurnMessages(messages)` regardless of how the run ended.
- Impact: the previous reply is read again. If no clip is stored, this starts
  a new ComfyUI or paid TTS request. The message state after a cancel was not
  traced, so this entry is the least certain in the list.

## Open questions for the maintainer

- Item 9: answered, see the entry.
- Answered: the next two points stay as they are.
- `src/app/useRpgraphFiles.ts` `activateWorkflowSnapshot` (220-226) clears the
  open workflow's file path after every RP save, so Save Workflow then opens
  Save As instead of updating the file. This looks unintended for plain
  workflows but may be deliberate, because an RP save embeds the workflow.
- Persisted OnlyFriends posts are always created with `locked: false`, and
  `postsRequireUnlock` is defined but never read, so the unlock, purchase and
  sale paths described in `money-ledger.md` cannot be reached from the UI. It
  is unclear whether the feature is unfinished or broken.
