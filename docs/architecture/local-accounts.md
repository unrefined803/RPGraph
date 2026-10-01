# Local accounts

`AppEntry` selects the workspace before mounting the studio. `LoginScreen` supports
first-run setup, account creation, and password-verified sign-in. The Accounts
options provide account creation, login, logout, and password-confirmed deletion.
Switching workspaces closes the studio after confirmation to save pending work,
then opens account selection without restarting. Account setup waits for pending
settings writes and cancels LLM requests. Workspace transitions block new file and
settings operations and wait for active operations before changing or deleting the
root, including pending encryption, native file dialogs, and library reloads.
Deletion removes the selected account's
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
Saving a Storybook character while switching it to an NPC updates an existing
account NPC first, then an existing global NPC. New NPC files use the configured
default export destination.

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

The account verifier uses scrypt with `N=32768`, `r=8`, and `p=1`; file keys use
`N=65536`, `r=8`, and `p=1`. Each encrypted save has a fresh 16-byte salt,
12-byte IV, and 16-byte AES-256-GCM authentication tag. Encryption happens before
the atomic temporary-file write. Temporary key and decrypted byte buffers are
overwritten after use, including failure paths. Passwords and loaded content are
JavaScript strings and objects: clearing session references does not guarantee
secure erasure, and the application cannot exclude OS swap or memory dumps.

Settings are not account-password encrypted. They include provider configuration,
custom prompts, workflow settings values, and embedded reference voice samples.
RP-save loading restores workflow variables into this settings state, so private
variables from an encrypted RP save can currently be persisted in plaintext.
This is an open content-privacy finding; see the review below.
API keys use Electron `safeStorage` independently of the account password. New
keys remain in memory when secure OS storage is unavailable; Linux `basic_text`
is not accepted for new encrypted saves. Existing readable payloads can still be
loaded for migration. Unreadable encrypted key payloads are preserved per provider
while the remaining settings load normally. A failed settings file load disables
automatic settings writes until the file is repaired and the app restarted.
Atomic settings and authored-file writes use mode `0600` on POSIX systems;
Windows access control remains subject to the enclosing directory's ACLs.

See [the password and privacy review](../local-accounts-privacy-review.md) for the
reviewed data paths, fixes, and remaining design limits.

The first-run preference remains in `rpgraph.accountFeature` in local storage.
Account files and settings use the selected filesystem root; cosmetic browser
preferences are still shared. Password reset and password changes are not implemented.
