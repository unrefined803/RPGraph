# Character Container V2 — Implementation Plan

Status: Phase A foundations implemented; global NPC discovery and app integration remain planned.
Character Container V2 and Storybook V3 use independent version numbers.

## Implemented foundation and next steps

- Character Container payloads use `2.0.0`. Storybook payloads and the
  `rp-storybook` node data version use `3.0.0`.
  Outer workflow/session and encrypted envelope versions remain unchanged: their
  structures are unchanged and embedded documents carry their own versions.
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

Next: implement the built-in/user-data NPC registry, app discovery, account
editors for the new optional metadata, playable selection rules and promotion
without duplicate runtime identities. Then create image-backed demo containers.
The playable flag is available now; a complete global NPC runtime is a later
phase. Initial posts and account avatars are modeled but not published by the
existing app runtime yet. Interactive validation remains with the user.

The sections below describe the full target design, including later phases;
field names in examples are proposals where not implemented above.
Prepared: 2026-09-06.

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
- Bump the character payload version from `1.0.0` to `2.0.0`.
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
distinguishes the completed schema foundation from the planned scanner and registry.

## 2. Existing implementation and useful entry points

Paths below are relative to the repository root.

| Area | Existing files and behavior |
| --- | --- |
| Character schema | `src/nodes/rp-storybook/model.ts`: `RpStorybookCharacter` has `id`, `name`, `description`, `personality`, `speechStyle`, `role`, gallery images, profile image/crop, phone, social, banking, voice and Comfy configuration. |
| Current versions | `src/storybook/formatVersions.json`: Storybook `2.2.0`, character card `1.0.0`, encrypted character envelope `1.0`. These versions are independent. |
| Card serialization/import | `src/storybook/characterCard.ts`: `RpCharacterCard`, `rpCharacterCardForCharacter`, `planCharacterCardImport`. Cards wrap one character as `{ format: "rpgraph-character", version, character }`. Current import can replace by ID **or name**, and can rename image IDs to avoid collisions. Both behaviors need review for stable V2 identities. |
| Storybook actions | `src/storybook/useStorybookActions.ts`: `exportStorybookCharacter`, `importCharacterCard`, `beginCharacterCardImport`, `applyCharacterCardToNode`. Plain and encrypted paths already exist. Some paths explicitly require `rp-storybook`; support the manual `rp-storybook-editor` source too. |
| Electron recognition | `electron/characterCardFormat.cjs`: plain/encrypted metadata and version checks. Current metadata checks are not a substitute for full V2 payload/reference validation. |
| Storage and IPC | `electron/main.cjs`: `charactersDirectory()` is `app.getPath('userData')/characters`; `character:list` and `character:save` list/save exported cards. Default export names currently end in `.rpgraph-character.json`. |
| Renderer bridge | `electron/preload.cjs`, `src/electron.d.ts`: character listing and saving APIs. |
| Runtime characters | `src/storybook/runtime.ts`: `StorybookCharacter`, `storyCharactersFromNodes`, `isStorybookSourceNode`. Runtime IDs currently depend on node ID plus character ID through `storybookCharacterId` in the Storybook model. |
| Image library | `src/storybook/imageLibrary.ts`, `src/storybook/imageUsage.ts`, `src/storybook/useStorybookPhoneImages.ts`: gallery lookup, references, ownership and phone image operations. |
| Save/media infrastructure | `src/data-management/{types,entityStore,mediaPool,timelineStore,sessionStore,validation,checkpointStore}.ts`: timeline, runtime, checkpoints and pooled inline media. Media pooling exists at serialization boundaries, but this does not yet constitute one global character/image registry. |
| MatchMe | `src/chat/{datingAccounts,datingProfile,datingMessages,matchMe,matchMePrompt,socialMedia,socialMessageValidation}.ts`; `src/components/phone-dating/`. Stable demo IDs and Storybook-derived accounts exist, but NPC character data is still separate. |
| Social directory | `src/chat/{socialDirectory,socialCatalogs}.ts` and `src/chat/catalogs/`: bundled names/handles and dynamic identities are not full character containers. |
| Fotogram/OnlyFriends feeds | `src/components/phone-social/PhoneSocialFeedScreen.tsx`: saved posts reference gallery image IDs; cosmetic `dummySocialPosts` are still mixed into the feed. |
| Runtime wiring | `src/App.tsx`, `src/app/{useGraphRun,useRoleplayPanelRuntime}.ts`, `src/chat/useTurnRecordState.ts`, `src/graph/executeGraph.ts`, `src/nodes/shared/promptRun.ts`. |
| Packaging | `electron-builder.yml`: built-in NPC resources are not currently listed. Add explicit development and packaged resource resolution. |

The preceding MatchMe work is already present in the workspace and may be
uncommitted. Preserve it. The `bilder/` directory contains user-provided material;
do not delete, rename or overwrite originals during the infrastructure phase.

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

Storybook and RP-save schemas need their own compatible version changes for new
fields. Determine those from their existing version rules during implementation;
keep Storybook at V3.0 or silently save new incompatible session fields
under an unchanged schema version. Update shared version manifests, validators,
fixtures and documentation together.

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

Keep the following in the RP save: matches, messages, conversations, delivered
image references, published posts, comments, likes, read markers, profile changes
made during play and other story-specific state. Do not write these changes back
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

Prepared initial posts should become structured starting-state records once per
character/seed ID in that story. Track seed application, including deliberate
removal, so reload does not recreate posts the user removed. NPC profile
availability and feed visibility/contact rules are separate concerns.

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
--output target.json` (proposed command, not currently available).

A future request such as “create a character from these two images” should result
in an authored specification plus invocation of this service, not another
hard-coded app dataset. The service itself needs no LLM connection.

After the core migration is validated, inspect `bilder/` and group images by the
user's character grouping: reportedly three male groups and four female groups,
with varying image counts. Verify the actual filenames before assigning groups.
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

## 12. Implementation phases and acceptance gates

### Phase A — schema and compatibility

Foundation implemented; see the status above for limitations. Define V2 fields, canonical IDs, app shapes and migration rules. Implement one
validator and V1 adapters; preserve non-app character settings. Add fixtures for
plain/encrypted V1/V2 and unsupported newer payloads. Version Storybook/session
changes deliberately. Gate: V1 round trips preserve data and V2 validates every
image/account reference.

### Phase B — discovery and registry

Implement both roots, IPC, reload, precedence, diagnostics and playable/NPC
selection. Gate: arbitrary JSON filenames work; encrypted files are ignored
without prompts; same-name people stay distinct; same-source duplicate IDs are
reported; user overrides built-in and Storybook overrides both.

### Phase C — Storybook and media integration

Unify editors, import/export, image resolution and promotion. Gate: the six-step
round trip in section 9 works with all photos, stable accounts and one effective
character. Both Storybook node types are supported.

### Phase D — applications and runtime

Replace MatchMe and social catalog projections; create real initial posts;
resolve direct and normal RP context from full NPC cards. Gate: profiles appear
only in configured apps, messages require real accounts and active MatchMe
matches, account switching cannot redirect replies, and image IDs resolve across
apps without copies. Global NPCs are not automatically player-selectable.

### Phase E — saves, rollback and demo replacement

Persist pinned NPC data/media and compatibility aliases; verify checkpoints,
reset and export/import. Create image-backed demo containers only after this
foundation is ready. Gate: removing/editing source files cannot break existing
saved conversations; fresh stories see new library data; retired demos do not
reappear in fresh discovery or get reassigned to new faces.

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

Use `npm run --silent test -- <filters>` for targeted tests and
`npm run --silent test` for the complete non-UI suite, plus `npm run build` and
`npm run lint`. Follow the repository's AGENTS.md. Do not start the app, Electron,
a browser or UI/E2E tests unless the user explicitly asks; leave manual UI and
packaged-app checks clearly listed for the user.

Implementation completion should report migrated formats, configured library
paths, creation/import usage, preservation of existing saves, automated results
and remaining manual checks. Do not claim the future slash-command UI was built
unless it was explicitly included; its reusable promotion service belongs in V2.
