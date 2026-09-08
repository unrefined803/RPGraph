# Character creator and demo conversion

Stage 6 uses `src/characters/creator.ts` for authored payloads and UI character
exports. Both produce plain `rpgraph-character` 2.0.0 documents validated by
`shared/character-container.cjs`. Storybook and node versions remain 3.0.0.

## Create and revise

From the repository root, with development dependencies installed:

```sh
npm run character:create -- --input docs/examples/character-specification.json --output /tmp/rowan.json
```

Local JPEG, PNG and WebP conversion requires ImageMagick 7 (`magick` on PATH).
The CLI decodes and auto-orients images, limits them to one megapixel, flattens
transparency onto white, removes metadata and encodes JPEG with an upper quality
of 84 and a hard 200 KiB size limit. Animated/multi-frame files are rejected.
Embedded galleries in existing V2 containers need no converter. Image dimensions
and byte sizes describe the output JPEG, not the source. Original files are read
only. No Electron, browser, LLM or UI is launched.

The example is authored fiction using existing landscape media. It is a new
identity, unrelated to every legacy demo and to the Stage 4 fixture.

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
No new UI creator/install button was added; UI exports use the common service,
and CLI installation is explicit. Storybook import and Add to Storybook use the
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
replaced images pass through the same JPEG, one-megapixel and 200-KiB conversion
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

## Explicit legacy conversion

```sh
npm run character:convert-demos -- --output /tmp/rpgraph-demo-staging
```

The converter creates 204 containers and `conversion-map.json`. The checked-in
[conversion map](demo-conversion-map.json) records every character, account,
source post, source image and legacy post pattern. The output is staging data,
not installed or packaged by default. Stage 7 must switch discovery sources and
provide compatibility resolution before these containers are activated.

- The two independent social catalogs each contain 100 identities. Character
  and account IDs preserve `bundled:<app>:<handle>`. No cross-app name matching
  joins these people. In particular, Sam Rivera is unrelated to MatchMe Sam,
  Cleo Hart to Cleo Noir, and catalog Nova Reyes to fixture Nova Vale.
- All 25 authored post captions are converted: 15 Fotogram and 10 OnlyFriends.
  The 13 Fotogram JPEG imports become their authors' galleries. Two Fotogram
  posts are text-only. OnlyFriends has no bundled post images; those captions
  become text-only seeds, without fabricated photos or audio.
- Synthetic likes, comments, comment identities as engagement, locks, prices,
  dummy flags, placeholder styling and viewer partitioning are not portable
  publication fields. They are omitted. Catalog commenters remain independent
  accounts; no private histories or backstories are invented for them.
- Existing cosmetic posts used `dummy-<app>-<viewerId>-<templateId>` and could
  override the visible author. Converted immutable source seeds use the template
  ID under the explicit source account. The map preserves the old key pattern;
  it does not migrate saved likes, purchases or authored-viewer substitutions.
  Stage 7 must retain their compatibility behavior instead of relabeling old
  activity as a different account's activity.
- Alex, Jamie, Robin and Sam preserve `demo-*` character/account IDs, existing
  age, gender, bio and personality. Their interests are retained in the mapping.
  No actual portraits exist. Their containers therefore have public MatchMe
  account metadata but no discoverable `profile`: the shared schema requires
  at least one gallery photo for that profile. Cosmetic card colors are omitted.
  These are compatibility identities, not newly authored replacements. Existing
  hard-coded profiles stay active until Stage 7; no new face receives their IDs.

This is an explicit, intentionally limited conversion of supported public data.
It does not claim lossless cosmetic conversion or migration of existing saves.
Current saves, discovery and runtime history stores are unchanged by Stage 6.
Manual creation/import, reload, profile display and packaged-app validation remain
with the user; automated tests cover the shared boundary and CLI round trips.

Stage 7 packages only the 13 Fotogram identities backed by actual image files:

```sh
npm run character:convert-demos -- --output /tmp/rpgraph-image-demos --images-only
```

This filtered mode writes readable character-name filenames such as
`luna-sky.json`. Image-less catalog identities, text-only authors, OnlyFriends
templates without images and the four legacy MatchMe placeholders remain outside
bundled discovery. The unfiltered command remains an explicit compatibility
inventory and staging tool; it does not make those entries discoverable.

## Bundled image-backed MatchMe characters

Seven independent fictional characters with explicit MatchMe and Fotogram
profiles are checked in under `resources/npc-characters/`. Their supplied source
PNGs were converted and embedded once, then removed after the inspect/edit path
proved a byte-preserving round trip. Future metadata, account, reference and
media changes use the packed-container workflow above. Stable character, account,
image and post IDs make each result a revision rather than a new identity.

## Portraits and automatic face crops

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
stored in the portable container. App avatars that reference the same gallery
image inherit the character crop. A different explicitly selected app image
remains uncropped. Changing or clearing the character portrait also updates app
avatar references that followed its previous image; independently selected app
images are retained. Gallery images, feed photos and MatchMe discovery photos remain
full images. MatchMe match and conversation avatars use the portrait too.

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

All 20 bundled NPC images were reviewed. The seven authored single-person
portraits now contain face crops. The thirteen legacy scene/gallery profiles
retain initials rather than cropping incidental people, objects or scenery.
Existing RP snapshots remain pinned to their saved revision; reloading the NPC
library updates library discovery, not previously captured snapshots. Those
portraits can be edited in the active Storybook or used in a fresh story.

Detector reference: [MediaPipe Face Detector for Python](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector/python).
Model reference: [BlazeFace models](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector#models).
