# NPC Agency Tags and Social Reactions

## Character tags

`character.agencyTags` contains at most two distinct IDs from
`shared/agency-tags.cjs`. The catalog supplies the tag meanings; missing or empty
tags mean unclassified. Tags belong to a character independently of app accounts.
Unknown IDs, duplicates and more than two tags are rejected.

Accounts have no agency tags or creator/user role. Legacy `apps.<app>.agencyTags`
and `accountRole` are ignored and dropped during normalization. Tags do not
create accounts, grant access, publish posts or schedule NPC actions.
`hiddenAgency` is a separate free-text field for private motivations.

The Character Assistant, Storybook editors, portable containers, saved NPC
snapshots and blob-free inspect/edit tools preserve character-level tags.
Container and Storybook versions remain 2.0.0 and 3.0.0 respectively.

## Candidate selection and prompt context

`src/characters/socialReactionAccounts.ts` builds Fotogram and OnlyFriends
reaction context from the effective character registry, including Storybook
overrides and retained NPC revisions. An enabled account with a usable handle is
eligible regardless of tags. A new post excludes its author by character/account
identity or exact handle fallback. Post inputs list directed relationships to
eligible contacts and catalog tag counts for accounts outside that contact list.
The authored post prompts use Ask character information to select participants
from these two groups, including a suitable negative agency candidate when one
is available; the input does not preload full profiles for that discovery pool.

Loading more comments uses the same discovery context. Counts and contact lists
exclude the post author, acting user, and all previous commenters from newcomer
searches, so new participants remain discoverable even after six people have
commented. Each existing comment combines its speaker name, character ID,
profile name, privacy status and full text in one entry, without account IDs or
a duplicate participant list. Older name/handle comment inputs remain readable.
Enabled previous commenters and the author may reply again;
the acting user's comments are never generated for them. The thread User Input
contains the full ordered comment list from the post and persisted social
reactions, including NPC comments omitted from chat-history summaries, even
when the acting character changes. New and returning participants can respond
to that discussion within the app's shared per-output comment limit. Both
bundled workflows request up to one contact and three additional people, using
post/image context and existing discussion to choose tags. Only new comments are
appended to the existing post; loading comments does not publish posts or send
DMs or tips. An exhausted newcomer pool still allows fitting replies from existing
participants; no suitable contribution from either group produces no comments.

Replies to a user-written comment retain up to six existing commenters, chosen by their most recent
appearance. Up to two newcomers fill unused places within that six-person cap.
The enabled post author is included separately. Disabled or missing accounts
are omitted; presentation follows registry order after selection.

For these user-comment replies, each selected character supplies its exact name and handle, character tags and
catalog meanings, description, personality, speech style, hidden agency, account
bio and privacy mode. Empty authored text fields are omitted. These fields are
private characterization data, not instructions or public character knowledge.
The prompt tells the model to use individual traits for participation and tone,
keep labels and private identities out of public output, and avoid inventing
participants. Tags express tendencies and do not force a reply.

The context supports comments and post-triggered private messages. Direct
conversations use their recipient-bound characterization. Account and message
validators still reject ambiguous or invalid identities; context selection does
not bypass delivery rules, paid access or MatchMe requirements.

User-comment reply caps and supplied fields are fixed in code; their newcomer
sampling uses `Math.random`. Post and load-more selection is performed by the
Character Assistant under the authored workflow prompts, using current eligible
counts rather than a random preselected audience.

## Publications and autonomy

Explicit workflow publication commands can create Fotogram and OnlyFriends
posts; see [Phone and JSON outputs](overview.md#phone-and-json-outputs).
Character tags and Hidden Agency do not trigger autonomous background publication.

## Bundled inventory

Bundled containers live in `resources/npc-characters`. Use the shared creator and
inspect/edit tools described in [Character creator](character-creator.md).
Existing character, account, image and post IDs remain stable when revising files.
Library reloads do not replace revisions already pinned in an RP.

For a disposable inventory report:

```sh
npm run npc:report -- --output /tmp/rpgraph-npc-population.md
```

The report validates bundled containers and counts enabled accounts and character
tags. It excludes user overrides, saved Storybooks and RP snapshots. Its target
counts, creator/user split and per-app tag coverage still reflect an older
planning model in `scripts/report-npc-population.mjs`; they are not runtime
requirements or the current agency schema. The executable catalog is the source
of tag IDs and meanings.
