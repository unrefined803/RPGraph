# Account privacy and encryption

Account protection encrypts authored file payloads, not the entire workspace.
See [Local accounts](local-accounts.md) for workspace selection and lifecycle.

## File encryption boundary

Workflow, Storybook, RP-save and Character Container payloads, including nested
media, are serialized inside AES-256-GCM before an atomic temporary-file write.
Encryption failure leaves the destination intact and does not fall back to plain
JSON. Decryption authenticates the envelope before returning parsed content over
IPC. Unlocked character and filename caches stay in session memory.

Signed-in account saves use the account password, and the user chooses between
account encryption and Plain JSON. Protected-game rules, which require encrypted
output and reject a different password or Plain JSON, apply only without a
signed-in account;
see [game protection](npc-in-game-assistant.md#save-destinations-and-overrides).
Where plain export is available, it includes the selected payload even if some
of its content originally came from encrypted files.

## Settings and credentials

Settings are not account-password encrypted. Custom prompts, workflow variable
values and reference voice samples are saved in plaintext `settings.json`.
Loading an encrypted RP save restores its workflow variables through
`replaceWorkflowSettingsValues`, which also persists them in settings. Runtime
variable updates use the same path. This accepted persistence policy does not
make the rest of the encrypted RP payload plaintext.

Provider API keys use Electron `safeStorage`, independently of the account
password. If secure OS storage is unavailable, new keys remain session-only;
Linux `basic_text` is not used for new key writes. Existing readable payloads
remain loadable for migration. Unreadable encrypted keys are preserved per
provider. A failed settings load disables automatic writes until repair and
restart. OS-encrypted credentials are not a portable account-password backup.
ChatGPT OAuth profiles have the same workspace scope; see
[ChatGPT provider](chatgpt-provider.md).

## Memory and exposed metadata

Passwords exist in both main-process and renderer session memory. Clearing
references at logout does not guarantee erasure of JavaScript strings, OS swap
or memory dumps. Account names, public password verifiers, legacy readable
filenames and public envelope metadata remain visible to filesystem readers.

Account verifiers use scrypt with `N=32768`, `r=8`, `p=1`; file keys use
`N=65536`, `r=8`, `p=1`. Encrypted saves use fresh salts and IVs. Password
creation accepts any nonempty password up to 1024 characters, so password
strength determines resistance to offline guessing. Password changes and resets
are not available.

Explicit debug/clipboard exports can contain narrative content. Provider requests
send selected content and credentials to the selected service. Provider logs,
ComfyUI output retention and operating-system storage are outside file encryption.
Cosmetic browser preferences are shared between workspaces. POSIX authored-file
and settings writes use mode `0600`; Windows permissions follow directory ACLs.

## Account filename privacy

Account filename protection is enabled by default. Options →
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
scan; filename lookup does not decrypt Storybook/media payloads. Derivations
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
unchanged. Character 2.0 envelopes omit `characterName`;
the actual character name stays inside the encrypted payload. Legacy envelopes
remain readable with their existing public metadata. Older RPGraph releases
cannot read the new envelopes. No migration or renaming is performed on load,
and external backups are not
rewritten. V1 names are converted only on explicit protected overwrites.
