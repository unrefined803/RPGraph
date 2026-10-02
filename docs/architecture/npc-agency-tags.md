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
identity or exact handle fallback and samples at most five candidates randomly.

Comment threads retain up to six existing commenters, chosen by their most recent
appearance. Up to two newcomers fill unused places within that six-person cap.
The enabled post author is included separately. Disabled or missing accounts
are omitted; presentation follows registry order after selection.

Each selected character supplies its exact name and handle, character tags and
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

Candidate caps and supplied fields are fixed in code. There are no settings for
field inclusion or candidate counts, and selection uses `Math.random` rather
than a persisted reproducible rotation.

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
