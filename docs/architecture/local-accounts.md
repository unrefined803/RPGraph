# Local accounts

`AppEntry` selects the workspace before mounting the studio. `LoginScreen` supports
first-run setup, account creation, and password-verified sign-in. The Accounts
options provide account creation, login, logout, and password-confirmed deletion.
Switching workspaces closes the studio after confirmation to save pending work,
then opens account selection without restarting. Account setup waits for pending
settings writes and cancels LLM requests. Deletion removes the selected account's
complete directory; exports in the shared NPC folder or external locations remain.

The existing `userData/files`, `characters`, and `npc-characters` directories remain
the local workspace. No existing files are moved or converted. Named workspaces use
`userData/accounts/<username>/files`, `characters`, and `npc-characters`, with their
own `settings.json` and `workflow-state.json`. NPC exports default to the global
`userData/npc-characters` folder. Signed-in users can choose Account NPC Library in
the export dropdown to write to their account's `npc-characters` folder. The library
scans both locations, with account entries taking precedence over global entries of
the same character ID. Source tiers and storage identifiers keep identical filenames
in different folders distinct. Bundled content is shared source data
and is imported independently into each workspace. Native file selection starts
inside the selected workspace; explicitly selected external files remain supported.

`electron/localAccounts.cjs` validates portable usernames, rejects path traversal,
normalizes names to lowercase, and verifies passwords using scrypt with random salts
and timing-safe comparison. `account.json` contains the version, username, salt, and
verifier, never the password. File/folder names and account metadata are public.
This is file encryption, not an encrypted filesystem or OS permission boundary.

Credentials live only in application-session memory. File save dialogs default to
Account encrypted and reuse the signed-in password with the existing RPGraph file
envelopes, random salts, and encryption implementation. Users can explicitly select
Plain JSON. Matching files unlock automatically; files encrypted with another
password retain the manual unlock flow. Account saves use the account password even
after importing a file encrypted with another password. No new file format is added.

The first-run preference remains in `rpgraph.accountFeature` in local storage.
Account files and settings use the selected filesystem root; cosmetic browser
preferences are still shared. Password reset and password changes are not implemented.
