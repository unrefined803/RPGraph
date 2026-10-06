# Character Container V2

Character Containers and Storybooks share the character payload defined in
`src/characters/character.ts` and validated by `shared/character-container.cjs`.
The portable wrapper is `{ "format": "rpgraph-character", "version": "2.0.0",
"character": { ... } }`. Storybook payloads use version 3.0.0 independently.
Encrypted character and Storybook envelopes use version 2.0; older supported
envelopes remain readable. See `src/storybook/formatVersions.json`.

## Canonical data

| Field | Responsibility |
| --- | --- |
| `id` | Stable identity, independent of filename, name and Storybook node. |
| `name`, `age`, `gender` | Character identity and optional metadata. |
| `description`, `personality`, `speechStyle`, `role` | Authored characterization. |
| `playable` | Player selection eligibility within the active Storybook. Library entries are non-playable. |
| `images` | Character-owned gallery with stable IDs, embedded media and descriptions. |
| `profileImage` | Gallery image reference and optional percentage crop. |
| `apps` | Stable account IDs, enabled state, bio, avatar, profile name and app-specific data. |
| `relationships` | Stable target character IDs with descriptions and per-app access flags. |
| `agencyTags`, `hiddenAgency` | Structured traits and private free-text motivations. |
| `phoneSettings`, `banking`, `voiceConfig`, `comfyConfig` | Character settings retained by the shared payload. |

Social apps use one canonical `profileName`; WhatsUp uses the real character
name. `username`, `displayName` and runtime `social` projections are compatibility
data, not parallel authored names. See [App profile names](app-profile-names.md).
WhatsUp and Fotogram are provisioned when absent; explicitly disabled accounts
remain disabled. OnlyFriends and MatchMe are optional. MatchMe discovery requires
a valid adult profile and one to three gallery photos.

Gallery references are scoped to their character owner. Portraits, avatars,
MatchMe photos and starting publications reference existing image IDs. Duplicate
or dangling references fail validation. Portrait crops remain references rather
than duplicate media. See [Character creator](character-creator.md) for safe
inspection, editing, image normalization and portrait tooling.

Two optional account fields support hidden identities and are documented in
[App profile names](app-profile-names.md): `apps.whatsup.alias` (a second
WhatsUp name with its own picture, linking to the same account) and
`apps.matchme.avatarCrop` (the face region of the dating avatar). Both are
additive; the container version is unchanged.

## Library discovery and identity

`electron/npcLibrary.cjs` scans bundled containers, the global user NPC directory,
the selected account's NPC directory and plain saved Storybooks in the selected
workspace. Scans are shallow; files are recognized by validated format and
payload rather than filename. Invalid entries produce diagnostics. Browser
mode uses bundled entries only.

Encrypted character files remain locked until a matching active game/account
password is available. Decrypted entries remain in memory. Encrypted Storybooks
are excluded from automatic discovery. See [Character Assistant](npc-in-game-assistant.md#save-destinations-and-overrides)
and [Local accounts](local-accounts.md) for password and workspace boundaries.

Effective precedence is active Storybook, retained RP revision, account NPC,
global user NPC, saved Storybook, then bundled NPC. Saved Storybook duplicates
resolve by modification time, then filename. Ambiguous character files are
reported rather than arbitrarily merged. Saved Storybook entries are prepared
NPC copies with their own posts, taken from one selected source per Storybook;
see [Saved Storybook NPC sources](character-creator.md#saved-storybook-npc-sources).

Character IDs and account IDs establish identity. Same-name Storybook characters
are rejected after case folding and whitespace normalization. A library character
with another ID but the same normalized name as an active Storybook character is
hidden from discovery with a warning. Promotion preserves stable identities,
account references, conversations and seed-post references.

Fresh discovery uses effective character containers. Old demo and dynamic social
identities remain readable for historical activity; they do not authorize new
social messages or comments. New activity requires a loaded character with an
enabled account. MatchMe additionally requires an application-created or authored
starting match. Account-sharing instructions belong in workflow prompts, not in
execution-engine account directories.

## Runtime revisions and persistence

Interacting with library NPCs can capture their exact character revisions and
media in the RP participant archive. Matches, likes, connections and shared
account references can retain snapshots as well as messages. Library edits and
reloads do not replace pinned revisions. Saved snapshots keep their media and
identity when source files are changed or removed.

RP saves and Opening History carry the relevant archive and checkpoints. Importing
an NPC into the Storybook makes it playable without duplicating its app presence.
Retiring a used playable character keeps its revision as a non-playable participant.
There is no linked-only storage mode or user setting to disable NPC embedding.

## Format compatibility

`src/characters/migration.ts` converts legacy standalone and nested payloads when
explicitly invoked. Loading a workflow or session does not silently migrate its
Storybook. Incompatible Storybook nodes use Upgrade Node and then the Update
Storybook review. Legacy content is excluded from runtime lookup and execution
until updated. Cancellation leaves source content intact.

Standalone imports retain conversion review; encrypted inputs must be unlocked
before conversion. Source files are rewritten only by an explicit save. The CLI
entry point is `npm run character:migrate-v3 -- --input old.json --output new.json`;
existing outputs require `--overwrite`.

## Storage responsibilities

| Action / data | What is stored |
| --- | --- |
| Save Storybook | Current canonical character payloads, galleries, profiles, scenario and already configured Opening History, including its non-playable pinned NPC archive. It does not automatically copy the current chat into Opening History. `currentStorybookForSave` and `rpStorybookJsonText` retain app metadata. |
| Import current session as Opening History | Existing turns, relevant checkpoints, scheduled events and the existing likes/directory/connections/notes/ChatGPD snapshots, plus the current pinned NPC archive needed by history and undo. Character payloads are retained unchanged by spreading the current Storybook. Live posts remain structured `socialPost` records in these turns. |
| Save RP | Workflow including Storybook character profiles/gallery, the pinned NPC revision archive, runtime snapshots, checkpoints and the structured timeline with posts, DMs, matches and other game state. The existing media pool handles serialization copies. |
| Export Character | One portable character with gallery and app profiles. No initial publications, DMs, reactions, swipe history, matches or private image-sharing metadata. |
| Export Character with Own Posts | The same portable payload plus a read-only snapshot of this character's own current publications and existing starting publications under the existing `apps.fotogram/onlyfriends.initialPosts`. Only post ID, text and image ID are copied. Required gallery records are gathered once per image ID. Foreign publications and engagement are excluded. Missing media aborts export. |
| Import starting publications | Stable initial-post IDs remain in the imported character. The feed and command post lookup combine them with the timeline, using ownership-scoped runtime keys for library/snapshot seeds and giving an owner-matching timeline post precedence. No second live-post store and no automatic timeline insertion is introduced. Reimport by character ID replaces the same payload and cannot append duplicate seeds. |

Starting publications are immutable source content, not a mirror of ongoing
social activity. New posts and reactions never update `initialPosts` during play.
There is no initial-post deletion/tombstone UI. Different imported characters with conflicting account or
post IDs are rejected instead of silently merging activity.

## Inline account sharing

Use account links directly inside ordinary message text, including messenger JSON:

```json
{"matchMeApp":[{"from":"nova-mm","to":"player-mm","message":"Here is my account: @fotogram:nova.art. You can also reach me at @whatsup:Nova Vale."}]}
```

- Supported prefixes: `@fotogram:`, `@whatsup:`, `@onlyfriends:` and `@matchme:`.
  `@photogram:` and `@whatsapp:` are accepted aliases. App prefixes and names
  are case-insensitive; canonical account IDs retain exact identity precedence.
- Targets can be a full character name, the requested app's profile name
  (also with a leading `@`) or account ID. The longest complete known
  identity is recognized, ending at a word/punctuation boundary. Partial names,
  unknown accounts, disabled accounts and ambiguous aliases remain plain text.
  For names that are also ordinary words, prefer a unique username or account ID.
- There is no autocomplete. Composers show recognized links beneath the input
  as validation feedback. Sent messages render the same links inline in RP chat,
  WhatsUp and social DMs. Own-account links are visibly recognized but disabled.
- Clicking another character's link adds that account to the viewed character's
  connections and opens the corresponding app/conversation. WhatsUp can show a
  new NPC contact with no fabricated message. Every effective character, including
  a library NPC, receives the same stable standard WhatsUp account during
  normalization when the source has no `apps.whatsup` entry. An explicitly
  disabled WhatsUp account remains unavailable. Social links use the existing
  connection rules. MatchMe opens the existing conversation or discovery card;
  it never creates a match or bypasses the active-match requirement. OnlyFriends
  links do not unlock paid publications.
- Recorded account links grant the referenced contact to the recipient, including
  playable recipients, through the relationship rules below. Typing a draft or
  rendering a message alone does not create a connection. Third-party sharing
  does not grant the third party a reciprocal contact.
- Committed links retain their original token plus stable character/account IDs
  in additive message metadata. RP timelines and Opening History preserve these
  bindings. Previously unrecognized tokens (including older empty binding lists)
  resolve against currently available identities; existing bindings remain pinned.
  Renaming a profile name does not rebind a stored link to someone else.
  Shared NPC references participate in the existing snapshot capture policy,
  including third parties, so removing a library file does not discard them.
- WhatsUp connection IDs share the existing per-character connections store,
  whose save/checkpoint normalization retains `whatsup`. Simulated contact
  grants are projected from structured message history. Older saves without
  bindings or phone grants remain compatible; payload format versions remain unchanged.
- Short account-sharing instructions are authored in Prompt After Input in the
  bundled workflows: all WhatsUp prompts and all Social Media prompts
  that can emit private messages, including an explicit MatchMe DM slot. There is
  no automatic account-sharing injection or registry-name list. Existing custom
  workflows can copy the short block into their own prompts. Bound replies tolerate aliases
  only when they resolve to the exact expected sender and recipient. Translation
  shields recognized account tokens so names and handles remain unchanged.
- WhatsUp avatars use the character portrait when present, then fall back to an
  avatar image referenced by WhatsUp, Fotogram, MatchMe or OnlyFriends in that
  same container. Adding a library NPC to the Storybook is therefore not required
  for its existing container image to appear in the phone contact list.

## Hidden agency and tags

`hiddenAgency` stores optional author-only motivations. It is plaintext inside a
plain container, retained by editing and export, and hidden behind a disclosure
in authoring forms. Raw JSON exposes the full data. The authoring assistant can
edit it; Storybook Formatted Text includes it only when its Hidden Agency switch
is enabled. Social reaction context includes it as private characterization.
It does not schedule autonomous actions.

`agencyTags` contains at most two distinct catalog IDs. Per-account tags and
`accountRole` in older payloads are ignored and dropped on normalization.
See [NPC Agency Tags](npc-agency-tags.md) for eligibility and context rules.

## Contacts and relationships

The shared Character Container V2 payload has an optional `relationships` array.
Storybook characters, portable exports, the Character Assistant, NPC discovery,
CLI inspect/edit and saved NPC snapshots preserve the same representation:

```json
{
  "relationships": [
    {
      "characterId": "character-maya",
      "description": "Maya is her older sister. They speak regularly but disagree about money.",
      "apps": { "whatsup": true, "fotogram": true }
    },
    {
      "characterId": "character-jules",
      "description": "Jules is an artist whose work she follows online.",
      "apps": { "onlyfriends": true }
    }
  ]
}
```

Each target occurs once. Self-links, malformed descriptions, unknown app keys
and non-boolean flags are rejected by the shared validator. Descriptions may be
empty or contain multiple sentences. Missing app flags mean false. Descriptions
and bare name mentions never create connections. An empty list means no authored
connections; new characters use this explicit default.

| App | Meaning | Direction |
| --- | --- | --- |
| `whatsup` | Knows the target's phone number | Owner to target |
| `fotogram` | Follows the target | Owner to target |
| `onlyfriends` | Follows the target; no paid unlock or wallet charge | Owner to target |
| `matchme` | An established match before the story | Mutual |

Connections require available enabled accounts. A missing NPC, disabled account
or ambiguous canonical target grants nothing; the authored link is retained and
shown as unavailable in the editor. References resolve only through stable
character IDs, never filenames or fallback names. Adding a contact does not copy
an NPC into the Storybook or make them playable. Promotion retains the same ID;
the effective Storybook definition replaces the Library representation.

### Contacts acquired during play

`src/characters/messageContacts.ts` updates RP-owned character relationships when
a WhatsUp, Fotogram or OnlyFriends direct message is recorded. Both resolved
participants acquire the other character with that app enabled. Fotogram and
OnlyFriends DMs therefore establish mutual follows; an ordinary follow remains
directed. Public posts, profile discovery and activity badges do not establish
personal contacts.

Shared WhatsUp, Fotogram and OnlyFriends account links add the linked character
only to the recipient, including playable recipients, without requiring a click.
Sharing a third party's account does not connect that third party back to the
recipient. Existing MatchMe link navigation and matching rules are unchanged;
these contact updates never create MatchMe matches or paid OnlyFriends access.

Updates merge by stable character ID, preserve existing descriptions and app
flags, and leave new descriptions empty. Unknown, disabled or ambiguous accounts
grant nothing; a stored account ID never falls back to a new namesake. Repeated
delivery is idempotent. Storybook characters are updated in the current node;
Library NPCs are captured first and updated in the RP participant archive. The
source Library files remain untouched. Saves persist both containers through
their existing storage paths, and Opening History imports the current archive.
Loaded RP saves and Opening History also acquire contacts from historical DMs,
covering older files that only stored app connections. Historical backfills also
extend the corresponding turn checkpoints, including portable Opening History
checkpoints, so jumping back removes contacts first acquired by the removed turn.
Earlier and authored contacts remain intact. Regeneration restores the before
state and acquires contacts from the retained input and replacement output.

NPC participant snapshots optionally store `messageContacts`, recording the
original app flags for message-owned contacts separately from the portable
character payload. Removing or replacing messages reconciles only these flags
against the remaining history. Empty, automatically created relationship rows
are removed; descriptions and independently authored app connections survive.
The character revision itself stays pinned, and restoring messages after a
cancelled regeneration restores their contacts. Source Library files remain
unchanged. `src/characters/historicalContactCheckpoints.ts` handles backfilled
Storybook checkpoints; `reconcileNpcMessageContacts` handles pinned NPC contacts.

### Authoring and assistant references

The Storybook Creator, manual Storybook field editor and Character Assistant show
**Contacts & Relationships** with a target picker, four independent checkboxes
and a relationship description. The picker searches the effective Storybook and
NPC directory. Both assistant composers also support `@` followed by at least
one character, returning at most five results. Arrow keys navigate; Enter/Tab or
a click selects a result. Selection inserts a readable mention and attaches a
removable identity reference. It does not itself import a character or grant an
app connection.

Selected references provide the assistant with the stable ID, characterization,
relationships and public account metadata. Binary media, voice samples, private
app history and Hidden Agency are excluded from these reference attachments.
The Storybook's own draft remains authoritative. Existing external relationship
targets can also supply context on subsequent requests. New assistant-authored
links must resolve to the available directory or the resulting cast; existing
dangling links remain editable. The existing Character Assistant profile step
can author relationships and receives the selected reference context.

When an explicit Storybook request adds a selected external character, the model
uses that exact stable ID and the application replaces the model's text-only
object with the authoritative effective container. Accounts, gallery media,
portrait, settings and existing relationships therefore come from the current
user override or built-in source selected by registry precedence. Relationship
edits made in the same request are merged by target ID. Merely mentioning or
linking the character does not import it.

The NPC Library includes effective Storybook characters alongside library NPCs.
Playable rows sort first. Provenance labels identify the source and effective
revision; [Character creator](character-creator.md#library-provenance-and-storage-badges)
describes the current labels and SB/RP storage badges. Ambiguous local files
remain diagnostic rows with promotion disabled.

Playable membership is reversible. Removing a playable character opens a
choice instead of immediately deleting it. An unused character may be deleted
from the Storybook without deleting a bundled or local library file. A used
character can be retired as a non-playable NPC; its exact revision is retained
in the RP participant archive and in portable Opening History. A changed
revision may additionally be saved to or overwrite a character container in
the NPC Library folder. Retired revisions remain available to app histories
and can later be promoted to playable again without changing their stable
character, account, image, or initial-post identities.

A retained snapshot alone does not establish interaction. The Interacted
Characters group requires a private-message exchange in both directions within
the same messenger between a playable character and the NPC. Comments, likes,
matches, one-way messages and NPC-only exchanges do not qualify. See
[Character colors](character-colors.md) for the shared activity classification.
Deletion eligibility examines the selected character's own history references.

Formatted Text includes **Contacts & Relationships** by default and allows it to
be disabled. **Hidden Agency** is independently selectable and defaults to off.
The other character-context outputs include relationships, and app recipient
context includes both the recipient's own descriptions and explicitly attributed
incoming descriptions. An incoming description is never silently reversed into
the recipient's own perspective. These are character data, not commands.

### Migration and runtime state

When loading a legacy Storybook character without `relationships`, visible
Storybook contact pairs become directed WhatsUp and Fotogram entries with empty
descriptions. Hidden pairs remain absent. Existing explicit lists are untouched;
round trips store those lists so this migration is not repeated. The old
`phoneContacts.blocked` field remains readable compatibility metadata, but no
longer drives characters with explicit relationships. Old individually imported
containers start without connections instead of inheriting the whole cast.
Removing an authored list through an assistant patch or manual JSON editing
clears it rather than restoring the legacy default.

Authored social connections are projected alongside independently acquired
runtime connections. RP/Opening History persistence stores acquired connections,
not a flattened copy of authored defaults; removing a default therefore does
not leave an accidental permanent follow. Existing conversations remain visible.
Recorded WhatsUp messages acquire WhatsUp contacts through the message-contact
rules above; they do not grant Fotogram access. Newly added Fotogram follows are directed; already saved
reciprocal follows remain intact. Bundled Fotogram prompts describe per-app access.

Starting MatchMe matches are derived before timeline matches. Later timeline
records, including inactive matches, take precedence and remain effective after
save/reload or checkpoint restoration. A starting match has no invented in-world
date: prompt context describes it as predating the story. The runtime projection
uses an epoch sentinel solely to satisfy the existing timestamp validator; it is
not appended to the timeline as a fabricated event. Starting matches use the same retained NPC archive as other runtime activity.
