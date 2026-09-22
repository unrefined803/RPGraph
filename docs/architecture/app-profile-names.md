# App profile names

## Terminology and storage

“Profile name”, “display name”, “username” and “nickname” mean the same editable
app name. The canonical JSON key is **profileName**. These terms must never
produce separate editable fields in editors, assistants or container tools.

- `character.name` is the real character name.
- Fotogram, OnlyFriends and MatchMe store one `apps.<app>.profileName`.
- WhatsUp has no profile name; it uses `character.name`.
- `accountId` is the stable technical identity and does not change on rename.
- `legacyHandles` are historical read aliases, not another public or editable name.
  Their first entry preserves the routing handle used by existing messages.

Example:

```json
{
  "name": "Helga Harper",
  "apps": {
    "fotogram": {
      "accountId": "character:helga_harper:fotogram",
      "enabled": true,
      "profileName": "helga.afterhours",
      "bio": ""
    },
    "whatsup": {
      "accountId": "character:helga_harper:whatsup",
      "enabled": true,
      "bio": ""
    }
  }
}
```

UI labels use the real character name followed by `@profileName`. IDs, historical
routing handles and account-link bindings are not rewritten when the name changes.
Historical narrator-created users retain their recorded identity for display.
New Fotogram and OnlyFriends comments and messages require a loaded character
or NPC with an enabled account in that app. Catalog names and historical dynamic
users do not authorize new activity, and phone contacts or accounts in another
app never create missing social accounts. Character lookup must be unique;
never guess a character from a similar name.

Post and comment-thread input supplies enabled app accounts and marks NPCs.
NPC reactions do not require a follow or subscription connection; the model
chooses participants from the supplied accounts. Following remains a separate
user action. An empty eligible audience is valid and does not create accounts.

## Legacy import rule

Readers continue accepting the old `username` / `displayName` account shape in
Character Container V2, Storybooks, NPC snapshots and existing RP saves.

1. An existing `profileName` is authoritative.
2. A non-empty legacy `displayName` different from the real character name wins,
   preserving an explicitly customized name.
3. Otherwise use the legacy `username`, restoring artist names.
4. If neither exists, retain the available legacy profile name or character name.

Canonical writes remove `username` and `displayName`. Old values remain in
`legacyHandles` for existing links and conversations. Migration is idempotent and
does not rewrite dialogue, translations, link tokens, IDs, media or match records.

MatchMe's nested `profile.name` is only an editor/runtime projection of the
account's `profileName`; exports omit it and the old `profile.username`. Import
restores that projection. WhatsUp exports omit all public app-name fields.

`normalizeCharacterApps` owns import normalization, `characterPayload` owns
canonical serialization, and `withCharacterAppProfile` retains historical routing
aliases during edits. Assistant instructions use `profileName`; old field names
in app-name JSON Patch paths are accepted as synonyms.

## Container maintenance

The 20 bundled NPC containers have been rebuilt using the inspect/edit workflow,
restoring their authored artist names and retaining all images and stable IDs.
User containers are normalized when loaded and written canonically on export;
this does not overwrite files in the user's library. Use the procedure in
[character-creator.md](character-creator.md) when revising a packed container.

## Public privacy mode and visibility

Fotogram and OnlyFriends accounts may store `privacyMode: true`. The shared
profile editor exposes this as **Privacy mode**. Omitted or false preserves public
real-name and avatar photo display for existing containers. When enabled (true), app labels and chat cards use `profileName` as the
primary name and hide the public avatar photo, showing anonymous fallback initials
instead; an enabled handle line still shows `@profileName`. The chat card option
`showProfileNames` controls only that extra handle, never whether a hidden real name is
revealed. MatchMe and WhatsUp do not support this setting. Character names, account
IDs and routing aliases stay intact. This is a public presentation preference, not
anonymization of the character data or the narrator's knowledge.

In the Fotogram/OnlyFriends profile editor, **Portrait** uses the character's
portrait crop. Selecting an album photo stores `avatarImageId` and uses that
full image, including when it is also the portrait source. Both render in a
fixed circular viewport without stretching. Privacy mode still hides either
choice publicly.

## MatchMe public identity

MatchMe accepts an optional `apps.matchme.profileName`. An explicit value wins,
including a name identical to the real character name. If omitted, the real
`character.name` is the default; existing containers need no batch migration.
Normalization and saving may materialize this default in the canonical account.
Legacy dating display names and nested profile names remain readable.
The profile editor exposes **Name**, **Age**, and **I am** independently of the
real character identity. New profiles default to the real name, adult age and
gender when available. Discovery, matches, conversations and history labels show
the dating identity's **First name, age**, without a handle.

`character.name`, `character.age` and `character.gender` always describe the real
person. A dating persona can differ in all three fields. Private model context
explains the distinction without making the real identity public knowledge.
WhatsUp continues to use the real character name and character portrait.
MatchMe avatars use an explicit dating avatar or the first dating photo, never
an unrelated character portrait. Dating photos remain gallery references;
no media is duplicated. Account IDs, aliases, matches and saved messages remain
stable when either name changes.
