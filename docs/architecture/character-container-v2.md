# Character Container V2 — Implementation Plan

Status: Character Container V2 is implemented through Stage 7. Fresh demo discovery now uses image-backed character containers; image-less placeholders were removed. Stage 8 remains optional.
Character Container V2 and Storybook V3 use independent version numbers.
Last reconciled with the implementation: 2026-09-07.

## Progress at a glance

**Current position: local character containers, registry-backed discovery,
snapshots, shared app context, Storybook promotion, shared creation and the
image-backed demo replacement are implemented. Stage 8 is optional.**

Legend: ✅ implemented · ➡️ next · ⬜ planned. Checked items describe implemented
code; manual interface validation is listed separately.

### ✅ Completed foundation

- [x] Shared Character Container V2 payload and Storybook V3 migration.
- [x] Stable character/account IDs and character-owned gallery references.
- [x] Shared app profile management in Character Setup, both Storybook editors
  and phone apps; automatic Fotogram provisioning and optional other accounts.
- [x] Running-story identity locks and exact recipient resolution.
- [x] Character export with profiles/gallery, optionally including own posts
  without private game history.
- [x] Local initial-post projection and repeatable character import without
  duplicate seeds.
- [x] Profile persistence regression coverage for Storybook, Opening History
  and RP saves; unit tests, build and lint passed in the implementation phase.
- [x] Fresh-context handoff and ordered next-stage plan documented.
- [ ] Manual interface validation by the user — completion not yet recorded.

### ✅ Global NPC library and Storybook promotion

- [x] Stage 1 — registry, ownership and identity contract.
- [x] Stage 2 — NPC directory loading, validation and desktop controls.
- [x] Stage 3 — saved NPC snapshots and media stability.
- [x] Stage 4 — shared app discovery, real MatchMe photos, posts and cross-app
  conversation context (MatchMe → Fotogram).
- [x] Stage 5 — Storybook promotion, duplicate suppression and full round trip.

### ⬜ After the library works

- [x] Stage 6 — shared container creator and explicit demo conversion.
- [x] Stage 7 — replace fresh dummy discovery and finish regression coverage.
- [ ] Stage 8 — optional NPC embedding, linked dependencies by default and
  meaningful-interaction capture rules.

The detailed work and acceptance gates are in section 12. When a stage passes
its gate, check it here, update its status in section 12 and mark the first
remaining stage as next.

Stage 8 records a later user decision that will supersede the automatic snapshot
capture policy from Stages 3–4. Until Stage 8 is implemented, the current behavior
remains unchanged: matches, likes and connections can still capture NPC snapshots.
Stage 7 is implemented; Stage 8 remains a separate optional storage-policy task.

## 0. Fresh-context handoff — read this first

This document is the implementation handoff for the next development phase.
Implement only the stages requested by the user, following the ordered stages
in section 12. The status sections describe
existing code; sections marked planned describe work that is still required.

### User goal and agreed behavior

A user exports a complete character, optionally with their own published posts,
and places the plain JSON container in the dedicated NPC directory. On startup
or explicit reload, the program discovers that character and makes its configured
accounts, gallery and starting posts available to the appropriate phone apps.
The same character is the person behind all of those accounts.

If the same character is imported into the active Storybook, the Storybook
instance takes precedence over the library instance in every app. Suppress only
the duplicate library representation, not the character's effective account.
This applies to every imported character, not only the currently selected player.
Use existing `character.id` and `apps.*.accountId`; do not add another character
ID or deduplicate by display name. Different IDs with the same name are different
people. Importing a library character must preserve its established interactions.

The central acceptance scenario is:

1. Place a container with MatchMe and Fotogram profiles, gallery photos and
   Fotogram `initialPosts` into the NPC directory.
2. Open a story that does not contain this character. Find the character in
   MatchMe, establish a match through the app, and start a conversation.
3. Ask for their Fotogram account. The replying character knows its own actual
   username and public profile metadata and returns the configured handle.
4. Search that handle in Fotogram and find the same person's profile and posts.
5. Import the container into the Storybook. There remains one effective person,
   one account per app and one copy of each post; matches and conversations remain.
6. Save/reload the RP, then remove or change the external file. Previously saved
   interactions and referenced media remain valid through the saved NPC snapshot.

Username search is the first required cross-app handoff. Copyable profile links,
a link parser or clickable deep links are a later enhancement: no link scheme
has been agreed or implemented. Do not invent links in the LLM prompt and assume
the UI can already open them.

Having an account does not automatically establish a phone contact, a follow,
a match or acquaintance. Preserve app-specific discovery and access rules.
Fotogram is provisioned for authored characters under the current normalization;
other accounts remain optional. A character container can carry phone settings,
but its existence does not grant every player a phone conversation with it.

### Confirmed implementation gaps and compatibility traps

- `src/characters/character.ts`, `profiles.ts`, `publications.ts` and
  `messageIdentity.ts` already provide shared payload, profile updates, seed
  projection/export and WhatsUp identity foundations. Extend these rather than
  introducing a second container schema or a second ongoing post store.
- `storyCharactersFromNodes` remains Storybook-only and returns node-scoped
  runtime IDs alongside stable `sourceId`. The pure registry accepts explicit
  legacy aliases. The snapshot runtime now combines Storybook/library/snapshot
  producers. `appCharactersFromRegistry` supplies discovery, account validation
  and recipient context without changing player selection. Promotion retains pinned NPC projection keys and compatible historical aliases
  without rewriting timeline or checkpoint activity.
- Fresh MatchMe no longer adds `datingNpcProfiles`; existing saves restore only
  referenced legacy IDs. Fotogram/OnlyFriends no longer combine cosmetic
  `dummySocialPosts` with real posts or seed runtime discovery from bundled
  catalogs. Thirteen image-backed legacy Fotogram profiles are NPC containers.
- MatchMe discovery now resolves selected photos from the effective character's
  gallery. Legacy demo accounts without gallery data show Photo unavailable.
- Recipient-bound context includes the replying character's characterization,
  actual public accounts, usernames and publication/photo descriptions. Absent or
  disabled optional accounts are represented as null. No profile link scheme is
  invented, and gallery bytes/private messages are not included in this context.
- `postsWithInitialContent` still projects immutable seeds rather than inserting
  timeline records. Library/snapshot seeds use reversible `npcSeedPostKey`
  account/seed keys. Existing Storybook seed keys are unchanged to preserve saved
  likes/comments. Promoted characters with a pinned NPC revision retain NPC seed
  keys, so likes/comments and purchases keep their established references.
  An owner-matching timeline post takes precedence. Export recovers source IDs.
- Image lookup accepts a stable character/account owner. Ambiguous unowned image
  IDs return no image rather than another person's photo. There is still no
  applied-seed ledger or deletion tombstone; do not claim reload-safe deletions.
- Legacy MatchMe decisions/history markers still exist in the existing profile
  compatibility structure; active matches and newer DMs are timeline records.
  Do not copy this legacy private state into public library containers or create
  another independent authority while adding NPC snapshots.
- `shared/character-container.cjs` is now the reusable payload/reference
  validation boundary used by both TypeScript import and Electron discovery.
  Electron's general stored-file metadata recognition remains intentionally
  shallower and must not replace this boundary in future creation tooling.
- Seven authored image-backed MatchMe/Fotogram containers are bundled under
  `resources/npc-characters/`. Their former source PNG directory was removed
  after conversion; the blob-free inspect/edit workflow can preserve, extract,
  unlink, replace or add embedded media without requiring those sources.

### Validation baseline and scope

The preceding implementation phase completed unit tests, build and lint
successfully. Existing regression coverage includes
`src/characters/{migration,profiles}.test.ts`, `src/chat/{socialIdentity,matchMe}.test.ts`
and `src/workflow/validation.fixtures.test.ts`. This documentation update does not
rerun or imply new UI validation. The user performs interface testing.

Read `AGENTS.md` first in a fresh context. Keep repository content in English and
communicate with the user in German. Do not start the app, Electron, a browser or
UI/E2E tests without an explicit request. Do not commit unless requested.


## Implemented foundation and next steps

- Character Container payloads use `2.0.0`. Storybook payloads and the
  `rp-storybook` node data version use `3.0.0`.
  Outer workflow/session and encrypted envelope versions remain unchanged. NPC
  archives are optional additive fields; missing fields in older saves mean an
  empty archive. Embedded documents carry their own versions.
- `src/characters/character.ts` defines the shared character payload: identity,
  playable flag, optional age/gender, gallery, optional app accounts and existing
  description/personality/speech/phone/banking/voice/Comfy settings.
- Storybook stores these payloads directly in `characters`. Export wraps one in
  `rpgraph-character`; import normalizes it and makes it playable. It uses stable
  IDs rather than names for V2 replacement. Conflicting image IDs are rejected.
- Embedded JPEG bytes live in each character's gallery. Portraits, app avatars,
  initial posts and MatchMe photos reference gallery IDs. The portrait bytes and
  legacy `social` fields exist only as runtime projections for existing editors.
- `src/characters/migration.ts` converts legacy standalone and nested documents,
  including workflow Storybook JSON and session checkpoints when explicitly invoked.
  Workflow/session loading does not prompt or migrate embedded Storybooks. Old
  Storybook nodes use the existing incompatible-node card and Upgrade Node flow.
  After upgrading the node, Update Storybook replaces Edit Storybook until the
  user confirms conversion. Legacy payloads stay unchanged on load/save and are
  excluded from character runtime lookup and node execution until updated.
  Standalone Storybook import retains its existing conversion review. Cancellation leaves the current state intact;
  source files are not overwritten until explicitly saved.
- Encrypted envelopes remain opaque to migration. Manual import can decrypt
  first and then migrate the payload. Automatic encrypted NPC loading is not
  implemented and must remain excluded in the future scanner.
- Both bundled default workflows contain V3 Storybooks and V3 Storybook nodes. The shared migration
  can also run without the UI:
  `npm run character:migrate-v3 -- --input old.json --output new.json`.
  Existing output files require an explicit `--overwrite` flag.
- Portable export excludes live MatchMe messages and swipe decisions. Session
  migration retains them. Other runtime story history stays outside the card.

### Implemented local profile and publication phase

The format versions remain **Storybook 3.0.0**, **RP-Storybook node 3.0.0** and
**Character Container 2.0.0**. This is ongoing development within those formats.

- `CharacterAppProfiles` provides the account overview for both Storybook
  editors. Fotogram is provisioned deterministically when absent; existing
  usernames, account IDs and explicit account data are retained. OnlyFriends
  and MatchMe remain optional, including after play begins.
- Setup and the phone share `SocialProfileEditor` for Fotogram/OnlyFriends.
  MatchMe reuses `PhoneDatingScreen` in profile-only mode, with gallery
  selection. Photo uploads remain in the phone/gallery workflow.
- `characters[].apps` owns stable account IDs, usernames, display names, bios,
  avatars and prepared `initialPosts`. `characters[].images` owns image bytes.
  Profile editors update the canonical account and refresh `social` immediately;
  stale compatibility fields cannot override an existing canonical account.
  MatchMe's existing profile structure is retained and its common public fields
  are normalized from the account metadata. Legacy decisions/history markers
  remain compatible with the existing game storage; portable exports remove
  decisions and messages. Active matches and new DMs stay in the timeline.
- Running-story guards protect account IDs, enabled accounts and established
  nonempty usernames as well as character identities. An absent optional account
  can still be created. Gallery references and account/initial-post collisions
  are validated before Storybook commits and imports.
- Social messages resolve exact full character names, the requested app's
  username (optionally prefixed with `@`), or stable account IDs. Duplicate names,
  duplicate handles, and name/handle collisions are rejected. A cross-app handle
  cannot authorize delivery. Unknown recipients are rejected; public generated
  comments may still introduce NPCs through the existing social directory.
  WhatsUp delivery also rejects unknown/ambiguous recipients rather than guessing
  from partial names; existing historical phone contacts remain usable.
- New social and WhatsUp messages retain account IDs. MatchMe uses canonical
  account IDs; existing node-scoped account IDs are read aliases, and structured
  matches are resolved through those aliases without rewriting source history.
  Full-character-name and username aliases supplement the existing MatchMe
  account-ID syntax; direct replies remain bound to the requested account IDs.

### Concrete storage responsibilities

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
There is currently no separate initial-post deletion/tombstone UI; a future
editable NPC seed lifecycle must preserve deliberate removals when applying
library revisions. Different imported characters with conflicting account or
post IDs are rejected instead of silently merging activity.

### Existing messenger command syntax

The existing `messenger_message` / `messenger_conversation` commands and their
app-specific JSON keys remain the only syntax. For example:

```json
{"fotogramApp":[{"from":"Nova Reyes","to":"@jordan.art","message":"Hello!"}]}
```

`from` and `to` accept full character names, usernames belonging to that app, or
stable account IDs. Use an account ID to disambiguate duplicate display names.
`whatsUpApp`, `fotogramApp`, `onlyFriendsApp`, and `matchMeApp` keep their existing
capabilities. MatchMe still requires an active application-created match, plain
message text and exactly the expected IDs for a direct reply. No new parallel
command or automatic recipient creation is introduced.

### Deferred global NPC phase

The pure effective registry, directory scanning, validation, desktop library
controls, pinned NPC revision persistence and registry-backed app discovery are
implemented, including Storybook promotion through the shared import/commit path.
Existing demo catalogs remain. The full target design below continues to describe
the remaining demo discovery replacement and later storage-policy work.
Stage 6 provides the shared creator and explicit staging conversion.
Interactive validation remains with the user.

The sections below describe the full target design, including later phases;
field names in examples are proposals where not implemented above.
Originally prepared: 2026-09-06. Updated handoff: 2026-09-07.

## 1. Objective and binding decisions

Extend the existing RPGraph Character Card into Character Container V2. Use the
same complete character data for Storybook characters and globally available
NPCs. App-specific demo identities must become views of this shared character
registry, rather than independent character definitions.

The user's latest decisions supersede earlier proposals for character folders
containing separate image files or ZIP packages:

- The canonical portable container is a **single plain JSON file** with embedded
  base64 image data, just like the existing character-card export.
- Password-encrypted character export and manual password-assisted import remain
  supported. **Automatic NPC discovery ignores encrypted files without asking
  for a password or attempting decryption.**
- Recognize containers by their format, supported version and validated payload,
  not by the character name or a special filename suffix.
- Keep the implemented character payload version at `2.0.0`; do not repeat the completed V1 migration or bump it for this work.
- Built-in containers and containers placed in a dedicated user-data directory
  are globally available across Storybooks without manual Storybook import.
- App account configuration determines whether a global NPC appears in MatchMe,
  Fotogram, both, or neither.
- Importing a container into a Storybook makes that character playable there.
  The data model stays the same; this is a flag/context change, not conversion to
  a different character class.
- Preserve identity, account IDs and image references when promoting an NPC to
  a playable character. Do not duplicate their profiles or conversations.
- Images belong to the character's gallery and are referenced by apps/posts/DMs.
- Matches, conversations and other story activity remain scoped to an RP save.
- First implement the shared infrastructure. Then inspect the supplied images
  and create the initial image-backed NPC containers, replacing discoverable
  legacy demo entries while preserving identities needed by old saves.

This document is self-contained for continuation. The implementation status above
distinguishes the completed schema/registry/scanner foundation from saved runtime integration.

## 2. Existing implementation and useful entry points

Paths below are relative to the repository root.

| Area | Existing files and behavior |
| --- | --- |
| Character schema | `src/nodes/rp-storybook/model.ts`: `RpStorybookCharacter` has `id`, `name`, `description`, `personality`, `speechStyle`, `role`, gallery images, profile image/crop, phone, social, banking, voice and Comfy configuration. |
| Current versions | `src/storybook/formatVersions.json`: Storybook `3.0.0`, character container `2.0.0`, encrypted character envelope `1.0`. These versions are independent. |
| Card serialization/import | `src/storybook/characterCard.ts`: `RpCharacterCard`, `rpCharacterCardForCharacter`, `planCharacterCardImport`. Cards wrap one character as `{ format: "rpgraph-character", version, character }`. V2 import replaces by stable ID and rejects image/account/post conflicts. Name replacement remains limited to legacy cards. |
| Storybook actions | `src/storybook/useStorybookActions.ts`: `exportStorybookCharacter`, `importCharacterCard`, `beginCharacterCardImport`, `applyCharacterCardToNode`. Plain and encrypted paths already exist. Character import/export and profile management are wired to both Storybook editors. Audit remaining save/history source checks when extending global runtime integration. |
| Electron recognition | `electron/characterCardFormat.cjs`: plain/encrypted metadata and version checks. Current metadata checks are not a substitute for full V2 payload/reference validation. |
| Storage and IPC | `electron/main.cjs`: `charactersDirectory()` is `app.getPath('userData')/characters`; `character:list` and `character:save` list/save exported cards. Default export names currently end in `.rpgraph-character.json`. |
| Renderer bridge | `electron/preload.cjs`, `src/electron.d.ts`: character listing and saving APIs. |
| Runtime characters | `src/storybook/runtime.ts`: `StorybookCharacter`, `storyCharactersFromNodes`, `isStorybookSourceNode`. Runtime IDs currently depend on node ID plus character ID through `storybookCharacterId` in the Storybook model. |
| Image library | `src/storybook/imageLibrary.ts`, `src/storybook/imageUsage.ts`, `src/storybook/useStorybookPhoneImages.ts`: gallery lookup, references, ownership and phone image operations. |
| Save/media infrastructure | `src/data-management/{types,entityStore,mediaPool,timelineStore,sessionStore,validation,checkpointStore}.ts`: timeline, runtime, checkpoints and pooled inline media. Media pooling exists at serialization boundaries, but this does not yet constitute one global character/image registry. |
| MatchMe | `src/chat/{datingAccounts,datingProfile,datingMessages,matchMe,matchMePrompt,socialMedia,socialMessageValidation}.ts`; `src/components/phone-dating/`. Registry-derived accounts share NPC data, photos and recipient context; stable legacy demo accounts remain until Stages 6–7. |
| Social directory | `src/chat/{socialDirectory,socialCatalogs}.ts` and `src/chat/catalogs/`: bundled names/handles and dynamic identities are not full character containers. |
| Fotogram/OnlyFriends feeds | `src/components/phone-social/PhoneSocialFeedScreen.tsx`: saved posts reference gallery image IDs; cosmetic `dummySocialPosts` are still mixed into the feed. |
| Runtime wiring | `src/App.tsx`, `src/app/{useGraphRun,useRoleplayPanelRuntime}.ts`, `src/chat/useTurnRecordState.ts`, `src/graph/executeGraph.ts`, `src/nodes/shared/promptRun.ts`. |
| Packaging | `electron-builder.yml` packages `resources/npc-characters/` into the application resource directory and includes the shared CommonJS validator. Development and packaged roots are resolved explicitly by `electron/npcLibrary.cjs`. |

Preserve existing work and inspect `git status` before implementation. The earlier
`bilder/` reference is historical; no such directory was present at the latest
handoff check. Do not assume image files or their grouping are available.

## 3. Naming and format compatibility

Use **Character Container** as the product-facing term for V2. Suggested labels:
`Import Character`, `Export Character`, `NPC Library`, `Reload NPC Library`,
`Open NPC Folder`, and `Add to Storybook`.

Keep the machine discriminator `rpgraph-character`, the existing default file
suffix and internal file classification `character-card` for compatibility.
Do not rename every existing function or IPC endpoint merely for terminology.
Explain in documentation that a V1 Character Card is the predecessor of a V2
Character Container. Display the detected version in import/library details.

The encrypted envelope remains `rpgraph-encrypted-character`. Keep its envelope
version at `1.0` if encryption structure does not change; the encrypted payload
version becomes `2.0.0`. Never bump envelope versions just to match payloads.

Storybook and the RP-Storybook node stay at `3.0.0`; Character Container stays at
`2.0.0`. These are binding version constraints for this development phase.
Encrypted envelopes remain unchanged. NPC snapshot additions must follow the
existing RP-save compatibility policy: inspect session validators and versions
before choosing the additive representation, and document any required RP-save
migration separately. Do not silently serialize incompatible session changes.

## 4. Canonical character data

Extract a shared character schema from the current Storybook model. Storybook
characters and containers must use the same normalized shape. Retain existing
fields for description, personality, speech style, role, banking, voice, Comfy
configuration and phone settings. Do not discard those during migration.

Recommended V2 additions and structure:

| Field | Responsibility |
| --- | --- |
| `character.id` | Stable character identity, independent of filename, app, Storybook node and display name. Generate new IDs for genuinely new characters only. |
| `character.playable` | Storybook selection eligibility. Global library entries are always effectively non-playable; explicit Storybook import sets this to true in the imported instance. |
| `character.age`, `character.gender` | Explicit character metadata where supplied; migrate existing MatchMe values when available. Do not invent missing ages for old cards. |
| `character.images` | Shared gallery: stable image ID, name, MIME type, dimensions, description, embedded `dataUrl`, and existing ownership/access metadata. |
| `character.profileImage` | General portrait reference and crop. Remove duplicated portrait pixel data in canonical V2 when it already exists in the gallery. |
| `character.apps` | Optional per-app accounts with stable `accountId`, `enabled`, username, display name, bio and image references. Absence of an account means no account. |
| `character.apps.matchme` | Public profile fields, adult profile age, gender, seeking, interests, ordered gallery image references. No matches or live messages. |
| `character.apps.fotogram` | Username, public display name/bio and avatar image reference/crop. Optional prepared initial posts. |
| `character.apps.onlyfriends` | Preserve existing account/configuration where present; separate account capability and visibility rules. |
| `character.apps.whatsup` | Explicit phone account availability/settings compatible with existing phone behavior. |
| `character.apps.*.initialPosts` | Optional authored starting publications with stable seed IDs, text and gallery references; not conversation state. |

Use typed per-app fields, not a loose bag where every app receives feed, payment
or attachment functionality. Distinguish app installation/settings from having
an enabled account. Explicit account configuration governs NPC discovery.

Suggested envelope outline (illustrative shape, not a complete valid fixture):

```json
{
  "format": "rpgraph-character",
  "version": "2.0.0",
  "character": {
    "id": "character-unique-id",
    "playable": false,
    "name": "Example Character",
    "description": "Character description",
    "personality": "Private personality",
    "speechStyle": "Speech style",
    "role": "Character role",
    "images": [],
    "apps": {
      "matchme": {
        "accountId": "account-unique-id",
        "enabled": true,
        "username": "example.nickname",
        "displayName": "Example",
        "age": 26,
        "bio": "Public dating profile",
        "interests": ["Music"],
        "photoIds": []
      }
    }
  }
}
```

Actual galleries contain supported inline base64 image data. An incomplete
MatchMe profile, such as the illustrative empty photo list above, must not appear
as a ready-to-use swipe profile. Reuse or deliberately evolve the existing
profile validity requirements. Carry all supported image/voice formats through
normalization; inspect the current JPEG restriction rather than assuming all
input files can be labeled JPEG without conversion.

Private description/personality and public app bios are distinct. The LLM may
receive the replying NPC's private characterization, but the other participant's
public profile must not be treated as permission to reveal private background.

## 5. Library discovery and storage ownership

Recommended source layout:

```text
resources/npc-characters/            # built-in plain JSON containers in source
  any-readable-name.json

<electron userData>/npc-characters/  # user-installed global NPC containers
  any-other-name.json

<electron userData>/characters/      # existing character export/import storage
  existing-export.rpgraph-character.json
```

Keep the dedicated global NPC directory distinct from the existing export
folder: exporting a plain player character should not silently publish it into
all games. Placing that export in `npc-characters` activates global discovery.
Expose the actual platform-specific directory through an Open NPC Folder action;
do not hard-code a Windows AppData path on Linux.

Scan regular `.json` files directly inside each configured root. No special
suffix, name convention or matching folder name is required. Detect content
before classifying it. Do not recurse into unrelated directories, follow external
symlinks or load remote image URLs. Ignore encrypted envelopes, workflows,
Storybooks, RP saves and other JSON formats. Record concise library diagnostics
for malformed/unsupported containers without preventing other entries loading.
Do not show unlock dialogs for ignored encrypted files.

Load at startup and on explicit reload; filesystem watching is not required for
V2. Use atomic writes for the creation/install workflow and skip incomplete
files. Cache metadata and decoded media so refresh/render does not repeatedly
parse every base64 payload. The renderer uses an IPC-backed service, not direct
arbitrary filesystem access. Document behavior when the desktop bridge is absent:
the browser fallback can use bundled resources but cannot scan AppData.

Package built-in containers explicitly in `electron-builder.yml`. Resolve the
source path in development and the packaged resource location in the desktop
build. Application updates may replace built-ins but never user-installed files.

## 6. One registry, identity and collision rules

Build one effective character registry from built-ins, user library entries and
the current Storybook. Apps query this registry, not separate demo arrays.

Precedence for the **same stable character ID**:

1. Storybook instance for the active story.
2. User-installed global container.
3. Built-in global container.

A Storybook override replaces the whole effective character, including explicit
absence/disablement of an app. Do not accidentally merge an old global account
back into a Storybook character who no longer has it.

Two different IDs with the same display name remain separate people. Two files
with the same ID in the same source root are an ambiguity: report/quarantine that
ID instead of arbitrarily choosing the last filesystem result. Cross-source
precedence above is intentional and should be visible in library details.

Account IDs are stable identities; usernames are presentation/address aliases.
Validate username uniqueness per app without silently merging characters. Keep
case-sensitive IDs intact even where username matching is case-insensitive.
Reject ambiguous name-based lookups and bind stored actions to account IDs.

Existing node-scoped Storybook IDs and `storybook:` MatchMe IDs must be mapped
through a migration alias table. Preserve already-issued account IDs whenever
possible. Never regenerate IDs from a renamed character, a moved file, or the
new Storybook node. Update phone contacts, social connections, ownership,
notifications, image access, matches and checkpoint references consistently.
Legacy name-based contact records need unique-resolution migration; unresolved
references are preserved/reported rather than assigned to an arbitrary person.

## 7. Media references and portable exports

A container has one gallery. MatchMe profile photos, Fotogram avatars/posts,
wallpapers and message attachments reference that gallery's image IDs. App
exports do not embed a second copy of the same photo.

Runtime media lookup must work for Storybook and library NPCs through the same
resolver. Use globally unique image IDs or an explicit owner-ID/image-ID pair;
never resolve by bare filenames or character names. Promotion to Storybook must
preserve or atomically remap all references. Keep historical media content stable:
replacing pixels creates a new image revision/ID instead of changing sent photos.

Sending an image grants recipient access through references/ownership metadata;
it does not create a second independent physical image asset. Existing gallery
access checks must remain in force.

Standalone JSON exports remain self-contained: gather referenced gallery media
and embed their bytes in the card. Reuse the existing session media pool for save
serialization and extend it as needed for NPC snapshots. Do not claim complete
deduplication until workflow, runtime, checkpoint and attachment paths have been
measured and tested. Two independent exported JSON containers may each carry
self-contained bytes; the requirement is to avoid duplicated app/gallery copies
within a container or live save, not to make portable files mutually dependent.

## 8. Global availability versus per-story state

All global NPCs are discoverable in any Storybook according to enabled app
profiles. This does not create a match, phone contact, acquaintance or published
post merely because a character has an album.

Keep matches, messages, conversations, delivered image references, published
posts, comments, likes, read markers and other story-specific activity in the RP
save. Profiles and galleries belong to the character payload embedded in the
Storybook; an RP save retains that payload as part of its workflow/runtime. Do not write these changes back
to a global source file automatically.

When a global NPC first participates in persistent activity, retain a deduplicated
snapshot of the used container revision and necessary media in the save. New
unreferenced library additions can appear on reload; established interactions
must not change identity, lose images or acquire a new personality because a
source file was edited/deleted. A saved story snapshot takes precedence over a
new global revision for that story until an explicit update/import operation.
Storybook-authored instances remain the strongest override.

Fresh stories see the latest global containers. Different stories do not share
matches or conversation histories. Restoring a checkpoint restores the relevant
story state; free history text cannot create accounts or matches.

Current initial posts are immutable character-owned projections, not inserted
into the timeline. Extend their source to effective registry entries and pinned
snapshots without duplicating live posts. If later revision/deletion support
requires seed application records, key them by stable account and seed ID and
retain tombstones so reload cannot recreate removed posts. NPC profile
availability and feed visibility/contact rules remain separate concerns.

## 9. Storybook import, export and NPC promotion

All entry points use one normalize/validate/import service:

- V1 or V2 plain JSON imported into Storybook.
- Encrypted card explicitly unlocked and then imported into Storybook.
- Global NPC selected through Add to Storybook.
- A future slash command invoking the same service.

Import sets `playable: true` in the destination Storybook. The global source file
is unchanged. Existing Storybook characters missing the flag migrate as playable;
global library context ignores an exported true flag and presents the character
as an NPC until explicit Storybook import.

Promotion preserves identity, accounts, photos, conversations and matches. The
Storybook override suppresses the equivalent global entry in every app in that
story. Import by name alone must not replace a different V2 identity. An explicit
update-by-ID and an explicit create-as-new operation can be provided; the latter
must allocate new character/account/image IDs consistently.

Round-trip scenario that must work:

1. Create a Storybook character, gallery and MatchMe/Fotogram profiles.
2. Export a plain V2 container.
3. Remove the character from the Storybook.
4. Place the export in the dedicated NPC directory and reload the library.
5. The same character appears in its configured apps, with all referenced images.
6. Add that NPC to the Storybook again: one playable character, one set of app
   accounts, and the existing conversation identity.

Container export includes configuration and public profile photo selections,
not live matches/messages. Exporting current publications as prepared initial
posts must be an explicit option; do not silently export the whole RP history.
Audit character deletion: it must not erase account history or media still used
by a global counterpart, a saved snapshot or historical messages.

## 10. Shared creation function and future image-backed NPCs

Provide one deterministic service accepting character fields, app profiles and
image inputs, producing a validated V2 container. It assigns IDs, embeds image
data, adds gallery records, checks every reference and can atomically install the
plain JSON into the user library. Reuse it for the UI export/install actions and
a developer CLI such as `npm run character:create -- --input specification.json
--output target.json` (implemented in Stage 6; see [creator usage](character-creator.md)).

A future request such as “create a character from these two images” should result
in an authored specification plus invocation of this service, not another
hard-coded app dataset. The service itself needs no LLM connection.

Supplied source groups are converted once and may be removed after the completed
containers pass validation. Use the blob-free packed-container edit specification
for later revisions; extract only the embedded JPEG that needs pixel-level work.
Write fictional names, adult ages, biographies, personalities and speech styles
suited to the intended characters; do not present inferred occupations or
personalities as facts about the photographed people. Keep source files intact.
MatchMe currently limits profile photos to three; a character album can contain
more. Select an ordered subset for MatchMe unless a separate UI requirement
changes that limit. Preserve all images in the container gallery.

Retire Alex/Jamie/Robin/Sam from fresh discovery after replacement containers are
ready. Do not give new faces their old IDs: old saves must retain or migrate their
existing fictional identities through compatibility snapshots. Likewise migrate
old social-directory users to explicit legacy identities without inventing
private backstories or silently connecting similarly named people.

## 11. Proposed implementation ownership

New paths below are proposed; existing paths are integration targets.

| Component | Responsibility |
| --- | --- |
| `shared/character-container.cjs` plus types | Pure shared payload validation/normalization/migration and reference rules, usable from Electron and scripts. Wire TypeScript through a typed wrapper/declaration; avoid separate contradictory validators. |
| `src/characters/` | Typed canonical models, registry/precedence resolution, stable identity aliases, app projections, snapshot and promotion planning. Keep pure operations testable. |
| `electron/npcLibrary.cjs` | Scan configured roots, ignore encrypted inputs, cache results, expose diagnostics and atomic install/reload operations. |
| `electron/main.cjs`, `electron/preload.cjs`, `src/electron.d.ts` | Narrow NPC library IPC, resource resolution and existing card import/export compatibility. |
| `src/storybook/characterCard.ts`, `src/storybook/useStorybookActions.ts` | V1 migration, V2 export, playable import and registry-aware promotion. |
| `src/nodes/rp-storybook/model.ts`, Storybook editor UI | Shared character fields and app editors. Route both Storybook node types through common source predicates. |
| `src/storybook/runtime.ts`, image library/access helpers | Registry-backed resolution with separate playable selection and NPC availability. |
| `src/chat/datingAccounts.ts`, social directory/catalogs | Replace independent definitions with registry projections; maintain legacy aliases. |
| `src/chat/socialMessageValidation.ts`, `src/app/useGraphRun.ts`, graph context | Resolve NPC character context and account permission through the shared registry. Preserve strict bound MatchMe replies and final save validation. |
| Phone/MatchMe/social UI and `src/App.tsx` | Display real NPC photos/profiles, library refresh/promotion controls and ID-based navigation. Remove cosmetic dummy posts after real seeded posts exist. |
| `src/data-management/`, version manifests | Persist NPC snapshots, IDs and pooled media; migrate old sessions, opening history and checkpoints. |
| `scripts/create-character-container.mjs`, `package.json` | Creation CLI using the shared service; no independent schema. |
| `resources/npc-characters/`, `electron-builder.yml` | Built-in V2 plain JSON containers and packaging. |

## 12. Ordered next implementation stages

These stages replace the earlier A–E ordering. Schema migration and local
profile/export integration are already implemented. Do not start by deleting
dummy data or converting every demo: first make one complete test container work
through registry, apps, conversation context, promotion and saves.

### Stage 1 — registry, ownership and identity contract

**Status: ✅ IMPLEMENTED.**

Build a pure, testable effective registry in `src/characters/` with provenance
and diagnostics. Keep stable character identity separate from node-scoped legacy
runtime aliases. Resolve all apps from the same effective character instance.

For fresh discovery, precedence is Storybook > user library > bundled library.
For an established game with pinned participants, use Storybook > saved NPC
snapshot > current user library > bundled library. Duplicate stable IDs within
one source tier are conflicts; same-name different-ID characters remain distinct.
A Storybook override replaces the whole character, including disabled/absent
optional accounts. Library entries are not player-selectable merely because an
export contains `playable: true`.

Decide account, image and seed collision handling here, before wiring feeds.
Character IDs, account IDs and seed IDs from the source must survive promotion.
Do not replace current IDs with names or regenerate them on file/node renames.

Gate: unit tests cover precedence, whole-character overrides, duplicates,
account lookup ambiguity and one effective account after Storybook import.

Implemented in `src/characters/registry.ts`. Same-tier duplicate character IDs
are quarantined at that tier, allowing a valid lower-tier definition to remain.
Effective account-ID and per-app username collisions are diagnosed and ambiguous
lookups remain unresolved. Images use `(characterId, imageId)` ownership and
starting posts use `(accountId, seedId)` ownership, so equal local IDs belonging
to different characters cannot hide one another. Explicit legacy aliases remain
separate from canonical IDs; a whole-character override does not restore a
removed or replaced account from a lower tier.

### Stage 2 — directory loading, validation and desktop controls

**Status: ✅ IMPLEMENTED.**

Implement the two proposed roots in section 5, narrow Electron IPC, startup load
and explicit reload. Add Open NPC Folder and concise library diagnostics.
Validate actual V2 payloads and image references, not just metadata. Ignore
unrelated JSON and encrypted containers without asking for a password. Keep
manual encrypted import and the existing character export directory unchanged.

Provide explicit development/packaged resource resolution and packaging rules;
automatic filesystem watching and recursive discovery are outside the initial
scope.

Gate: arbitrary `.json` filenames work, bad files do not prevent other loads,
reload is idempotent, encrypted files are skipped, and packaged path resolution
has non-UI tests. Prepare only a minimal fictional fixture for integration.

Implemented in `electron/npcLibrary.cjs` with a startup cache and narrow
`get`/`reload`/`open-folder` IPC. Development reads
`resources/npc-characters/`; packaged builds read
`<resources>/npc-characters`; user containers live in
`<userData>/npc-characters`. Only direct regular `.json` files are considered.
Malformed/unsupported character containers produce per-file diagnostics, while
encrypted containers, unrelated JSON and symlinks are ignored. The renderer's
NPC Library dialog shows roots, effective counts, source and registry diagnostics,
and exposes Reload Library and Open NPC Folder. Browser mode can load bundled
resources but explicitly reports that the user directory is unavailable. Bundled
browser-fallback containers are separate lazy modules rather than eager contents
of the renderer entry chunk. Electron uses IPC discovery and never loads that
fallback copy; its current IPC snapshot still contains complete character media.

### Stage 3 — NPC snapshots and media stability before live interactions

**Status: ✅ IMPLEMENTED.**

Define a saved participant snapshot containing the used character revision and
necessary gallery data, keyed by stable identity. Use existing session media
pooling; do not create a parallel conversation/post/like database. Capture a
participant when persistent activity first depends on it, including a saved
connection/match or interaction with a seeded post.

Wire serialization, load, Opening History where it retains NPC-dependent
activity, checkpoints and reset. Explain what Save Storybook retains if its
Opening History refers to NPCs: the history must be self-contained without
turning every library entry into a playable Storybook character. Preserve the
existing ownership of live activity. Resolve historical references from pinned
snapshots if the source file disappears or changes.

Gate: save/reload and rollback preserve IDs, gallery references, profiles and
activity after external deletion/change. Independent stories do not share live
state. Do not expose persistent NPC conversations before this gate is satisfied.

Implemented in `src/characters/npcParticipants.ts`, `npcParticipantRuntime.ts`
and `useNpcParticipants.ts`, with session, turn-commit, social-action and
Opening History integration. The archive is keyed by stable character ID and
stores an immutable copy of the used payload, complete gallery, source and
aliases. Only structured account/character/post references pin revisions;
free text, display names and ambiguous seed IDs cannot pin another person.
`npcSeedPostKey(accountId, seedId)` supplies an ownership-scoped reversible key
for app projections without rewriting source seed IDs.

The archive is stored once as optional `runtime.current.npcParticipantsJson`,
using the existing session media pool. Missing or malformed referenced media
rejects loading before replacing the running RP. Older saves without the field
load with an empty archive. No format version or encryption-envelope change is
required. Timeline messages/matches and existing UI records remain the activity
authorities; the archive contains no parallel live-state database.

Checkpoint policy: pinned revisions survive undo/redo, including after their
last active reference is rolled back. This immutable revision archive is
shared by current state and checkpoints, so retry/redo cannot silently acquire
a new personality or lose a referenced image after a library reload. Undo still
removes activity through the existing timeline/checkpoint behavior; retaining a
revision does not recreate a match, message or like. Reset/new-workflow loading
replaces the archive, and a fresh story sees current library revisions.

Import Current Session as Opening History copies the pinned archive alongside
activity and checkpoints. Save Storybook preserves only that configured history
archive, without promoting its NPCs into `characters` or copying the entire
library. Both Storybook source types hydrate it. Clearing Opening History
removes its stored archive. Snapshot payloads are omitted from the Storybook
assistant prompt; recipient-specific app context is supplied by Stage 4.

Gate passed with non-UI regression coverage in
`src/characters/npcParticipants.test.ts`: changed/deleted sources, stable IDs,
owner-scoped seeds, pooled media, corruption rejection, independent stories,
older saves, both Opening History sources and persisted checkpoint undo/redo.
Full unit tests, build and lint passed. App discovery/conversation exposure and
manual interface validation remain outside this stage.


### Stage 4 — shared app discovery, photos, posts and conversation context

**Status: ✅ IMPLEMENTED.**

Connect social directory/search, Fotogram/OnlyFriends feeds, MatchMe discovery,
phone identity and image lookup to the effective registry. Preserve existing
follow/contact/match requirements; availability is not an automatic relationship.
Render real MatchMe gallery photos instead of discovery placeholders. Use the
existing `initialPosts` pipeline with ownership-safe IDs and no duplicate live
post storage.

Build a recipient-bound character context from the effective/pinned container:
private characterization of the replying character plus that character's actual
public profiles, usernames and relevant gallery/post descriptions. Include only
needed context; do not disclose another participant's private characterization,
DMs or unrelated history. Account metadata is data, never prompt instructions.
Missing optional accounts must be described as absent, not invented.

Preserve existing messenger commands, exact recipient resolution and bound
MatchMe replies. Implement username search across library accounts so the central
MatchMe-to-Fotogram scenario in section 0 works. Profile deep links remain later
work unless separately requested.

Gate: one fixture character works across MatchMe and Fotogram with real photos,
correctly shared username, searchable profile, usable startposts and validated
message delivery. Unknown or ambiguous recipients cannot be silently assigned.

Implemented through `src/characters/appRuntime.ts` and the existing registry,
phone/social consumers, graph prompt context and final timeline validation.
MatchMe cards use ordered gallery photos; Fotogram/OnlyFriends search and feeds
use the same effective accounts and immutable initial publications. Player
selection and banking remain Storybook-only. Library availability creates no
follow, match or phone contact; a saved structured WhatsUp participant can resolve
through its pinned account. Legacy demo catalogs remain unchanged in scope.

The recipient context provides only that recipient's characterization and actual
public app metadata, with missing accounts explicit and metadata treated as data.
MatchMe's bound reply checks apply inside prompt execution and again at commit.
Existing messenger keys and username-based cross-app handoff remain unchanged.
Custom workflow inputs remain under the existing in-world knowledge rules; this
change does not sanitize arbitrary user-authored prompt inputs.

Gate passed with `src/characters/appRuntime.test.ts`, including actual prompt
execution with a stub provider, MatchMe → Fotogram identity/search/delivery,
absent/disabled accounts, ambiguous identities, owner-scoped posts/images, export
source IDs and changed/deleted sources resolved from pinned snapshots. Full
non-UI tests, build and lint passed. Manual UI/provider validation is outstanding.

For manual validation, copy `src/characters/fixtures/stage4-npc.json` into the
user directory shown by **Open NPC Folder**, then **Reload Library**. This plain
V2 fixture contains fictional Nova Vale, MatchMe `nova.vale`, Fotogram
`nova.vale.art`, one starting post and a real embedded lakeside photo reused from
`src/assets/social/fotogram/lake-run.jpg`. It is not installed as a new demo by
default. With a player's MatchMe profile, like Nova, ask for the Fotogram handle,
then search/add `@nova.vale.art` in Fotogram and check the post/photo. Save/reload
and remove/change the source to verify the pinned revision interactively.
OnlyFriends, photo navigation, likes/comments, provider retry and unread badges
also remain manual checks. Creation tooling and deep links are not part of Stage 4.

### Stage 5 — Storybook promotion and duplicate suppression end to end

**Status: ✅ IMPLEMENTED.**

Expose Add to Storybook through the existing import planning/commit services.
Both Storybook node types must preserve the same character, accounts and media.
The Storybook instance takes precedence immediately in all apps; do not retain a
second discovered NPC or restart matches, posts or conversations. Test existing
legacy aliases and account-bound direct replies during promotion and reload.

Gate: complete the six-step user scenario in section 0, including source removal,
repeated import, save/reload and no duplication. The currently selected player
must not determine whether a library duplicate is suppressed.

Implemented through `src/characters/promotion.ts`, the existing character-card
planner/Storybook commit service and the NPC Library dialog. Select the target
Storybook and choose **Add to Storybook**. The effective pinned revision is used
when the external file has changed. Both Storybook source types use the same
preflight; repeat import replaces by stable ID. Import into a second Storybook
node with the same character is rejected, as are account/handle conflicts and
changes that would remove pinned identities, media or immutable starting posts.

Pinned NPC origins retain their ownership-scoped seed keys and stable directory
IDs after promotion. Historical directory IDs and reciprocal connection owners
resolve through explicit character aliases. Account aliases survive only when
the canonical account is unchanged. Activity, likes, purchases and checkpoints
stay in their existing stores; no history rewrite or second publication store is
introduced. Repeat public import preserves the existing character's private
legacy MatchMe decisions, messages and history marker.

Gate passed with `src/characters/promotion.test.ts`: both Storybook node types,
MatchMe-to-Fotogram handoff, real gallery media, repeated promotion, stable posts
and directory connections, legacy aliases, account-bound replies, full RP save
round trip and changed/deleted external sources. Existing local Storybook seed
keys remain unchanged. Format versions and library directories are unchanged.
Full non-UI tests, build and lint passed; manual interface validation is pending.

Manual check: use the Stage 4 fixture, establish the MatchMe conversation and
Fotogram connection, like its starting post, then choose **Add to Storybook**.
Keep the original player selected and verify one profile/post with retained
activity. Repeat the import, save/reload the RP, remove the external file and
reload the library. Repeat with the other Storybook source type. A Storybook save
still retains only explicitly configured Opening History, not the current RP.

### Stage 6 — shared container creator and explicit demo conversion

**Status: ✅ IMPLEMENTED.**

After the preceding gates, add the creation service/CLI proposed in section 10.
Accept authored character metadata, per-app profiles, local image inputs and
optional initial publications. Convert supported input pictures to the gallery's
actual supported format, embed each referenced image once, assign IDs only for
new identities and validate the completed container through the shared boundary.
Producing another revision must retain existing IDs. Do not infer a full factual
identity from an image; character biographies/personality are authored fiction.

Inventory `dummyPosts.ts`, social catalogs, bundled media imports and
`datingNpcProfiles`. Create an explicit author/account/post mapping. Never merge
unrelated demo people merely because they have similar names. Separate newly
authored characters from legacy identities whose saved history must survive.
Do not export synthetic engagement, DMs, matches or private game history as
public starting content. Document unsupported cosmetic fields instead of
silently claiming a lossless conversion of every dummy field.

Gate: generated and converted containers pass the same validator/import tests,
round-trip with stable references, and produce the expected profiles/posts.
The CLI and UI export must not implement different container formats.

Implemented through `src/characters/creator.ts`, shared by UI character export
and the creation CLI. Local JPEG/PNG/WebP inputs are decoded, limited to one
megapixel and 200 KiB, and embedded as JPEG through ImageMagick 7 without
launching the application. IDs and keyed media/post
references remain stable across explicit revisions. Completed containers use the
existing shared validator; explicit CLI installation publishes atomically into
the selected user library and respects existing arbitrary basenames.

Packed containers can also be inspected as blob-free
`rpgraph-character-edit` 1.0.0 specifications and revised atomically. Existing
JPEG bytes remain exact unless an image is explicitly replaced; references and
gallery membership can be edited independently, and individual images can be
extracted for external pixel-level work. The same validation boundary rejects
dangling media or identity changes before publication.

`src/characters/demoConversion.ts` and `character:convert-demos` convert 200
app-scoped social identities and four separate legacy MatchMe identities into
staging containers. All 25 captions and 13 real Fotogram images have explicit
ownership in [the conversion map](demo-conversion-map.json). No demo source is
removed or installed by default. No new portraits were supplied: the four legacy
MatchMe containers preserve account metadata but cannot have discoverable photo
profiles yet. Interests remain in the map; unsupported cosmetic fields, fake
engagement and viewer-scoped legacy post keys are documented rather than silently
claimed to migrate. New authored examples use independent IDs.

Gate passed with `src/characters/creator.test.ts`: shared UI/import round trips,
all converted identities, stable references, decoded media, privacy filtering,
invalid-input rejection, overwrite protection and explicit installation. Full
non-UI tests, build and lint passed. See [creation and conversion usage](character-creator.md)
and `docs/examples/character-specification.json`. Manual UI and packaged-app
validation remain with the user. Discovery replacement, compatibility aliases
for old demo activity and new photo-backed replacements belong to Stage 7.

### Stage 7 — replace fresh dummy discovery and finish regression coverage

**Status: ✅ IMPLEMENTED.**

Package the converted containers and remove corresponding hard-coded discovery
sources only after equivalent registry-backed content is verified. Retain any
explicit compatibility data needed for older saves; do not assign new faces to
old identities. New installations must not show both converted and old demos.

Run the full non-UI suite, build and lint. Report the real directories, reload,
creation/import workflow, save compatibility and remaining manual checks.
Leave interface and packaged-app interaction testing to the user. Broader NPC
library editing, filesystem watching, deep links and source-revision update UI
are subsequent work, not implicit prerequisites for the first usable library.

Implemented by bundling the 13 legacy Fotogram identities backed by actual image
files as validated Character Container V2 documents. Their readable filenames
follow the character name (for example `luna-sky.json`), while stable character,
account, image and post IDs retain compatibility. Each has an authored fictional
description, personality, speech style, role and Fotogram bio based on the
existing post theme. Its image is embedded once and referenced by the start post.

Fresh runtime discovery no longer seeds the 200-entry social catalogs, adds
cosmetic `dummySocialPosts`, or exposes the four image-less MatchMe cards. The
social prompt lists only accounts in the effective character registry.
Image-less catalog entries, text-only post authors and OnlyFriends templates
without media are not packaged. Legacy MatchMe profiles are restored only when
an existing save references their stable ID. Converted social IDs remain aliases
for historical saved connections.

The conversion CLI supports `--images-only` and produces readable filenames for
the curated bundled set. `src/characters/stage7.test.ts` covers the packaged
containers, registry profiles/posts, historical aliases and fresh placeholder
removal. Character Container, Storybook and save format versions are unchanged.

### Stage 8 — optional NPC embedding and meaningful-interaction dependencies

**Status: ⬜ PLANNED — not started. User decision recorded after Stage 4.**

Reduce save growth by separating lightweight activity references from NPCs needed
to continue actual conversations. This stage supersedes the earlier requirement
to capture a full character/gallery for every match, like or saved connection.
Implement this policy for RP saves and for NPC-dependent Opening History; do not
change portable character export or write game activity back to library files.

#### Interaction boundary

Only these activities create a required NPC dependency:

- A sent or received DM in MatchMe, Fotogram or OnlyFriends.
- A comment involving an NPC, including commenting on that NPC's post or an NPC
  commenting on a player's post. Track the actual participants and relevant post
  owner through structured identities, not names or free history text.
- A sent or received WhatsUp phone message.

Viewing/searching profiles, swipes, likes, matches, follows and adding a social
connection do not qualify. A purchase/unlock alone also does not qualify under
this exclusive boundary. Keep their existing activity records and stable IDs,
but do not create a required dependency or copy the character/gallery for them.
Audit direct UI capture calls and structured timeline capture together so a
reaction record containing only likes cannot indirectly trigger a snapshot.
Preserve existing ownership of messages, matches, comments, likes and purchases;
do not introduce a separate activity database.

#### Storage option and defaults

Provide an explicit per-RP option to embed required NPCs in saves. It is **off by
default for new RPs**: qualifying interactions store linked dependencies, not
complete NPC containers or gallery copies. Persist the selected policy, and carry
the relevant policy/dependencies into Opening History when the user explicitly
imports the current session. Saving a Storybook alone still does not import the
current RP history.

Links use stable character IDs, app account IDs and the post/media references
needed by retained activity. Resolve them through the effective registry, never
by filename, directory position or display name. A library rename must not break
the link, and Storybook promotion must satisfy the same identity dependency.
Linked mode uses the available effective container; it does not guarantee an
immutable revision if the external container changes. Explain this dependency
and the file-size tradeoff in the option's user-facing text.

With embedding enabled, qualifying interactions retain the existing immutable
NPC snapshot and gallery behavior, using the existing media pool. Matches/likes
alone still do not trigger embedding. A snapshot remains a non-playable RP
participant, not an automatic Storybook character import. Neither mode changes
the rule that the user must save the RP to persist new activity to disk.

Retain compatibility with existing saves and their already embedded NPCs. Do not
silently discard old snapshots or convert older self-contained saves into
externally dependent saves because the new default is off. Define policy changes
explicitly: enabling embedding must resolve and capture existing required linked
participants; disabling it must not silently remove previously saved protection.
Automatic stripping of existing snapshots is outside this stage.

#### Missing linked NPCs

Before applying an RP save or NPC-dependent Opening History, validate required
linked participants and the account/media references needed by their retained
activity. If a required NPC cannot resolve, **reject loading before replacing the
current RP**. Show a clear error identifying the missing NPC/stable ID and explain
that its container must be restored and the library reloaded before retrying.
Ambiguous identities or unavailable required references must likewise fail
explicitly rather than binding another person or silently dropping history.

Treat this as an unloadable save with a missing dependency; the error should not
claim that the save's JSON bytes are corrupt. Do not offer partial loading or
silently create replacement NPCs in this first implementation. Apply the same
checks after decrypting encrypted saves. External changes/reloads during an RP
must not silently erase dependencies or fabricate successful interactions; keep
activity intact and report unavailable required participants when used.

Missing NPCs referenced **only by lightweight activity** must not block loading:

- MatchMe: preferably retain the match entry with **Account deleted** and disable
  messaging. Hiding the unavailable entry is an acceptable initial fallback;
  keep the underlying match record either way.
- Fotogram/OnlyFriends: unavailable profiles and their external starting posts
  disappear from discovery/feed views. Stored like/follow references can remain
  without creating ghost accounts or required dependencies.

An embedded NPC remains available even if its external source disappears. A
linked NPC with qualifying activity instead follows the strict loading rule
above. Do not confuse these cases with the lightweight missing-account display.
Checkpoint/undo handling must retain dependencies needed by restorable activity
without recreating undone matches, messages or comments.

Gate: tests prove that new RPs default to linked mode; matches, likes, follows and
unlocks neither embed nor block loading after source removal; DMs, comments and
WhatsUp messages create the correct dependencies; embedding is opt-in and keeps
required NPCs/media available after source removal. Cover the chosen unavailable
match display model, same-name/different-ID accounts, source renames, promotion,
changed containers, missing required media, policy changes and existing embedded
saves. Required missing dependencies must fail RP/Opening History loading
atomically with actionable errors, including encrypted saves and checkpoint
restoration. Run non-UI tests, build and lint; leave interface validation to the
user. No runtime behavior is changed merely by adding this stage to the plan.

### Suggested next implementation request

Stage 7 is complete. Stage 8 remains a separate optional storage-policy task;
its documented future default does not change the current snapshot behavior.

## 13. Validation and completion checklist

Automated non-UI coverage must include:

- Plain V1/V2 detection, malformed cards, unknown/newer versions and encrypted
  skip behavior; explicit encrypted manual import still works.
- Both library locations, arbitrary basenames, duplicate IDs, per-app username
  conflicts, user overrides and reload idempotence.
- Storybook import automatically playable; library entries remain NPCs even
  when their exported flag is true; promotion preserves references and history.
- Profile/filename/Storybook-node renames do not change V2 identity.
- Gallery/photo/avatar/post/message references, crops, full export media and
  deduplication; missing media produces a diagnostic rather than wrong images.
- MatchMe-only, Fotogram-only, both-app and no-account discovery behavior.
- Legacy matches, messages, dynamic accounts, contacts and read markers survive
  migration without name-based merges or duplicate initial posts.
- Provider failure/retry and selected-character changes preserve bound account
  IDs and the existing shared workflow behavior.
- RP-save JSON round trips, encrypted saves, deleted library sources, Storybook
  removal/promotion, checkpoint restoration and independent story histories.
- Creation CLI output passes the same validator as UI export and library import.
- Stage 8: linked-by-default storage, opt-in embedding, the restricted interaction
  boundary, missing lightweight accounts and atomic rejection of missing required
  dependencies, including Opening History and compatibility with embedded saves.

Use `npm run --silent test -- <filters>` for targeted tests and
`npm run --silent test` for the complete non-UI suite, plus `npm run build` and
`npm run lint`. Follow the repository's AGENTS.md. Do not start the app, Electron,
a browser or UI/E2E tests unless the user explicitly asks; leave manual UI and
packaged-app checks clearly listed for the user.

Implementation completion should report migrated formats, configured library
paths, creation/import usage, preservation of existing saves, automated results
and remaining manual checks. Do not claim the future slash-command UI was built
unless it was explicitly included; its reusable promotion service belongs in V2.
