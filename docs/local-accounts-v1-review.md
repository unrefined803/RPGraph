# Local accounts V1 review

Reviewed commit: `1b1a385` (`Implement basic local account system v1`).
Scope: account authentication and lifecycle, workspace routing, settings,
file encryption/import/export, and the account NPC library. Static inspection
and non-UI tests only; the desktop application was not launched.

## Fixed findings

1. **P1: Workspace changes could race active filesystem operations.**
   `accounts:prepare` and `accounts:delete` originally waited only for settings
   writes. A workflow save could capture the old files directory, await
   encryption, and later resolve `workflow-state.json` against another account.
   A character save or read could reload the new library or restore old path
   approvals after logout. Account deletion could also race writes that recreate
   part of its directory. `electron/workspaceOperations.cjs` now blocks new
   workspace operations during transitions and drains active operations before
   changing the selected root. Account initialization uses the same gate.
   Tests cover delayed writes across logout/deletion, cleared path approvals,
   concurrent transition rejection, and failed writes/transitions.

2. **P2: Saving a Storybook character as an NPC ignored account files.**
   `App.saveNpcCharacter` searched and saved only the global `user` tier, while
   `useStorybookActions.removalInfo` offered overwrite only for that tier. An
   edited account NPC could therefore create a global copy while its higher
   priority account file remained unchanged. The dialog and writer now choose
   the same destination: an existing account file, an existing global file, or
   the configured default for new files. Duplicate identities still block writes.
   Regression tests cover account overwrite information and destination selection.

3. **P2: A failed startup preference write left account setup stuck.**
   `AppEntry.enterLocalWorkspace` selected the backend local workspace before
   persisting the preference. If browser storage rejected the write, the screen
   stayed at setup but account creation failed because a workspace was already
   selected. Preference persistence now precedes backend selection. A regression
   test verifies account creation remains possible after this failure.

## Open findings and proposed larger changes

1. **P2: Recursive deletion has no recoverable failure state.**
   In `electron/localAccounts.cjs`, `delete` clears the selected account only
   after `fs.rm(root, { recursive: true })` succeeds. A permission or I/O failure
   may occur after some files, including account metadata, have been removed.
   The renderer then displays a deletion error and leaves the studio active
   against a damaged workspace; password verification may no longer permit retry.
   This failure path was identified by inspection, not reproduced on a live OS.

   Proposed solution: after password verification and draining operations, rename
   the directory to a deletion staging area on the same filesystem. Treat that
   rename as the account removal boundary, close the session, and purge the staged
   directory separately. Persist incomplete purge jobs and expose retry status;
   exclude staged accounts from login. Define crash recovery and username reuse
   before implementation. A failed rename should leave the account unchanged.

2. **P2: Cross-machine backups can trigger destructive settings recovery.**
   `electron/main.cjs` uses `safeStorage.encryptString` for API keys, independently
   of the account password. `safeStorage.decryptString` failures propagate through
   `settingsFromDisk` and `settings:load`. In `src/settings.ts`, the load-error path
   sets `settingsLoaded` to true, enabling automatic persistence of default settings.
   A restored account whose OS-encrypted keys cannot be decrypted can therefore
   lose its provider configuration and other settings on the first open. The
   settings recovery behavior predates this commit, but the new complete-account
   backup instructions expose it as part of account restoration. No cross-machine
   restore was attempted during this review.

   Proposed solution: handle decryption failures per key, retain unreadable
   encrypted payloads, load the remaining configuration, and request replacement
   keys explicitly. Never overwrite an unreadable settings file automatically;
   retain a recovery copy and require an explicit reset to defaults. Clarify backup
   portability in the UI. A portable account export should use account-password
   encryption for included credentials rather than depending on the source OS.

## Scope and validation

The current design encrypts authored file saves, not the complete account folder.
Settings and metadata remain outside account-password encryption, and global NPC
exports intentionally remain shared. These are V1 design limits, not additional
regressions attributed to this commit.

Validation completed: production build, ESLint, unused-code checks, the full
non-UI test suite, and `git diff --check`. Interactive validation remains manual:
switch accounts after saving, retry a rejected deletion, edit and overwrite an
account NPC, and verify that new NPC files use the selected default folder.
