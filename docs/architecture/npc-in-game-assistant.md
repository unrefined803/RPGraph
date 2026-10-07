# Character Assistant

The Character Assistant provides a character editor with provider-backed chat, image attachments,
manual forms, gallery assignments, local loading and saving. Autonomous NPC
execution is a separate feature and is not connected to this editor.

## Entry point and layout

Open **NPC Library → Create Character** to enter **Character Assistant** inside the
application. No Storybook node, separate executable or launcher entry is required.
The editor uses the Storybook Creator's dialog, character-card and chat styling,
and reuses `StorybookInlineEditor` for explicit Edit/Save/Cancel interactions,
`JsonSyntaxTextarea` for the Raw JSON preview, and `CharacterAppProfiles` for the
existing social profile forms. The left
pane shows one character and its gallery; the larger right pane holds the chat.

- **New Character** starts a fresh Character Container V2 draft.
- **Load Character** lists containers from the local Characters Folder. Encrypted
  files can be opened with their password; unsupported containers are rejected.
- **Load NPC** lists the local and built-in NPC Library containers. A local revision
  hides the built-in entry with the same character ID in this picker.
- **Undo** restores a previous draft, including a complete assistant edit. Up to
  twenty prior drafts are held in memory.

Both load actions edit the same container payload. Their only difference is the
source folder. Loading retains gallery bytes, identity, accounts and starting
posts; no disk extraction or conversion of existing JPEGs is needed. Closing,
starting a new character or loading another character requires explicit discard
of unsaved edits. Drafts are held in memory, not persisted across application exit.

The UI Preview initially shows a readable character card. **Edit** opens the
character text fields; **Accounts & Settings → Edit** reveals the additional
controls. The manual form includes name, age, gender, role, description, personality, speech
style, hidden agency, per-app relationships, social and WhatsUp profiles, starting posts,
banking and image-generation settings. Gallery entries expose names, descriptions,
assignments, portrait crop percentages and attachment selection. **Raw JSON**
shows the same lightweight projection used by the model, with binary media omitted.
Manual editing remains available without an API connection.

## Provider and assistant integration

`src/components/CharacterAssistantDialog.tsx` uses the shared `NodeLlmApi.complete`
request path with a selected existing LLM connection. **Provider Preset** lists only the configured preset labels. Model configuration
and vision capability still come from the selected connection. Keys,
model configuration and transport remain in the existing provider infrastructure;
this dialog adds no credential store. Unlike the Storybook Creator, it does not
inherit a connection from a graph node.

`src/characters/assistant.ts` builds a dedicated authoring prompt covering:

- editable character and account fields, banking and image-generation settings;
- standard WhatsUp/Fotogram accounts and optional OnlyFriends/MatchMe profiles;
- gallery descriptions versus social captions, portrait and app image references;
- immutable identity, application-managed media and creation of account/post IDs;
- loading, local save destinations, overrides and the distinction between editing
  a container and selecting a player in a running story.

The model receives the current draft projection and the twelve most recent
non-error messages. Gallery metadata is keyed by stable image ID under `images`;
character fields live under `character`. Embedded images and voice samples never
enter that JSON context. Only explicitly selected gallery images accompany the
request as vision attachments, in the order documented in the prompt. The dialog
requires a vision-enabled connection for image attachments; otherwise the user
can deselect them and describe the images in text.

Responses use `{ "reply": "...", "patch": [...] }`, with JSON Patch `add`,
`replace`, `remove` and `test` operations. The editor reuses the Storybook model's
JSON Patch operation implementation, with a separate character-editor allowlist.
It rejects edits to character identity, binary media, unknown images, account ID
paths and reserved properties. New account and post IDs are assigned by the
application; existing identities remain stable. The complete candidate is
validated before it replaces the draft. Invalid batches leave the original
untouched, including nested fields and media.

Each request captures a draft revision. Manual editing or Undo invalidates a
response from an earlier revision. Requests can be cancelled; errors restore the
submitted text for correction and retry. A response never performs a filesystem
write or gameplay action. Saving remains an explicit application control.

## Media workflow

**Add Images** in the gallery and **Attach Images** in the chat import local files
into the same gallery and select them for the next request. Existing images can
be attached again by checking **Attach**. The assistant can describe visible
images, rename them, write captions and update references; this is not a pixel
editing or image-generation endpoint. File names are not visual descriptions.

Each image exposes F/O/M controls, equivalent to the offline assignment tools:

- **F / O** creates or retains a starting publication in Fotogram / OnlyFriends.
  Clearing a flag removes that image's starting publications from that app.
  Create the account first if it does not exist. Captions remain editable under
  **Starting posts**.
- **M** adds a reference to an existing MatchMe profile. At most three gallery
  photos are allowed; removing its last photo disables the profile until completed.
- **Manage Portraits** opens the three shared portrait slots. Create the real
  Character Portrait first, then up to two custom portraits. Every slot has its
  own image and crop; app editors only select the slot. Portrait changes create
  no publications or MatchMe discovery photos.
- Unassigned gallery images remain available for later use. Filename prefixes
  are not interpreted by this graphical importer.

All app references point to one stored gallery image rather than duplicate bytes.
`src/characters/assistantMedia.ts` rejects animated PNG/WebP and GIF inputs before
browser decoding. It uses the shared browser normalization path for static JPEG,
PNG and WebP imports: browser orientation, proportional downscaling to at most one
megapixel without upscaling, white transparency background, metadata removal by
canvas re-encoding and JPEG quality 84. The approximate 0.2 MB size target is
advisory. The browser encoder can differ from the CLI in exact output size.
Unchanged gallery JPEGs are never re-encoded during load, editing or saving.

Removing a gallery image requires clearing its portrait, avatar, publication and
MatchMe references first. The assistant can move a photo from one app to another
by removing the old publication and adding the new reference in one transaction.

## Save destinations and overrides

**Save Character** uses the same protection controls and `CharacterSaveOptions`
as the Storybook export. The default is **NPC Library Folder**, whereas Storybook
export defaults to **Characters Folder**. All destinations remain selectable,
including for built-in revisions:

| Destination | Purpose |
| --- | --- |
| NPC Library Folder | User NPC entries and overrides in `<userData>/npc-characters` |
| Characters Folder | Character containers in `<userData>/characters` |
| Choose Save Location… | Native save dialog for an arbitrary export file |

The dialog displays the character's actual name with spaces, read-only. It never
shows the hyphenated storage filename as the character name. Filename sanitization
remains in the existing persistence layer. Loaded local revisions retain their
filename when saving back to the same folder; NPC saves also locate an existing
local revision by stable character ID. An existing target requires replacement
confirmation. The dialog does not display filesystem paths or a Save as Copy action.

**Plain JSON** and **Password encrypted** both use the existing persistence and
whole-file encryption code. Encrypted saves require a password or PIN. The optional
own-posts checkbox defaults to enabled. The portable serializer excludes private
dating history and runtime media access metadata; API keys and assistant messages
are never exported. Encrypted NPC files appear as locked rows with available public metadata,
filename, modification time, container version and encryption status. Current
envelopes do not expose the character name; protected filenames require unlocking.
The row offers only **Info**, explaining automatic unlocking. There is no manual
NPC password entry. Activating a protected game (Storybook, RP Save, or encrypted
workflow) tries its password against the NPC Library. Reading a file for preview
or editing a standalone character does not unlock the NPC Library. Unlocking adds
validated characters to the normal registry with its duplicate and override rules.

Account and active game passwords are retained in memory only. The NPC service
tries each available password once per unchanged payload and retains matching
unlocks on reload. Changing the game password clears prior attempts and decrypted
entries, then retries with the signed-in account password and new game password.
An unprotected game can still use matching account-encrypted NPCs while signed
in. Closing the application clears this state. IPC library snapshots expose
unlock status and unlocked characters, never passwords.

Saving or loading a protected Storybook or RP Save establishes mandatory game
protection. RP Save (including quick save and Save As), Storybook, workflow and
character exports inherit the same password and cannot select Plain JSON. The
Electron write handlers reject plain writes and different passwords as a second
check. A pre-existing plain RP quick-save target is rewritten as an encrypted file.
Clearing chat history alone does not remove protection. Starting another workflow
or opening another RP Save establishes that game's protection. Replacing a
Storybook releases its password when the retained workflow is unprotected; the
NPC Library immediately drops the old decrypted entries. A workflow loaded from
an RP Save follows the replacement Storybook's protection, regardless of the
save's original protection. A plain replacement releases the old game password;
an encrypted replacement establishes its own password. This affects the current
game only, not the original RP file. Independently loaded encrypted workflows
retain their own protection and reject conflicting Storybook passwords. Encrypted character
imports likewise require a matching protected game first.

RP saves preserve the active workflow and Storybook source names in optional
metadata. Saving does not rename the workflow to an embedded-container label.
Older saves without source names display "Workflow from RP Save" and the
Storybook title. Replacing a workflow or Storybook detaches the previous RP save
and clears its play history without modifying the saved file.

Saving preserves character, account, image and existing post IDs. A built-in
revision saved to NPC Library replaces the bundled definition by ID through the
existing user-over-bundled registry precedence; the original program file stays
unchanged. The provenance chain identifies the built-in source and effective Local NPC entry. Saving to
Characters Folder or another location is an export and does not change the active
NPC Library. Removing a local override restores the bundled definition on reload.

**View / Edit Character** on a library row opens the Character Assistant with that
exact character already loaded. Create Character continues to open an empty draft.
The editor's save destination starts at NPC Library Folder in both cases.

The creator writes `playable: false` without exposing this internal flag in the
form or model projection. Storybook import controls player eligibility. Saving a
library file does not modify existing Storybook definitions or session snapshots.

## Hidden agency

`character.hiddenAgency?: string` stores author-only motivations as free text in
the common PC/NPC payload. An absent field or empty string means no authored
agency. Existing V2 containers remain valid; no format bump or separate table is
needed. The field is preserved through editing, import and portable export.

Authors can describe primary and secondary goals, relationships, conditions,
boundaries and clues to concealed motives. No fixed goal catalog is required.
Character-level agency tags provide a separate structured vocabulary.

Hidden means withheld from public profiles and ordinary RP prompt context, not
encrypted in the JSON container. The authoring assistant intentionally sees it.
Social reaction prompts include it as private characterization. It does not
trigger posts, messages, account changes or banking transactions on its own.
Storybook Formatted Text provides an explicit Hidden Agency output switch,
disabled by default; it does not change this assistant or activate autonomy.
The editor does not schedule autonomous NPC actions.

### Avatar face framing

The application runs no local face detector. When the Character Assistant sets
or changes a real or custom portrait to an attached image, the vision model reports the face next to its patch:
`"faces": {"<image-id>": {"centerX": 50, "centerY": 30, "height": 25}}` (face
center in percent of the image width and height, head height in percent of the
image height). `faceCropFromEstimate` turns each estimate into the square crop
of every portrait slot referencing that image; images without a reported face
stay uncropped. **Manage Portraits** opens the shared slot manager and
crop dialog (`ProfilePickDialog`) for a manual choice. The Python/MediaPipe
detector from `character:faces:setup` remains a development tool for the
`character:create`, `character:edit` and `character:faces` scripts and is not
part of packaged builds.

The chat composer uses a full-width text area with attachment and send controls
in one bottom action row. Settings and publication cards use spaced disclosure
sections instead of unstyled browser arrows and adjacent full-width buttons.

### Effective library rows and staged authoring

The NPC Library and Load NPC picker share `visibleLibraryEntries`. One valid local
revision with the same character ID hides the bundled row and displays
a Built-in → Local NPC provenance chain. Matching uses identity, not name or
filename. New user entries are labeled Local NPC. Counts reflect visible characters rather
than both files; ambiguous duplicate local files remain visible for diagnostics.
The existing registry's user-over-bundled precedence still controls execution.
No persisted primary or disabled flag is needed, and removing the local revision
restores the bundled entry.

The provider preset selector sits to the right of the assistant heading.

Authoring uses four prompt roles: the main conversational editor and three
specialists for the profile, the image descriptions, and the accounts with image
assignments and agency tags. Creating a character is staged: the main response
returns `steps: ["profile"]` with an empty patch, the profile specialist writes
identity and personality, and that result is committed as its own undoable
change. Each following stage starts from a Continue action on the assistant
reply and is committed separately. Targeted edits and questions continue to use
the main prompt directly. Each specialist receives its own smaller instructions,
the current draft and images, and may only patch its own fields (`stepScopes`).

`nextCharacterAuthoringStage` picks the stage to offer after a reply:

1. `images` when the character has a profile, the provider supports vision and
   gallery images lack a description. The stage attaches up to
   `imageStageBatchSize` undescribed images itself and writes their name and
   description with the profile as context, so it can say who is shown. It is
   offered again until all images are described, but not after a run that made
   no progress. It is also offered after ordinary replies.
2. `accounts` when the main response requested it or a changed draft still has
   its generated Fotogram profile name (`accountsStagePending`). The stage sees
   the ticked images plus further gallery images up to the batch size and
   chooses portrait, Fotogram and MatchMe images itself unless the user named
   one. For a new character it must replace the placeholder name and, when the
   conversation never addressed the optional accounts or the agency tags, ask
   with an empty patch instead of guessing. With an empty gallery it still
   creates the accounts, says that images are missing and keeps a requested
   MatchMe profile as a disabled draft.

Ticked image attachments persist across replies until the user unticks them. A
stage question or a failed stage attempt keeps the next user message inside
that stage, and errors offer a Retry action for the same request and stage.
There is no recursive delegation; a validation failure, cancellation or
concurrent edit discards only the running stage. The UI reports the active
step; no model stage saves files automatically.

### Character references and relationships

Type `@` and at least one letter in either assistant composer to search up to five
Storybook or NPC Library characters. Selecting a result attaches that character's
stable identity and compact characterization/account context, without binary
media, Hidden Agency or private app history. References stay visible as removable
chips. A reference alone neither imports the NPC nor creates a contact.

The shared **Contacts & Relationships** editor stores one target ID, four
independent app flags and a free-form relationship description per row. WhatsUp
numbers and Fotogram/OnlyFriends follows are directed; MatchMe is a mutual
starting match. All flags default to false. OnlyFriends follows do not purchase
content. Missing targets retain their IDs and appear unavailable.

Both assistants can patch relationships. The profile specialist handles them in
the existing sequential creation flow; no additional specialist call is needed.
See [Character Container relationships](character-container-v2.md#contacts-and-relationships)
for the schema, legacy migration, runtime projection and validation contract.
