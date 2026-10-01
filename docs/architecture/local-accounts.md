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
The directory is first renamed to a `.deleted-<username>-<id>` staging name, which
is never a valid username. A failed rename leaves the account unchanged; a failed
or interrupted purge is finished the next time accounts are listed.

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
verifier and filename-privacy preference, never the password. Account/folder names
and legacy filenames remain public; new account-encrypted filenames are protected
by default.
This is file encryption, not an encrypted filesystem or OS permission boundary.

Credentials live only in application-session memory. File save dialogs default to
Account encrypted and reuse the signed-in password with the existing RPGraph file
envelopes, random salts, and encryption implementation. Users can explicitly select
Plain JSON. Matching files unlock automatically; files encrypted with another
password retain the manual unlock flow. Account saves use the account password even
after importing a file encrypted with another password. New encryption-envelope
versions retain readers for the previous versions; payload versions are unchanged.

Options → Accounts provides **Protect new encrypted filenames**, enabled by default
per account. Only new files encrypted with that account password receive protected
names. Without an account, manually encrypted files retain readable names. Loading
does not rename existing files. Explicit protected overwrites convert
long V1 encrypted names to compact V2; disabling the preference preserves existing
names and does not prevent reading them.

`electron/filenamePrivacy.cjs` independently encrypts the UTF-8 basename using
scrypt and AES-256-GCM. Filenames start with `WF2xQ` (workflow), `RP2xQ` (RP save),
`CH2xQ` (Character Container), or `SB2xQ` (Storybook), followed by a Base64url token
containing the full 16-byte authentication tag and encrypted name. Salt and IV
are stored as public parameters in the small `filenameEncryption` header, with no
readable name or password. Name lookup reads at most 4096 bytes of that header.
Type and approximate
name length remain visible. The tag authenticates the name and type marker; wrong
passwords display **Encrypted … (open to unlock)** until manual unlocking succeeds.
Keys and resolved names are cached only in session memory and cleared on logout.
Normally one filename-key derivation serves the whole account directory, without
opening or decrypting file payloads to recover names. Protected basenames support
up to 128 UTF-8 bytes (202 filename characters); longer names require a shorter
name instead of a plaintext fallback. A 20-byte ASCII basename produces 58
characters including its marker and `.json`, versus 96 in V1. V1 markers remain
loadable with their embedded parameters. Existing metadata/NPC scans continue
separately.

New envelopes are Workflow/RP save 3.0 and Storybook/Character 2.0. Readers retain
Workflow 2.0, RP save 2.1, and Storybook/Character 1.0 support and original AAD.
Character 2.0 envelopes no longer expose `characterName` outside the encrypted
payload. Physical filenames remain the IDs for load/delete/overwrite and workflow
state. Overwrite preserves V2 IDs except when rekeying a foreign protected filename
for the account password. V1 conversion also replaces the physical ID; that
replacement is written before removing its source.

Window headers use the unlocked display names for Workflows, Storybooks and RP
saves, including startup unlocks and saves to a chosen location. These names are
cached only in renderer memory; physical filenames remain storage identifiers.
RP save payload metadata can also carry optional Workflow and Storybook display
names so embedded content retains its labels without the original files. These
labels are inside the encrypted payload when saving an encrypted RP save, never
in its public envelope or filename header. Older saves without these optional
fields still load and use available file-list names or embedded content titles.

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
The user accepts this variable persistence for the intended use; see the review
below for the documented boundary and the implemented protection of filenames.
API keys use Electron `safeStorage` independently of the account password. New
keys remain in memory when secure OS storage is unavailable; Linux `basic_text`
is not accepted for new encrypted saves. Existing readable payloads can still be
loaded for migration. Unreadable encrypted key payloads are preserved per provider
while the remaining settings load normally. A failed settings file load disables
automatic settings writes until the file is repaired and the app restarted.
Atomic settings and authored-file writes use mode `0600` on POSIX systems;
Windows access control remains subject to the enclosing directory's ACLs.

ChatGPT provider registrations and OS-encrypted OAuth credentials are also scoped
to the selected root, in `chatgpt-profiles.json`. Switching local workspaces leaves
saved sessions intact and cancels pending requests and browser sign-in operations.
Multiple model presets reuse a profile without another sign-in. The installation's
opaque host ID remains shared in the main user-data directory. See
[ChatGPT provider](chatgpt-provider.md).

See [the password and privacy review](../local-accounts-privacy-review.md) for the
reviewed data paths, fixes, and remaining design limits.

The first-run preference remains in `rpgraph.accountFeature` in local storage.
Account files and settings use the selected filesystem root; cosmetic browser
preferences are still shared. Password reset and password changes are not implemented.
