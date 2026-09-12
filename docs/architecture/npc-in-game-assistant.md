# Character Assistant

Status: implemented character editor with provider-backed chat, image attachments,
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
style, hidden agency, social and WhatsUp profiles, starting posts,
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

Each image exposes F/O/M/P controls, equivalent to the offline assignment tools:

- **F / O** creates or retains a starting publication in Fotogram / OnlyFriends.
  Clearing a flag removes that image's starting publications from that app.
  Create the account first if it does not exist. Captions remain editable under
  **Starting posts**.
- **M** adds a reference to an existing MatchMe profile. At most three gallery
  photos are allowed; removing its last photo disables the profile until completed.
- **P** selects the character portrait. Accounts without a separate avatar use it
  as their fallback; accounts following the previous portrait follow the new one.
  Portrait selection alone creates no publication or MatchMe photo. A changed
  image clears the previous crop; percentage controls edit the new crop.
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

Both destinations use the existing `character:save` IPC handler and atomic file
writing. The editor saves plain Character Container V2 JSON, retaining authored
starting posts unless the user clears the own-posts checkbox. API keys and assistant conversations are never exported. The
shared portable serializer removes private dating history and runtime-only media
access metadata, as it does for existing character exports.

| Save destination | Directory | Purpose |
| --- | --- | --- |
| Characters Folder | `<userData>/characters` | Local character containers for later loading or Storybook import |
| NPC Library Folder | `<userData>/npc-characters` | User NPC Library entries and local revisions of built-in NPCs |

`userData` is Electron's per-user application-data directory (AppData on Windows),
not the installation directory. **Save Character** in the header opens a dialog using the same
`CharacterSaveOptions` component as the Storybook character export, with local
destination selection and an optional own-posts checkbox (enabled by default).
There is no persistent save footer. A successful save reports the full written path. The NPC root is also shown by
the existing library snapshot.

**Save** preserves character, account, image and existing post identities. A loaded
local file retains its filename when saved back to the same folder. For NPCs,
the editor looks up an existing local file by character ID, including renamed
files, to avoid creating a duplicate revision under another filename. Multiple
local files with that identity must be resolved before saving. An existing target
file requires an explicit replacement confirmation.

Editing a built-in NPC writes a user version to `<userData>/npc-characters` when
**NPC Library Folder** is selected. The program file remains untouched. The
existing registry resolves matching character IDs with `user` above `bundled`, so
the local revision becomes effective after library reload. This is precedence,
not a deletion or an enabled flag written to the program file. Removing that local
revision and reloading restores the built-in definition. Merely saving a character
in **Characters Folder** does not override the NPC Library.

**Save as Copy** allocates a new character ID, account IDs, image IDs and post IDs,
and rewrites all corresponding media references while preserving image bytes.
Its proposed filename ends in `Copy`; it creates an independent character rather
than an override. The library reloads after successful saving.

The creator always writes `playable: false` and does not expose this internal flag
in its form or model projection. Storybook import handles player eligibility.
The folder does not by itself make a character the active player. Player selection
currently requires a character in the Storybook with `playable` enabled. Existing
Storybook definitions and captured session snapshots retain their higher registry
priority; editing a library container does not rewrite an ongoing RP session.

## Hidden agency

`character.hiddenAgency?: string` stores author-only motivations as free text in
the common PC/NPC payload. An absent field or empty string means no authored
agency. Existing V2 containers remain valid; no format bump or separate table is
needed. The field is preserved through editing, import and portable export.

Authors can describe primary and secondary goals, relationships, conditions,
boundaries and clues to concealed motives. No fixed goal catalog is required.
A future agency catalog can extend authoring guidance without changing the schema.

Hidden means withheld from public profiles and ordinary RP prompt context, not
encrypted in the JSON container. The authoring assistant intentionally sees it.
It never triggers posts, messages, account changes or banking transactions.
Autonomous NPC scheduling, context and permitted in-game actions need a separate
runtime design.

## Validation

`src/characters/assistant.test.ts` covers transactional edits, source immutability,
identity and binary-media protection, new IDs, MatchMe drafts and activation,
portrait crop changes, publication moves, independent copies, local precedence,
prompt media omission and animation rejection. Existing Storybook patch and
library tests cover the reused mechanisms.

Interactive verification is performed by the user:

1. Open **NPC Library → Create Character**, select a provider and draft a character.
2. Attach a photo with a vision provider, request a description and F/P assignment,
   inspect the gallery and caption, then Undo and reapply a change.
3. Save in each local destination and reopen through the corresponding load action.
4. Load a built-in NPC, edit and save to NPC Library, then verify local precedence
   without changes to the installed file.
5. Cancel a request or edit the draft during a request; verify no stale changes apply.
6. Verify discard/overwrite prompts, encrypted character loading, manual profile
   editing and portable container compatibility with the offline tools.

### Local portrait detection

The Character Assistant now invokes the existing local MediaPipe detector through
`character:detect-face`. Selecting a new portrait runs detection automatically;
**Portrait crop → Auto Crop** retries it explicitly. The assistant may request the
same operation with `autoCrop: true` in its response. Exactly one detected face
produces a square crop; no face or multiple faces leave the crop unchanged and
show a diagnostic. Responses from an older draft revision are discarded.

This uses the Python/model installation from `character:faces:setup`, not the
selected chat provider. Packaged builds include the detector scripts; the Python
environment and model must be provided locally using `RPGRAPH_FACE_PYTHON` and
`RPGRAPH_FACE_MODEL`. A missing installation produces the existing setup message.

The chat composer uses a full-width text area with attachment and send controls
in one bottom action row. Settings and publication cards use spaced disclosure
sections instead of unstyled browser arrows and adjacent full-width buttons.
