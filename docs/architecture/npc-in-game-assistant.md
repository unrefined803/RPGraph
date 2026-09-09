# NPC In-Game Assistant

Status: proposed editor; no editor UI, model requests or autonomous NPC execution
are implemented by this change. The container field and offline media tools are
implemented foundations.

## Container preparation

`character.hiddenAgency?: string` stores author-only motivations as free text.
An absent field or empty string means no authored agency. The field applies to
the common PC/NPC character payload. Existing Character Container V2 files remain
valid; no version bump or separate database table is needed. Import, editing,
Storybook normalization and portable export preserve it.

Authors may describe primary and secondary goals, how friends and strangers are
treated, conditions, boundaries, changes of intent and clues to concealed motives
inside this one field. No fixed goal catalog or relationship schema is required.
The current bundled NPCs start with an empty string. The user's proposed agency
catalog will be supplied later as authoring guidance for the editor assistant.

Hidden means withheld from public character profiles and ordinary RP prompt
context, not encrypted in the JSON container. This field must not itself trigger
messages, posts, account changes or bank transfers. Future runtime integration
needs a separate design for relevant context, scheduling, state and permitted
in-game actions. The current change does not connect the field to that runtime.

## Entry point and layout

Add **Create Character** and **Edit Character** to NPC Library inside the existing
application. Open a dedicated editor dialog/workspace with the application's
visual language. A separate executable or launcher menu entry is unnecessary.
The same container model supports playable characters as well as library NPCs.

The left pane contains editable name, age, description, personality, speech style,
role, playable flag, hidden agency, accounts, starting posts and a visual gallery.
The right pane contains a chat assistant, provider/model selection, image
attachments and request status. Manual editing works without an API connection.

Users can create a character, open an existing V2 JSON container, or edit a library
entry. Loading parses the container into an in-memory draft; disk extraction is
not required. Existing images are displayed through local object URLs and stable
image IDs. Unsaved changes are recoverable or explicitly discarded when closing.

## Media workflow

Each image exposes Fotogram, OnlyFriends, MatchMe and Profile toggles. These use
the same F/O/M/P meaning as the offline tools; filename prefixes are optional
import hints in the graphical editor, not persistent runtime identity.

- F and O create or retain a starting publication in the selected app.
- M selects a MatchMe gallery photo; the current schema allows one to three.
- P selects one character portrait and the shared account avatar. It does not
  implicitly add a post or MatchMe photo. Changing the selected image clears an
  incompatible crop; the editor offers crop selection.
- Gallery-only images remain possible. The offline representation uses G alone.

Adding a file does not duplicate its bytes for each app. Existing image IDs stay
stable across renames and revisions. New images receive stable IDs once accepted.
The assistant can inspect explicitly attached images with a vision-capable model,
propose English names, descriptions and captions, and change assignments through
structured edits. Without vision support it requests a description instead of
claiming to have inspected the picture. File names are not visual descriptions.

Decode new/replaced images locally, auto-orient, resize proportionally to at most
one megapixel without upscaling, flatten transparency on white, strip metadata and
encode JPEG at quality 84. The approximate 0.2 MB target is advisory. Unchanged
embedded JPEGs retain their exact bytes. Animation and unsupported media fail
with an actionable error. Browser implementation should share these semantics
with the CLI, even if its encoder produces different byte sizes.

## Assistant integration

Reuse provider credentials, model selection and request infrastructure from the
existing application. Inspect the current provider and assistant hooks before
implementation rather than building another credential store. API keys and
assistant chat history do not belong in exported character containers.

Send a small draft projection containing editable fields and image metadata.
Send image bytes only for selected vision attachments, never the entire embedded
gallery as JSON context. The assistant returns structured operations against
allowed fields and stable media IDs. It cannot invent image bytes, filesystem
paths or new IDs for an existing character/account revision.

Validate operations against the current draft revision, apply them as one undoable
change and show the resulting form immediately. Reject stale responses after the
user edits or switches characters. Support cancellation, retry and clear model
errors. Descriptive and authoring chat content never directly executes RP actions.

## Save and acceptance

Validate all accounts, image references, MatchMe requirements and hiddenAgency's
string type before export or installation. Show missing required values in the
form. WhatsUp and Fotogram are standard accounts; OnlyFriends and MatchMe are
optional. Library revisions retain identity. Saving an independent copy allocates
a new identity explicitly. Bundled read-only content is saved through the existing
user-library installation mechanism, followed by reload.

Acceptance scenarios:

1. Open an existing container, change hidden agency, save and reopen without losing
   media bytes, stable IDs, starting posts or agency text.
2. Add an image through chat, describe it with a selected vision model, assign F/P,
   preview its caption and portrait, then save a valid container.
3. Move an image from Fotogram to MatchMe without leaving its previous post behind.
4. Edit all fields manually with no provider configured.
5. Cancel or reject an invalid assistant edit without damaging the last valid draft.
6. Reopen the saved container in the offline tools and retain equivalent data.
7. Confirm hidden agency neither appears in public profiles nor initiates gameplay.

Implementation order: manual draft editor and persistence; gallery assignments
and conversion; provider-connected structured assistant; agency authoring guidance.
Autonomous NPC gameplay is a separate later feature.
