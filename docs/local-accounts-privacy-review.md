# Local account password and privacy review

Scope: account creation, login/logout/deletion, session credentials, workflow,
Storybook, RP-save and character encryption, NPC auto-unlock, settings persistence,
temporary files, logs, browser storage, and authored debug exports. Static review
and non-UI tests; no application, browser, or Electron session was launched.

## Encrypted content follow-up

The follow-up specifically traces authored Workflow, Storybook, character and
RP-save content rather than account metadata or provider credentials. Account
metadata visibility is accepted for this scope.

**Result:** the encrypted-file save/load boundary protects the complete JSON
payload, including nested Storybooks, character data, embedded media and debug
state. No plaintext temporary file or decrypted library cache was found in those
paths. RP workflow variables are also automatically persisted in plaintext settings
after a protected save is loaded. The user accepts this behavior because these
variables are not considered sensitive in the intended use. See the accepted
variable-persistence section below.

The reviewed path is: renderer save choice → preload request → the relevant main
process save handler → JSON serialization inside AES-GCM → encrypted envelope →
atomic temporary file → rename. Both named/internal and selected external paths
use this order. RP quick saves also encrypt before writing. If encryption fails,
the existing file remains untouched; the code does not fall back to plaintext.

On load, the file is read as an encrypted envelope, its crypto parameters are
validated, scrypt derives the key, and GCM authentication must complete before
parsed content is returned over IPC. The read/decrypt boundary itself performs no
plaintext write. Workflow state records filenames/default-import metadata only.
Character/NPC caches retain unlocked content in memory. Encrypted Storybooks are
not automatically decrypted by the on-disk NPC scan. Legacy character/Storybook
migration is performed in memory and does not rewrite the source until a save.

Password selection is covered for all four file types and both save destinations:
without an account the manually entered file password is used; when signed in,
encrypted saves use the account password even when the current content was
unlocked with another password. This chooses KDF input, not a shared raw AES key:
fresh salt and IV produce independently protected saves. Explicit Plain JSON is
an intentional export choice. Exporting a whole plain workflow/RP save can also
expose characters imported from an encrypted source because they are then part
of that newly exported payload.

## Accepted variable persistence

**Current behavior: restored RP variables are saved in plaintext settings.**

The user explicitly accepts this persistence and does not require a change to
workflow-variable storage. It is no longer an open P1 finding for the agreed
scope. The technical path below remains documented so that this acceptance is
not confused with encryption of those settings.

`src/App.tsx` calls
`replaceWorkflowSettingsValues(sessionState.workflowVariables)` inside
`applySessionFile`, including for encrypted RP saves.
`src/app/useWorkflowVariables.ts` implements that replacement through `setValues`,
which is wired to `useAppSettings.setWorkflowSettingsValues`. The automatic save
effect in `src/settings.ts` includes the values in
`options.workflowSettingsValues`. `electron/main.cjs` encrypts API keys only and
writes the remaining settings JSON in plaintext. Signing into an account does not
block this path. Runtime commands that update these variables use the same state.

A private string stored in an encrypted RP save's `workflowVariables` can therefore
be copied into `settings.json` after opening the save, without explicitly saving
or copying that string. This does not expose the entire Storybook, graph or media
pool automatically; the affected data is the restored/updated variable map.
Other protected content copied into such a variable is affected too.

The settings hook test characterizes this behavior using a private marker while
signed into an account. It documents the persistence boundary, not encryption of
settings. No persistence-policy change is planned for the accepted variables.

## Account filename privacy

Account filename protection is implemented and enabled by default. Options →
Accounts exposes **Protect new encrypted filenames**. The preference is stored as
`filenamePrivacy` in that account's `account.json`; missing preferences default to
true. Only new files saved with the signed-in account password receive protected
names. Manual-password saves without an account, saves with a different password,
and new Plain JSON exports retain readable names.

The filename has a five-character marker, followed by an encrypted name token
and `.json`:

| Marker | Type |
| --- | --- |
| `WF2xQ` | Workflow |
| `RP2xQ` | RP save |
| `CH2xQ` | Character Container |
| `SB2xQ` | Storybook |

`2xQ` identifies compact filename format V2. The type marker is public and
authenticated. The Base64url token contains a 16-byte GCM tag and the AES-256-GCM
encrypted UTF-8 basename. Its 16-byte salt and 12-byte random IV live in the small
`filenameEncryption` object at the start of the file. This object contains only
`format`, `salt` and `iv`; neither the readable name nor the password is stored
there. Name lookup reads at most the first 4096 bytes and never decrypts the file
payload. The tag still verifies the password and integrity at full length.

The window header uses the readable names returned after unlocking or saving a
Workflow, Storybook or RP save. Renderer name caches remain in memory and do not
replace physical file IDs. Optional display labels in RP save payload metadata
preserve embedded Workflow/Storybook names when source files are unavailable;
encrypted RP saves encrypt these labels with the rest of their payload. Legacy
saves without the labels remain loadable.

The account password and a domain-separated salt derive a filename key with
scrypt (`N=65536`, `r=8`, `p=1`). The public account verifier is never an encryption
key. Names and filename keys remain in session memory, and keys are cleared when
the account session ends. Each new name token has a fresh IV, even for the same
name. A filename reveals its type and approximate name length.

| Basename length (ASCII bytes) | V1 filename characters | V2 filename characters |
| --- | --- | --- |
| 10 | 82 | 45 |
| 20 | 96 | 58 |
| 40 | 122 | 85 |

Counts include the five-character marker and `.json`. V2 removes 28 bytes of
parameters from the filename without reducing key size, IV size or tag size.
Readers also accept V1 markers (`WF1xQ`, `RP1xQ`, `CH1xQ`, `SB1xQ`) with their
original self-contained tokens. Explicit encrypted overwrites with account
filename protection enabled convert those long V1 names to V2. Loading alone
does not rename a file, and disabled protection preserves its existing name.

The account's salt is reused for its filename key, so twenty files normally need
one key derivation and twenty short name decryptions per login. Directory listing
never decrypts file payloads to obtain names. Existing metadata readers still read
JSON envelopes, and the NPC library still performs its existing character unlock
scan; this change does not introduce bulk Storybook/media decryption. Derivations
are serialized and cached, with a bounded cache for foreign salts.

The parameters travel in the file header, allowing copies in another account to
display their names when the password matches. A mismatch or damaged token
displays a label such
as **Encrypted Storybook (open to unlock)**. A successful manual file unlock also
unlocks its name and caches that name in RAM until logout. No plaintext name
index or
readable name field is written inside the file. Workflow state retains the physical
protected filename; file load/delete operations continue to use that identifier.

Named saves resolve conflicts by decrypting filenames rather than file payloads.
V2 files retain their physical names when overwritten, and protected names remain
readable when the preference is disabled. V1 conversion and foreign-password
rekeying replace the physical filename and update the save result/references.
Concurrent named saves are
serialized to prevent duplicate same-name files. Ambiguous duplicate display names
require an explicit physical file or another name. Saving a manually unlocked
foreign file with the account password rekeys its filename as well as its content:
the replacement is written first, then the old file is removed. An interruption
between those steps can leave both encrypted copies, rather than lose the source.

Protected basenames are limited to 128 UTF-8 bytes, producing ASCII filenames of
at most 202 characters (V1 readers accept up to 240). Longer names fail with a
request to choose a shorter name;
they do not silently fall back to plaintext. Atomic writes use short unrelated
temporary filenames so the encrypted name cannot exceed filesystem limits after
adding a temporary-file suffix.

New encrypted envelopes use Workflow **3.0**, RP save **3.0**, Storybook **2.0**,
and Character **2.0**, with version-specific authenticated contexts. Readers still
accept Workflow **2.0**, RP save **2.1**, Storybook **1.0**, and Character **1.0**
and use their original authenticated contexts. Payload format versions are
unchanged. New character envelopes omit the formerly public `characterName`;
the actual character name stays inside the encrypted payload. Legacy envelopes
remain readable with their existing public metadata. Older RPGraph releases
cannot read the new envelopes. No migration or renaming is performed on load,
and external backups are not
rewritten. V1 names are converted only on explicit protected overwrites.

## Findings fixed

1. **P1: API keys could be written without effective encryption.**
   `electron/main.cjs` previously left `connection.apiKey` in `settings.json`
   when `safeStorage` was unavailable. It also relied only on
   `isEncryptionAvailable`, without excluding Linux `basic_text`, which uses a
   hardcoded password rather than a secure secret store. New keys now stay in
   session memory when secure storage is unavailable; the UI explains that they
   must be entered again after restart. Existing readable `basic_text` payloads
   can still be loaded, but that backend is never used for new key writes.
   This does not erase previously saved plaintext keys, backups, or filesystem
   history retroactively. See the [Electron safeStorage documentation](https://www.electronjs.org/docs/latest/api/safe-storage).

2. **P2: An unreadable API key or settings file could destroy recovery data.**
   Key decryption failures previously aborted the entire load, and the renderer
   then enabled automatic persistence of defaults. Key failures are now isolated
   per provider: the original encrypted payload survives settings edits until
   recovery, an explicit API-key edit, or removal of the provider. Explicit key
   edits discard obsolete recovery data so clearing a replacement cannot revive
   an old key; when secure storage is unavailable the replacement is session-only.
   Read/parse/schema failures disable automatic settings writes and show recovery
   instructions. Other settings and usable providers still load when only a key
   cannot be decrypted. Cross-machine key portability is still not provided.

3. **P2: Atomic writes inherited permissive default file modes.**
   Temporary files previously used the default `0666` filtered by the user's
   umask. Settings in the legacy workspace and exports outside private account
   directories could therefore be readable by other OS users. Atomic writes now
   request `0600`, covering the temporary file and its final renamed destination.
   Existing files are restricted when rewritten; untouched files are unchanged.
   This is a POSIX permission improvement, not a Windows ACL implementation.

4. **Memory hardening: temporary cryptographic buffers were left to GC.**
   All four encrypted file types now overwrite their derived key buffers after
   initializing the native cipher. Decrypted chunks and the concatenated plaintext
   buffer are overwritten after parsing, including authentication and JSON errors.
   This reduces extra copies; it does not securely erase immutable strings, live
   application objects, native cipher state, or memory outside the process.

## Password and data paths

| Data | Session path | Persistent representation |
| --- | --- | --- |
| Account password | Login form → preload IPC → `localAccounts.selected`; renderer `accountSession` and file/NPC session state | No authored password persistence found |
| Account verifier | scrypt, fresh 32-byte salt, 32-byte result, timing-safe comparison | `account.json`, mode `0600`; username and salted verifier are public to anyone with file access |
| File password | Save/unlock form or account password → IPC → per-file scrypt key | No password in the encryption envelope |
| Workflow, Storybook, RP save, character | Decrypt and parse in memory; encrypt before writing | AES-256-GCM envelope when encryption is selected; explicit Plain JSON remains supported |
| Protected filename | Account password → cached domain-separated scrypt key → authenticated short name token | Type marker, salt, IV, tag and encrypted basename; no plaintext name index |
| NPC auto-unlock | Account/game passwords and decrypted character cache in `npcLibrary` memory | Original encrypted NPC file; no decrypted cache file |
| API key | Settings and provider requests in memory | OS `safeStorage` payload, or session-only when secure storage is unavailable |
| Other settings | Automatic persistence from `useAppSettings` | Plain `settings.json`, including custom prompt presets, workflow settings values and reference voice samples |
| Browser preferences | Cosmetic preferences, account-feature choice, last username, model IDs and selected connection ID | Shared local storage; no new account/file password writes found. Legacy provider storage can still contain old credentials until migrated |
| Debug/clipboard export | Explicit copy/export actions | Clipboard or chosen export file; sensitive narrative content may be included |

Encryption uses scrypt (`N=65536`, `r=8`, `p=1`), fresh random salt and IV,
AES-256-GCM, and a fixed per-file-type authenticated context. Metadata validation
requires the expected KDF parameters and exact salt/IV/tag lengths before deriving
a key. Authentication must succeed before JSON is parsed or returned. The account
verifier uses `N=32768`, `r=8`, `p=1`: stealing it permits offline password guessing
at a lower cost than guessing against a file. The account password is reused as
KDF input, rather than as a raw AES key or a separately wrapped global master key.

The renderer selects the account password for encrypted saves even after importing
a file protected with another password. Explicit Plain JSON and plain RP quick
saves intentionally remain possible. NPC saves initiated by Storybook removal use
the account password first. Workspace transitions drain file operations, clear
backend credentials/path approvals/NPC service references, unmount the studio,
and clear `accountSession`. This is reference disposal, not guaranteed erasure.

## Larger changes requiring agreement

- **Sensitive settings remain plaintext.** File encryption does not protect custom
  settings prompts, workflow setting values, reference samples, account names,
  legacy/readable filenames, legacy encrypted-character names, or RP-save turn counts. Encrypting
  settings needs a versioned envelope, migration and recovery policy, and a
  decision about portable provider credentials and shared/local workspaces.
- **Passwords remain available to the renderer.** A compromised renderer can
  access the signed-in password and unlocked content. Keeping encryption
  credentials in the main process and exposing only session operations would
  reduce password copies, but requires changing the preload, save/unlock flows,
  workspace protection and NPC password selection. No format migration is needed
  merely to remove renderer credential copies.
- **Password strength determines offline resistance.** Account creation accepts
  even one character, and the public verifier allows offline guessing. A stronger
  creation policy and versioned account KDF upgrade need compatibility decisions
  for existing accounts; no silent verifier-format change was made.
- **Deletion failure recovery remains open.** Recursive removal can leave a damaged
  account after partial failure, as recorded in the V1 review. Staged deletion and
  crash recovery remain separate work.

No automatic full plaintext chat/Storybook/password disk log was found in the
reviewed application write paths. The variable-map exception above is an actual
automatic content write, not merely an OS-level possibility. Provider requests still send selected prompts, content
and API credentials to the configured service. Local provider logs, ComfyUI output
retention, Chromium storage/cache, OS swap, hibernation and memory dumps are outside
the guarantee established by this static review. Copying a turn trace is therefore
not the only possible route by which content can leave process memory.

## Validation

Regression tests exercise unavailable and `basic_text` key storage, per-key
decryption failures, payload preservation/replacement, settings recovery write
blocking, POSIX file modes, and real AES/scrypt round trips for all four file types.
They also reject wrong passwords, modified ciphertext and shortened authentication
tags, and check buffer clearing on success and failure. Existing account lifecycle,
workspace transition, NPC auto-unlock and renderer save tests remain part of the
full non-UI suite. Build, lint, unused-code checks and `git diff --check` also run.

Follow-up tests invoke the real main-process encryption/save/read functions with
real temporary-directory filesystem writes and stubbed native dialogs, without
launching a UI. They inspect every atomic write, verify private text and embedded
media do not appear in temporary-file contents, round-trip named and external
exports, check that decryption performs no writes, and ensure a missing password
does not overwrite an existing encrypted file. Renderer tests cover file/account
password precedence for each content type and destination. A separate settings
test documents the accepted plaintext RP-variable path.

Filename tests cover every type marker, wrong passwords, changed ciphertext and
changed type markers, portable copies, long Unicode names, one key derivation for
twenty names, and key disposal. Compact-name tests also cover header tampering, unchanged
full-size authentication tags, bounded header-only lookup after restart, portable
foreign V2 unlock/rekey, and explicit V1 filename conversion. Real filesystem/IPC
tests cover named and external
account exports, readable listings without payload decryption, conflict handling,
concurrent saves, overwrites, deletion, foreign-password unlock/rekey, preference
boundaries, and legacy-envelope decryption with the original authenticated context.
Renderer tests cover readable header-name resolution, automatic/manual unlocks,
both save destinations, and RP save display-label validation. Filesystem tests
verify that those RP save labels remain inside the encrypted payload and that
corrupted filename headers cannot reuse cached names or pending parameters.
Chosen-location saves ask for confirmation when resolving an encrypted name
would replace a different existing path than the native save dialog selected.
Regression coverage checks that cancellation preserves the original bytes and
that confirmation updates the existing file without creating a duplicate.

Manual validation remains with the user: save/unlock each file type using an
account, import another password-protected file and resave it, explicitly save
Plain JSON, switch/logout, and inspect settings warnings on a system without a
secure key store or with an unreadable saved API key. Toggle filename protection
under Accounts, inspect the five-character type markers on disk, reopen an account,
and copy in a file protected with a different password to exercise manual unlock.
Check the Workflow, Storybook and RP save header labels after opening and saving,
including an RP save reopened without its original Workflow/Storybook files.
