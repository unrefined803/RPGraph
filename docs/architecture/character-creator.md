# Character creator and demo conversion

App naming uses one canonical profileName per social app; WhatsUp uses the real character name and may carry an optional second name (`apps.whatsup.alias`). See [App profile names](app-profile-names.md) for the current schema and legacy import rules.

The application uses `src/characters/creator.ts` for authored payloads and UI character
exports. Both produce plain `rpgraph-character` 2.0.0 documents validated by
`shared/character-container.cjs`. Storybook and node versions remain 3.0.0.

## Received images in character exports

The standalone character save dialog and Storybook export dialog offer **Include
Received Images**, disabled whenever the save dialog opens. By default, exports
omit gallery entries marked `receivedFrom` or `imageAccess`, including external
images added for the character's own posts. Enabling the option embeds those
images in the portable container and removes the RP-only access metadata.

When images are excluded, posts retain their text without the image reference;
portraits and app avatars referencing those images are cleared. MatchMe retains
its remaining photos and becomes disabled if none remain. Export preparation
never changes the active character or RP gallery. RP saves continue to preserve
shared media through their media pool; promotion to playable retains RP access
metadata and does not apply this portable-export filter.

## Create and revise

From the repository root, with development dependencies installed:

```sh
npm run character:create -- --input docs/examples/character-specification.json --output /tmp/rowan.json
```

Local JPEG, PNG and WebP conversion requires ImageMagick 7 (`magick` on PATH).
The CLI decodes and auto-orients images, limits them to one megapixel, flattens
transparency onto white, removes metadata and encodes JPEG at fixed quality
84. The approximate 200 KiB target is advisory, not a hard byte limit. Animated/multi-frame files are rejected.
Embedded galleries in existing V2 containers need no converter. Image dimensions
and byte sizes describe the output JPEG, not the source. Original files are read
only. No Electron, browser, LLM or UI is launched.

The example is authored fiction using existing landscape media.

Input is a character specification or an existing plain V2 container. Required:
`name`; all other character fields use the canonical model. Local `images`
replace embedded records with `{id, path, name, description}`. Paths resolve
relative to the specification. Use existing gallery IDs in portrait, avatar,
MatchMe `photoIds` (one to three) and publication `imageId` references.
The same gallery entry serves all references; do not duplicate image bytes for
each app. Conflicting duplicate IDs fail. Repeated local paths must use one ID.

An omitted character ID allocates a new UUID. For repeatable authoring, supply
an explicit ID or revise the generated container. Never rerun an ID-less
specification to create a revision. Missing account IDs derive from character
ID and app. Local images and initial posts may use an immutable `key` instead
of an ID; generated IDs derive from the character/app and key, never names,
filenames or list position. Keep keys unchanged on revision. Imported IDs are
preserved. An overwrite that changes an existing character/account ID fails.
Changing content or captions under existing IDs creates a revision; it does not
update an RP's already pinned NPC revision.

Apps use canonical profiles. WhatsUp and Fotogram are provisioned by the existing
normalizer when absent; OnlyFriends and MatchMe remain optional. An explicitly
stored disabled standard account remains disabled. Malformed profiles and dangling
references fail before normalization. Starting publications contain only ID,
text and optional image ID. Portable serialization removes private MatchMe
history and private gallery access metadata. UI export still includes starting
and own publications only when the user selects export with posts.

Character names must be unique inside a Storybook, compared case-insensitively
after trimming and collapsing whitespace. Import and assistant commits reject a
second different character with the same name. A same-name Library character is
hidden with a system warning while the Storybook character is active.

Existing files are protected unless `--overwrite` is present. Writes use a
same-directory temporary file and atomic publication; a failed individual write
leaves the previous target intact. A command targeting both output and install
locations publishes each independently, not as a multi-file transaction.
The input document cannot also be the output path.

```sh
npm run character:create -- --input /tmp/rowan.json --output /tmp/rowan-revised.json
npm run character:create -- --input /tmp/rowan-revised.json --install-dir /path/from/Open-NPC-Folder
```

Use the actual user directory displayed by **Open NPC Folder**, then choose
**Reload Library**. Installation uses a SHA-256 filename derived from the stable
character ID for new installations; revisions reuse an existing matching basename.
Duplicate matching library files must be resolved first. Identity lookup still uses the ID inside the container. The user
library remains `<Electron userData>/npc-characters`; bundled development files
remain `resources/npc-characters`, packaged files `<resourcesPath>/npc-characters`.
The Character Assistant provides UI creation and export through the common
service; CLI installation uses the explicit destination above. Storybook import and Add to Storybook use the
existing promotion/import flow.

## Inspect and edit a packed container

Inspection produces a complete, small edit specification without embedded
base64 payloads. Existing images retain their IDs and show only editable labels
plus read-only embedded metadata:

```sh
npm run character:inspect -- --input resources/npc-characters/luca-reed.json --output /tmp/luca-edit.json
```

Edit the resulting character fields, accounts, profiles, references and posts as
normal JSON. Existing image entries with `embedded` metadata reuse the exact JPEG
bytes from the source container. A new image uses
`{id, path, name, description}`; adding `path` to an existing image ID replaces
that image. Local paths resolve relative to the edit specification. Added and
replaced images pass through the same JPEG, one-megapixel, fixed-quality JPEG conversion
as newly created characters.

Apply the revision to a separate file, or explicitly overwrite in place:

```sh
npm run character:edit -- --input resources/npc-characters/luca-reed.json --spec /tmp/luca-edit.json --output /tmp/luca-revised.json
npm run character:edit -- --input resources/npc-characters/luca-reed.json --spec /tmp/luca-edit.json --overwrite
```

Removing a reference does not remove the gallery image. Remove an image entry
only after clearing or changing its portrait, avatar, MatchMe photo and initial
post references. Final validation rejects dangling references, duplicate IDs and
an active MatchMe profile without one to three photos before replacing a target.
Character IDs and retained account IDs cannot change in a revision.

Extract one embedded JPEG for pixel-level work without unpacking the complete
container:

```sh
npm run character:inspect -- --input resources/npc-characters/luca-reed.json --extract-image authored-matchme-m1:image:day-drive --image-output /tmp/luca-day-drive.jpg
```

Inspection specifications and extracted images are protected from replacement
unless `--overwrite` is explicit. All writes are atomic. The edit specification
format is `rpgraph-character-edit` 1.0.0 and is an authoring aid, not a runtime
container or application format.

## Legacy conversion tool

```sh
npm run character:convert-demos -- --output /tmp/rpgraph-demo-staging
npm run character:convert-demos -- --output /tmp/rpgraph-image-demos --images-only
```

The unfiltered converter writes a compatibility inventory of the old app catalogs
and `conversion-map.json`. The [conversion map](demo-conversion-map.json) records
character, account, post and image identities. Output is staging data, not an
installation or a save migration. Synthetic engagement and private histories are
excluded. Catalog people retain independent identities; matching names do not
merge accounts across apps.

`--images-only` limits output to the legacy Fotogram authors with real source
images. Image-less profiles are not made discoverable by conversion. Existing
saves retain their historical identities; never assign those IDs to a new person.
Use the shared inspect/edit procedure to revise bundled containers and preserve
stable character, account, image and post IDs.

## Portraits and automatic face crops

### Authoring new character images

Generate new character photos in vertical **3:4 (width:height)** format, including
photos initially used only as portraits. Keep the full portrait-oriented image
in the gallery so it can also be posted in the game's social apps later. Frame
the face clearly with enough space around the head for a circular avatar crop;
store that crop in `profileImage.crop` without cropping the gallery source.
Check the generated image dimensions before creating the container. This is an
authoring convention; existing images and supported import formats remain valid.

An image in the gallery or an avatar reference does not require a starting post.
For a character who only browses, leave `initialPosts` empty and describe that
habit in their characterization. Provision OnlyFriends when appropriate to the
person; do not create a MatchMe profile unless they actually use dating discovery.

A character portrait is optional. No `profileImage` means the existing initials
fallback. `{ "imageId": "photo" }` explicitly selects an uncropped picture, which
may show scenery, an object, or a person. An optional `crop: { x, y, size }` selects
a square region: `x` is its left edge as a percentage of image width, `y` its top
edge as a percentage of image height, and `size` its side length as a percentage
of image width. The circular avatar masks this square. The radius in pixels is
`image.width * size / 200`; do not store a second radius or duplicate JPEG.

The profile picker supports **Apply**, **Use Full Image**, and **Clear Profile
Pic** in the gallery. Crops survive Character Container V2 exports, Storybook V3
saves/imports and NPC snapshot projections. The runtime derives an SVG viewport
around the embedded JPEG for avatar consumers; this generated preview is never
stored in the portable container. Fotogram and OnlyFriends distinguish the portrait fallback (no `avatarImageId`)
from an explicit album selection. The fallback uses the character crop; an album
selection uses the full image, even when it is the same source photo. Explicit
social album references remain unchanged when the character portrait changes or
is cleared. Other app avatars using the portrait source inherit its crop and
continue following portrait changes. Gallery images, feed photos and MatchMe discovery photos remain
full images. MatchMe match and conversation avatars use the explicit MatchMe avatar or first dating photo; they inherit the portrait crop only when that same image is selected.

Install the authoring-only detector once (Python with `venv` and pip required):

```sh
npm run character:faces:setup
npm run character:create -- --input /tmp/character-spec.json --output /tmp/character.json
```

Setup creates the ignored `.face-tools/` environment, installs the pinned
MediaPipe dependency and downloads the version-1 BlazeFace short-range model with
SHA-256 verification. Source scripts and requirements belong in the repository;
the Python environment and downloaded model do not. The desktop application does
not need Python or MediaPipe to display or manually edit portraits. After setup,
creation and batch detection run locally without uploading images or downloading
models. `RPGRAPH_SETUP_PYTHON` selects the setup interpreter;
`RPGRAPH_FACE_PYTHON` and `RPGRAPH_FACE_MODEL` override detector paths.

For a new specification, automatic detection runs after gallery conversion and
before container output. The primary image is chosen in this order:
`profileImage.imageId`, first MatchMe `photoIds` entry, Fotogram `avatarImageId`,
first gallery image. Specify `profileImage.imageId` to control the primary photo
when supplying two or more images. Existing manual crops are preserved. One
confident face produces a crop with 55% extra space around the detected box.
No confident face leaves the existing image-only reference or initials intact.
Multiple confident faces stop creation with a request for an explicit crop.
The confidence threshold is deliberately conservative (0.85); a missed face
can still be selected manually. No face detection establishes a person's identity.

Use `--skip-face-detection` on `character:create` to deliberately keep initials or
an uncropped image, or when authoring non-face media without installing Python.
Reinstalling an existing V2 container preserves its portrait choices. Normal
`character:edit` also preserves full-image selections and cleared portraits;
`--detect-faces` explicitly enables detection for a newly selected uncropped
portrait during editing. The demo conversion command preserves original demo
media choices and does not require the detector. The creator still consumes an
authored specification: biography, personality, app choices and captions are
written by the author/assistant, not generated by the face detector.

Review or backfill an existing library:

```sh
npm run character:faces -- --directory resources/npc-characters
npm run character:faces -- --directory resources/npc-characters --write
```

The default is a read-only preview. Existing portraits, including uncropped ones,
are retained. `--include-uncropped` explicitly opts image-only portrait references
into detection, useful for older containers that only stored an image ID. Existing
crops are never overwritten. Multiple confident faces prevent all batch writes;
zero confident faces are an ordinary unchanged result. Each changed file is
published atomically; publication of the whole directory is not transactional.

Existing RP snapshots remain pinned to their saved revision; reloading the NPC
library updates library discovery, not previously captured snapshots. Those
portraits can be edited in the active Storybook or used in a fresh story.

Detector reference: [MediaPipe Face Detector for Python](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector/python).
Model reference: [BlazeFace models](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector#models).

## Hidden agency and filename assignments

The optional `character.hiddenAgency` string holds author-only goals and motives.
It is preserved through creation, inspection, editing, import and export. Existing
containers without it remain valid V2 documents. An empty string has no authored
agency. Social reaction context includes it as private characterization; it does not
trigger autonomous actions. See [Character Assistant](npc-in-game-assistant.md)
for in-app authoring.

Use a new workspace to unpack a library into editable specifications and images:

```sh
npm run character:unpack -- --input resources/npc-characters --output /tmp/npc-workspace
npm run character:pack -- --workspace /tmp/npc-workspace --check
npm run character:pack -- --workspace /tmp/npc-workspace --output /tmp/npc-revised
```

Unpacking preserves the original library and backs up containers in `.originals/`.
Each character folder has `character.json` and `images/`. The manifest is local
authoring metadata, not a runtime format. Keep the manifest and backups intact.
Packing validates the whole batch before writing; choose a fresh output folder.

Prefix image filenames with uppercase F (Fotogram post), O (OnlyFriends post),
M (MatchMe gallery) and P (character portrait/shared account avatar). Separate
flags and the descriptive filename with hyphens or underscores: `F-P_cafe.png`.
Order is irrelevant; repeated flags, multiple portraits and more than three
MatchMe photos fail. G alone explicitly means gallery-only. No P clears the
portrait and shared avatars. P alone creates neither posts nor MatchMe photos.
Missing M removes the MatchMe profile, while retaining any existing account.

Renamed original files are recognized by exact bytes or their registered stable
image label/path. New images must first be registered in `character.json` with
`id`, `path`, `name` and `description`; the offline tool does not inspect pixels
with an LLM or invent descriptions. This authoring step can be performed by an
assistant. Existing matching captions are retained, new posts start with empty
text unless authored, and text-only posts survive. Old image posts are replaced
according to the flags. Adding M to a new account requires a valid adult age and
profile bio in the specification. New accounts use the character's stable ID.

## Agency tags

Character Containers support optional `agencyTags` with up to two distinct IDs
from `shared/agency-tags.cjs`. Missing or empty tags mean unclassified. Tags
belong to the character: every catalog tag is valid whichever app accounts
exist, are disabled or are created later, and creating an account never depends
on the tags. Validation rejects only unknown IDs, duplicates and more than two
tags. Tags do not activate gameplay actions.

Accounts carry no agency data. Older files may contain `apps.<app>.agencyTags`
and `accountRole`; both are ignored by validation and dropped when the
character is normalized or saved. There is no creator account type.

Inspect and edit `agencyTags` with the same blob-free CLI procedure above.
The Character Assistant and Storybook editors provide an Agency Tags section
with two tag selectors. Assistant patches update the same character field;
hiddenAgency remains a separate free-text field.
See [NPC Agency Tags](npc-agency-tags.md) for the catalog semantics, compatibility
and runtime context rules.

## Saved Storybook NPC sources

The desktop NPC library scans the plain JSON files directly in
`<Electron userData>/files` alongside its character-container directories.
While a Storybook is active, the playable characters of every other stored
Storybook are available as read-only `saved-storybook` library NPCs carrying
their own published posts and the images those posts need. No character file is
written and neither the source Storybook nor its RP Saves are changed.
External directories are not scanned. Browser development retains its
bundled-only fallback.

### Source selection

`electron/npcLibrary.cjs` (`scanStorybookDirectory`) selects exactly one source
per stored Storybook:

1. The matching, usable RP Save with the latest valid `savedAt` time. Turn
   count, in-game date and file modification time are ignored; equal times
   resolve by filename order.
2. Otherwise the stored Storybook itself with its Opening History.

A save is usable when it is plain, loadable, has a valid `savedAt`, and its
Storybook state parses, is current, resolves every pooled media reference, and
all of its playable character payloads validate. A corrupt playable character
invalidates that save source as a whole, rather than silently dropping its cast.
An unusable save is reported and the next newest usable save is tried.
Alternate saves are never merged, and workflow files are never sources.

`sessionStorybookAssociations` is the only place that matches saves to
Storybooks. A save belongs to a Storybook file when `metadata.storybookFileNames`
records that filename for exactly one Storybook node. Saves without that
metadata, or linking several nodes to one file, are not attached; names,
character overlap and content are never compared. A stable Storybook ID can
replace this function without touching publication extraction.

A save source supplies one consistent state: the characters from its effective
Storybook state (`runtime.current.nodes[<node>].storybookJson`, rehydrated from
`entities.mediaData` through `shared/mediaPool.cjs`, else the embedded workflow
node) and the `socialPost` records of its timeline. The timeline already
contains the opening messages, so Opening History is not appended again. The
Storybook fallback supplies the stored characters and the `socialPost` records
of `openingHistory.turns`.

Only characters with `playable !== false` are exported. Library NPCs added to a
Storybook, characters removed from its cast, archived NPC participants
(`npcParticipantsJson`) and imported copies (`importedNpcsJson`) are never
re-exported as that Storybook's original cast.

When several stored Storybooks provide the same character ID, the Storybook
file with the newest modification time provides it, with filename order as the
tie-breaker; the save is then chosen inside that Storybook's lineage. The user
can override both defaults per file: in Start, a file that shares NPCs for the
current selection shows `Shares N NPCs`, the selected file itself shows its
playable cast as `N main characters`, and every other file that could share
them instead (the Storybook itself, another of its RP Saves, or a Storybook
whose characters another Storybook provides) shows a plain underlined `Switch` link
in the same place. Switching always takes the whole cast of that file: it
becomes the source of its Storybook (`origins`), and that Storybook moves to
the front of the list that wins shared characters (`priority`). Both are stored
as `npcSourcePreferences` in `workflow-state.json`, applied by
`selectNpcSources` for the import and the preview alike, and ignored once the
named file no longer exists or no longer belongs to that Storybook. A chosen
file stays the source even when a newer RP Save appears. Histories
of different Storybooks are never merged. Each entry records the winning source
as `publication` provenance.

### Active Storybook exclusion

Exclusion is active-session state and stays outside the source caches:

- The renderer sends the active Storybook filenames with every library request.
  Those Storybooks are not external sources, so another Storybook can provide a
  character the active file also stores. The snapshot echoes the names it was
  selected for.
- `createActiveStorybookContextCache` (`src/characters/externalNpcs.ts`) collects
  the stable IDs and identity aliases of every character in the active
  Storybooks. A matching external character is dropped before its posts or
  media are collected, so an active character never receives posts, images or
  profile changes from another Storybook. Names are never compared; other
  characters of the same external Storybook stay available.

### Publication snapshot

`prepareCharacterPublicationExport` (`src/characters/publicationExport.ts`) is the
single non-UI preparation behind the manual “Export Character with Own Posts”
and the automatic NPC copies. It takes an explicit character, publication
records, gallery and inclusion options, and returns a validated portable
container. The manual export passes the active Storybook plus current session
turns with its two checkbox options unchanged. `createExternalNpcLibrary` passes
the selected source with posts included and `receivedImages: 'referenced'`.

The copy keeps the source character ID, account IDs and relationships. Its
Fotogram and OnlyFriends `initialPosts` hold the authored starting posts plus
the character's own posts from the source, keyed by the existing seed identity
(`sourceSeedId`), so opening posts, timeline posts and repeated refreshes never
duplicate. Authorship resolves by account ID, then character ID, then the
established handle-and-name rule for legacy records. Images referenced by own
posts are copied from the source gallery; other received or shared gallery
images are left behind unless the public profile uses them. Private messages,
notes, bank state, purchases, likes, comments and match history are not
transferred. A post whose image is missing is omitted and reported as a
`missing-media` diagnostic for that character; other characters still load.

Priority by stable character ID is active Storybook, retained RP snapshot,
account NPC file, local NPC file, saved Storybook, then bundled NPC file. The
copies are not player-selectable, do not count as interacted and grant no
contacts. The library labels them “From Storybook” with
“Posts from: <Storybook> · <RP Save>”. Editing and saving creates a local NPC
override, leaving the source intact.

### Persistence with the RP

Uninvolved external NPCs are resolved dynamically from current library sources.
They are not copied into RP Saves. A committed incoming or outgoing private
message or a non-empty public comment captures the participating NPCs through
`captureStoryNpcParticipants` into `runtime.current.npcParticipantsJson`, using
the existing pooled participant archive. Explicit local editing retains its
existing capture behavior. Passive posts, likes, matches, discovery and loading
more comments do not capture characters.

This first communication makes the character a Story NPC. The separate
Interacted classification, character colors and reciprocal contact grants still
require a two-way private exchange with a playable character in the same app.
Story NPC snapshots take precedence over current external sources and are
excluded from automatic external preparation and the Start source preview.
Their saved revisions survive source changes or deletion.

New saves do not write `importedNpcsJson`. Older saves remain readable: on load,
only communicating characters from that legacy archive are promoted into the
participant archive. Uninvolved legacy imports are discarded and resolved from
current sources. The next save writes only the participant copies.

### Caching and refresh

The scan runs during library reloads (including startup and opening the library),
Storybook loads, Storybook saves, workspace-protection changes and active
Storybook changes. The main process caches one record per file, keyed by
modification time, change time and size; each changed file is read once per
scan, and switching the active Storybook reuses the records. Only selected
sources keep their characters in memory; released ones are read again when
they are selected. Prepared copies are cached in the renderer per character
and source revision, and publication ownership is indexed once per source.
Stale responses for an earlier Storybook, account or request are discarded. The
library service and its caches are recreated at every account transition.

Encrypted Storybooks and RP Saves are never decrypted for discovery, even when
a password is available; they are counted as “Protected sources”. Unsupported,
malformed or ambiguous sources produce diagnostics without blocking others.

Limitations: saves with filename privacy or encryption cannot be sources;
renaming a stored Storybook detaches its earlier saves; an RP Save grows by the
galleries of the external characters it pins.

### Library provenance and storage badges

The final gold provenance badge identifies the effective version: `Built-in`,
`Local NPC`, `Account NPC`, `From Storybook`, `Story NPC`, or `Storybook`. Known library
sources precede retained NPC or active Storybook versions. A scanned saved
Storybook copy does not add an import stage to an active Storybook character.
Payload differences remain in tooltips rather than modification labels.

A separate disk badge describes serialization of the current character payload:
`SB` for direct Storybook characters or retained NPC versions matching the
active Opening History, and `RP` for other retained NPC versions. Comparison
uses the effective character payload before display-only activity posts are
added. A divergent Opening History copy does not qualify the current NPC for
`SB`. Both can also be carried by RP saves; the badge is neither an exclusive
storage location nor an indication that changes have already been written to
disk. Library-only characters have no SB/RP storage badge.

### Start dialog source preview

The Start dialog requests `npc-library:preview` once when opened and refreshes
on library changes. The service reuses the file scan cache and returns only
compact identities, names, source associations and timestamps, never image or
post payloads. It does not change the running RP's active library selection.

`shared/npcSourceSelection.cjs` selects sources for both the actual import and
the preview. Clicking a Storybook or RP Save uses the in-memory index to mark
the supplying Storybook or save rows with NPC counts and character names. It
excludes active cast identities and higher-priority local NPCs; save previews
exclude saved story participants and show only external sources; there is no
retained-NPC count on the selected save. Protected or
unreadable target files show an unavailable status. Protected sources are
excluded under the existing background-discovery policy.

The manual Storybook character picker receives the freshly prepared library
from `useNpcParticipants.prepareLibrary` after reloading. It therefore imports
the same publication snapshots as the NPC Library, without waiting for a React
state update or using the scanner's unprepared character payloads.
