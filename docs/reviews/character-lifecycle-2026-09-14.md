# Character lifecycle review — 2026-09-14

## Scope

Reviewed the last five commits at HEAD `d0e5e0d`:

- `d0e5e0d`: NPC Library and removal dialog styling.
- `ae0b092`: Reversible playable character lifecycle.
- `849416c`: Character content comparisons after saving.
- `bdecb92`: Character provenance chains and save destination defaults.
- `fe8409d`: Per-app authored relationships and character references.

Focus: effective character resolution, snapshots, promotion, retirement,
deletion, RP/Storybook persistence, media, authored relationships and library
presentation. This is a focused code review, not a complete application audit.

## Fixed findings

### P1 — Saved social contacts were missed by deletion protection

`characterUsageReasons` recognized canonical and node-scoped IDs but not the
`storybook:`-prefixed IDs persisted by the social directory. With only a
Fotogram/OnlyFriends follow and no chat, deletion could be allowed and leave
a dangling contact. The same omission affected library activity detection.

The check now recognizes prefixed character/account IDs and legacy aliases.
Regression tests first reproduced the omission, then verified deletion is
blocked and retirement preserves the directory identity.

### P2 — Duplicate library IDs could display or edit the wrong source

`NpcLibraryDialog` used a last-entry-wins map even though the registry rejects
duplicate IDs within one tier. Two local files sharing a built-in ID could make
the effective built-in row point at an arbitrary local file, hide duplicate
files, and misrepresent provenance.

The display now selects the registry-compatible library fallback. Unrepresented
files get separate diagnostic rows, stable file-specific keys and disabled
promotion. A unit test covers local precedence, bundled fallback and unresolved
duplicates.

### P2 — Opening a character could select the wrong Storybook

The library callback always opened the first Storybook node. It now receives
the character's owning node ID and opens that editor.

### P3 — Retention was labeled as interaction

Promotion and retirement can retain a snapshot without any interaction. The
middle section and its statistic now explicitly include retained characters,
rather than claiming every entry has interacted.

## Open finding

### P2 — Turn undo can reverse a later manual retirement or deletion

Reproduction:

1. A turn changes a Storybook field, producing a checkpoint containing the
   Storybook JSON before and after the turn.
2. The user subsequently retires a playable character as an NPC.
3. Undo the earlier turn.

`applyTurnCheckpointToNodes` restores the entire old `storybookJson`.
Its active character definition takes precedence over the retained NPC
snapshot, so the character becomes playable again. The same mechanism can
restore a subsequently deleted character or overwrite later authoring edits.

Confirmed with a temporary non-UI reproduction using
`createTurnCheckpointFromNodesForTurnRecord`, `storybookWithRetiredCharacter`
and `applyTurnCheckpointToNodes`. The reproduction was removed after checking.

Relevant code:
- `src/data-management/checkpointStore.ts`: Storybook checkpoint policies and
  `applyTurnCheckpointToNodes`.
- `src/chat/useTurnRecordState.ts`: `applyTurnCheckpointRuntime`.
- `src/storybook/useStorybookActions.ts`: `removeStorybookCharacter`.

Not changed in this pass: a correct fix needs a consistent policy separating
manual authoring/lifecycle changes from turn-owned runtime changes, including
saved checkpoints, regeneration and Opening History. Blindly rewriting old
checkpoints could lose intentional historical changes.

## Validation

- Full non-UI test suite.
- TypeScript project check.
- ESLint on changed TypeScript files.
- Existing tests cover promotion, retirement, stable app/post identities and
  RP save/load with gallery media after library files disappear.
- Added regression coverage for persisted contact references and duplicate
  library fallback selection.
- Application, Electron, browser and UI/E2E tests were not launched.
