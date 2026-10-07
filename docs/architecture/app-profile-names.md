# App profile names

## Terminology and storage

“Profile name”, “display name”, “username” and “nickname” mean the same editable
app name. The canonical JSON key is **profileName**. These terms must never
produce separate editable fields in editors, assistants or container tools.

- `character.name` is the real character name.
- Fotogram, OnlyFriends and MatchMe store one `apps.<app>.profileName`.
- WhatsUp has no profile name; it uses `character.name`. An optional second
  name is described under [WhatsUp second name](#whatsup-second-name).
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

Account lists (the followed-accounts side panel, user search and direct-message
headers) show the real character name followed by `@profileName`. Posts and
comments in the Fotogram and OnlyFriends feed show exactly one name and no
handle: the real character name, or `profileName` alone for an account in privacy
mode. IDs, historical
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

Fotogram and OnlyFriends accounts may store `privacyMode: true`. Public labels
then use `profileName` instead of the real character name. The selected profile
portrait remains visible, including a Custom Portrait used for a separate
identity. Account IDs, routing aliases and private narrator knowledge do not
change. MatchMe and WhatsUp have their own public-name rules.

Every app selects `portraitId`: `character`, `custom1` or `custom2`. Missing
selection means `character`. The shared profile editor offers only these three
slots. Images and face crops are created in **Manage Portraits** in the gallery.
An uncreated custom slot is disabled. App forms never select arbitrary gallery
images as avatars. Posts and MatchMe discovery photos are separate.

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
WhatsUp uses the real name unless the second account is selected. Its portrait
and MatchMe's portrait each resolve their selected shared slot. MatchMe discovery
photos stay uncropped and never implicitly become the avatar. IDs, aliases,
matches and saved messages remain stable when a portrait or name changes.

## WhatsUp second name

Phone image delivery resolves either WhatsUp account ID or link to the same
character-owned gallery. A received image stores `receivedFrom` as the public
account name at receipt, plus the internal `receivedFromCharacterId` and
`receivedFromAccountId`. Gallery badges use only `receivedFrom`; the phone gallery
projects it to the sender account's current name while that account exists, so a
badge follows a rename like the chat thread does and never falls back to the real
name behind a second name. Forwarding names
the forwarding account, not the original image owner. Receiving the same pixels
again updates that receipt without duplicating the image. Account IDs also bind
timeline image references during cleanup, so character or alias renames do not
orphan shared images; previously issued account IDs from the registry aliases
bind as well, and legacy messages without IDs still match names. Undo restores
the latest surviving delivery label when an earlier copy remains. Storybook and
RP saves retain the provenance; portable character exports strip it. Old images
without the optional IDs remain readable and keep their recorded label.

`apps.whatsup.alias` is optional: `{ "name": "Sofia Belova", "portraitId": "custom1" }`.
Only `name` (1–60 characters) is required; omitted `portraitId` means `character`.
Select a custom slot for a separate visual identity. The character keeps one
WhatsUp account ID and inbox; the second name provides another public link.

- `@whatsup:<real name>` and `@whatsup:<second name>` both reach the same
  character. `resolveWhatsUpRecipient` returns the written name and, for the
  second name, the link identity `<account ID>:alias`. Messages and contact
  grants store that identity, so nothing that looks an account up by ID arrives
  at the real name by accident. A real name or account handle always wins; the
  second name answers only to itself. A bare name without a link resolves as
  long as it identifies exactly one account; a relaxed spelling that reaches
  both a second name and another name is rejected as ambiguous.
- A second name must differ from every character name and every other second
  name (`whatsUpAliasConflict`). The comparison ignores case, spaces, dots,
  underscores and hyphens, matching how participants are resolved. Storybook
  editing checks the Storybook; the phone's **Your accounts** form also checks
  NPCs outside it and shows the reason, naming who holds the name. The second
  name is stored in the Storybook, so it persists across new chats.
- The other person sees a separate contact with the second name and its own
  picture (`whatsUpAliasContact` in `src/chat/phoneCharacters.ts`). It carries
  no characterization and shows only the explicitly selected slot (the Character
  Portrait by default, initials when no portrait exists). It uses its owner's character color: a two-way
  exchange under the second name makes the owner an interacted NPC. Someone who has both
  links sees two contacts with separate threads.
- The owner sees one inbox. On the owner's own phone `phoneMessagesForOwner`
  reads messages under the second name as messages under the real name, and
  read state is shared between the owner's two conversation keys. This is scoped
  to the phone being viewed: reading the main contact on someone else's phone
  never reads that person's separate second-account contact. The thread shows a small
  badge (“Second account · <name>” or “Main account · <name>”) once where a
  conversation starts on the second account and at every later switch; the
  derived `phoneOwnerAlias` message flag behind it is never stored.
- Which account a message uses is the story's decision; nothing is blocked.
  An account link, an exact account ID and the second name itself are
  deliberate choices and are never rewritten, so a narrator can have someone
  discover or reveal the main account. Only a bare real name, which names no
  account, is completed from context: when a conversation has only used the
  second name (`whatsUpNameKnownBy`), it continues the second name instead of
  opening a thread under the real one. The message parsers keep the name for
  display and record `fromLink` / `toLink` for participants written as links.
  Consistency (how a character learned an account) is prompt guidance only.
- Stored account IDs take precedence over participant names. Renaming either
  party preserves account choice and the second-name protection. `phoneIdentity`
  projects current participant names into phone/chat views, embedded cards,
  reply reruns and model history; message bodies and shared link tokens remain
  unchanged. Read markers follow those names across renames. Legacy messages
  without account IDs keep their recorded names and name-based fallback.
  Historical identities cannot reactivate a disabled or removed second account.
  A second account with chats (`whatsUpAliasInUse`) can only be renamed in the
  phone and Storybook editors; removal stays available while it is unused.
- The player writes from the account the conversation last used
  (`whatsUpNamesUsedWith`), so a chat opened by a message to the second account
  answers from it. **Writing as** in the chat header switches the account; the
  choice holds until the conversation moves on. While the chosen account is one
  the contact has never exchanged messages with, the header warns that the
  message reaches them as a new, unknown contact.
- Exchanging messages under the second name, or receiving its link, never adds
  the real character as a contact or relationship of the other person. The
  owner is still pinned as a Story NPC, because both names are the same account.
- The replying character's private context lists both links and states when the
  current conversation runs under the second name. Character search lists the
  second name. Other characters' contexts never connect the two names, but the
  model reads the whole history and would. A WhatsUp input whose sender has a
  second name therefore carries a `Sender identity` note: the recipient treats
  the two names as different contacts unless the story has shown the connection.
  The current account does not determine what a character knows: an established
  discovery persists across account switches, and an unsupported suspicion stays
  uncertain. Private author context never establishes in-world knowledge.
- Model history names the person behind a second account on every WhatsUp
  line: `OF11girl (second account of Sophie Carter) texts Chloe Lane:`. The
  label (`phoneHistoryLabels`) is derived while formatting history and never
  stored or shown in the phone. It keeps the narrating model oriented; the
  prompts state that this is author knowledge, not character knowledge.
- On the owner's phone a message written from the second account shows the
  second name and its picture in the bubble.

The gear button in WhatsUp opens **Your accounts** (closed with Done, Escape or
by opening a chat): the fixed main account and
the second account, each with its picture and a click-to-copy link. Creating or
editing the second account opens a nested form; Character Setup offers the same
panel under **WhatsUp**. The interface calls the second name a second account
for work or privacy. Main and second accounts each select one of the three
prepared portraits. MatchMe uses the same selector. Face framing lives only in
the central gallery manager or the Character Assistant, which can populate
portrait slots using existing images and face estimates from attached images.

## Account links as message participants

Generated messages name both sides by account link, the same `@app:name` token
that is shared in message text: `@whatsup:Full Name`, `@fotogram:profile name`,
`@onlyfriends:profile name`. The bundled workflow prompts and the command
prompts ask for links in `from` and `to` of `whatsUpApp`, `fotogramApp` and
`onlyFriendsApp`; MatchMe keeps its exact account IDs. A link names one exact
account, which is what keeps a second WhatsUp name apart from its owner's real
name. Bare names, handles and account IDs remain accepted as a fallback.
Comments and post commands name their author the same way
(`"from": "@fotogram:profile name"`); the prompts no longer ask for a separate
`handle` field, which is still read when a model supplies it.

- `accountLinkIdentity` (`src/characters/messageAliases.ts`) reads the identity
  out of a link for one app. The leading `@` is required, because stored
  account IDs may themselves start with an app name. The message parsers in
  `src/chat/phoneMessages.ts` strip the prefix, so previews and reports show the
  name; `resolveWhatsUpRecipient`, `resolveSocialMessageIdentity` and
  `resolveDatingAccount` accept the link form directly as well. Inside a link
  the relaxed name spellings of bare names apply (`@whatsup:FirstLast`,
  `@whatsup:first.last`). Only when an identity is otherwise unknown, the
  resolvers of every app retry a link that lost its `@` (`fotogram:name`,
  `whatsup:Name`, `matchme:name`, `bank:Name`; `looseAccountLinkIdentity`).
  `resolveWhatsUpRecipient` also drops a copied history label
  (`Name (second account of Owner)`).
- Inputs list the links to copy. WhatsUp and social DM inputs carry
  `Reply from:` and `Reply to:` lines; `[AVAILABLE SOCIAL ACCOUNTS]` lists each
  participant's `Account links`; character search lists a link per account.
- Post and comment runs receive a runtime-only `[ACCOUNT LINKS]` block
  (`socialPublishedLinkContext`): the author's or actor's own accounts as
  private author data, and every account link published in the post or comment.
- A post or comment leads to WhatsUp only through a link published in it.
  `parseValidatedSocialReactionsOutput` accepts a `whatsUpApp` array next to the
  reactions, drops messages to any other account, and binds the recipient to the
  published account even when the model wrote its owner's real name.
- Fotogram and OnlyFriends captions and comments render account links like chat
  messages do (`AccountLinkText`; comments use its `nested` form because the
  comment row is itself a button).
