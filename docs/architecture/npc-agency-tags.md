# NPC Agency Tags and Social Reactions

Status: phases 1 and 2, direct-message context, and the post-reaction portion of phase 4 are implemented. Structured agency support, the revised 20-NPC roster, tag-aware one-to-one conversations, and Fotogram/OnlyFriends post audiences are available. The additional 30 NPCs, configurable context controls, and NPC-authored posts remain planned.

## Objective and agreed direction

Extend NPC Character Containers with structured agency tags and explicit app account roles, enrich the existing 20 bundled NPCs, then create 30 additional distinct NPCs. A later social game-master workflow receives a filtered, size-limited candidate list and decides who reacts to the player's activity.

- Assign one or two distinct agency tags per character, usually one. Store app-specific applicability explicitly without multiplying the character's total tag vocabulary.
- Most social accounts are ordinary users: target 80–90% users and 10–20% creators during content authoring. This is a population target, not a runtime random assignment.
- For the initial player-post reaction flow, only user accounts are candidates. Filter creator accounts before building the LLM context, even if a creator tag supports public interaction for a future flow.
- Default candidate lines contain only the character name and applicable tag IDs. Do not include account role, biography, handle, description, personality, or speech style by default.
- Provide an in-app candidate limit and independent toggles for description, personality, and speech style. These settings allow experiments with fewer, richer candidates.
- NPCs do not autonomously publish posts in the initial scope. Reserve a separate publication action for future support; tagging a creator must not activate posting.

## Troll roster extension

Four characters from the eight-character troll plan are currently bundled:
Joel Vance, posing as Chloe Vance on MatchMe (`catfish`, `comment_troll`), Tyler Briggs (`rage_baiter`,
`boundary_tester`), Felix Miller (`shitposter`, `social_lurker`), and Simon
Drake (`contrarian_debater`, `passive_aggressive`). Their enabled WhatsUp,
Fotogram, and OnlyFriends accounts have explicit compatible tags. All four
use privacy mode on both Fotogram and OnlyFriends.
Only Joel has an active MatchMe profile, presenting Chloe as a 22-year-old woman. Joel is a 28-year-old man whose character portrait is the vintage camera. Tyler's MatchMe account remains
disabled pending a suitable dating photo. The other four planned trolls and
their images are not included. See the generated population report for current
library totals.

## Original foundation

The bundled collection has 20 NPC containers in `resources/npc-characters`: all have enabled WhatsUp and Fotogram accounts, ten have OnlyFriends, and nine have MatchMe accounts. All have explicit agency assignments: 15 characters have one tag and five have two. Their existing `hiddenAgency` strings remain empty.

`src/characters/character.ts` defines the shared character and app-account types and normalizes app data. `shared/character-container.cjs` validates containers. Accounts retain enabled state, identity, biography and optional authored starting posts, plus the agency assignments and social user/creator roles added in phase 1.

`hiddenAgency` is optional author-only free text. Keep it separately for specific concealed motivations; structured agency tags are not a rename or automatic interpretation of that text. Tags guide characterization, not automatic messages, payments, or posts.

See [container architecture](character-container-v2.md) and [safe container authoring](character-creator.md) for persistence, NPC revision pinning and CLI procedures.

## Container representation

The fields below are implemented in phase 1. Use the shared character payload for Storybook characters, library NPCs, exports and saved NPC snapshots, with identical semantics.

```json
{
  "agencyTags": ["social_lurker", "loyal_supporter"],
  "apps": {
    "fotogram": {
      "accountRole": "user",
      "agencyTags": ["social_lurker", "loyal_supporter"]
    },
    "onlyfriends": {
      "accountRole": "user",
      "agencyTags": ["loyal_supporter"]
    }
  }
}
```

This is a partial schema illustration, not a complete valid container. Existing account IDs, enabled state, profile names, biographies and media references remain required according to the existing format.

- Character-level `agencyTags` declares the one or two authored tags.
- Each enabled app's `agencyTags` explicitly selects a nonempty subset of those tags. The central catalog determines whether each selected tag supports that app, role and action. Author tags and accounts together so every enabled app has a compatible assignment.
- `accountRole` is `user` or `creator` for Fotogram and OnlyFriends. WhatsUp and MatchMe remain ordinary messaging/dating accounts and reject `accountRole`. Creator-style WhatsUp tags describe messaging behavior on an ordinary account; they do not require or grant a social creator account.
- IDs reference one central tag catalog containing English meanings and applicability rules. Do not duplicate full tag definitions inside containers.
- Validate unknown IDs, duplicates, more than two character tags, app tags outside the character selection, invalid roles and incompatible app assignments.
- Legacy untagged containers remain loadable. Compatibility behavior: absent social account roles mean user; absent tags mean unclassified. Do not silently infer tags or creator status from biography or existing posts. The future tag-driven audience will exclude unclassified NPCs until authored; existing direct-message functionality remains available.
- Container 2.0.0 and Storybook 3.0.0 version numbers remain unchanged, following the existing additive relationships/hidden-agency contract. Current readers accept old untagged data and preserve new optional fields. Older application builds may discard agency fields during normalization or export; lossless editing of tagged content requires this implementation or newer. No backward round-trip guarantee is claimed.
- Preserve tags through normalization, assistant editing, Storybook editing, runtime projections, inspect/edit, export/import and save/load. Add deliberate authoring controls; tags need not appear in public app profiles.

## Action and role semantics

The original table below combines several meanings under `Post`. Replace that ambiguity in the executable catalog with explicit actions:

| Action | Meaning | Initial scope |
| --- | --- | --- |
| `react` | Like or comment on someone else's post | User accounts reacting to player posts |
| `dm_reply` | Respond within a direct conversation | Apply recipient's relevant tags |
| `dm_initiate` | Start private contact | Explicitly authorized workflow action; no automatic sending from tags |
| `publish` | Create an original NPC post | Reserved for later implementation |

A tag describes a tendency, not an obligation. A lurker can remain silent; a shy recipient can answer without becoming an eager initiator. Candidate count is not response count. Do not invent message delays or background scheduling from tags such as `quick_replier` or `sporadic_texter` in the initial implementation.

The executable catalog in `shared/agency-tags.cjs` records app/role/action applicability for all 54 tags: the 50 original entries plus `comment_troll`, `rage_baiter`, `contrarian_debater`, and `shitposter`. Original Fotogram `Post` entries support `react`; creator entries with `Post` additionally carry reserved `publish` metadata. `shy_user`, `social_lurker`, `slow_to_trust` and `good_listener` support replies but are not selected as initiators by this catalog. Other DM entries support replies and initiation. These are selection semantics for future tag-driven workflows, not restrictions imposed on existing direct conversations.

OnlyFriends requires a specific correction: the original table gives ordinary-user tags only DM applicability, leaving no user audience for comments. Implemented reaction-capable user tags are `social_lurker`, `loyal_supporter`, `respectful_admirer`, `parasocial_fan`, `genuine_user`, `friendly_regular`, `attention_seeker`, `boundary_setter`, `comment_troll`, `rage_baiter`, and `shitposter`. Other OnlyFriends user tags, including `contrarian_debater`, remain DM-only. Keep creator tags for creator DM behavior and later publication/creator interaction flows.

## Candidate selection and prompt context

Build candidates from the effective character registry, respecting Storybook overrides and pinned NPC revisions. Do not scan raw bundled files independently at runtime.

The implemented Fotogram/OnlyFriends post path builds candidates from the effective character registry, respecting Storybook overrides and pinned NPC revisions:

1. Resolve the post app, author identity, post text and available image context.
2. Require an enabled account for the target app and exclude the author by stable character/account identity, with exact handle fallback.
3. For NPCs, require `accountRole: user` and at least one app-assigned tag whose catalog entry supports `react` for that app and role. Creator accounts, unclassified NPCs, disabled accounts, wrong-app accounts and NPCs with only DM tags are omitted.
4. Show all authored character agency tags after `[NPC]` or `[Storybook character]`. Eligibility still uses app-specific reaction assignments for new posts; displaying additional traits does not grant new actions.
5. Storybook characters with an enabled user account remain available without invented tags, subject to author exclusion. Their established Storybook characterization remains available elsewhere in the workflow context; Storybook creator accounts are filtered like NPC creators.
6. The runtime prompt instructs the LLM to use tags as private behavioral guidance for participation, tone, wording and intent. A tag is a tendency, so any listed account may stay silent. Tag labels and instructions must never appear in public comments.
7. Following remains optional for this authored post-reaction flow. The existing structured-output validator still rejects invented or ambiguous identities.

Post reactions randomly sample at most five eligible characters, including eligible Storybook characters within the same cap. There is no forced positive/neutral/negative mix. Each selected entry includes description, personality, speech style, hidden agency, character agency tags and their catalog meanings, the current account bio, and privacy mode. Empty authored fields are omitted. These are private authoring data, never public character knowledge or executable instructions. The guidance applies to both comments and post-triggered private messages; platform alone does not imply sexual interest or directness.

Comment threads keep enabled existing commenters, including creator accounts and characters without public-reaction tags. They retain up to six distinct commenters by most recent appearance in the supplied comment history, then randomly add at most two new eligible accounts while keeping the commenter total at six. Once six have commented, no newcomers are selected. Old threads already exceeding six use the six most recently active distinct commenters. The enabled post author is provided separately, outside the six-commenter cap, so the author can answer. Disabled or missing accounts are never reintroduced. Selection changes membership; presentation retains registry order.

One-to-one DM context remains unchanged. The richer candidate data is supplied through the social action's input text by `socialReactionAccountContext`, not by an extra LLM search. The existing identity validator still rejects invented or ambiguous accounts. Public wording and DM initiation should follow each character's private characterization without disclosing it. Pass the actual post image when supported, or an available image description; do not claim image understanding from an image ID alone.

## In-app context controls

Proposed initial defaults, adjustable after experiments:

| Setting | Default | Behavior |
| --- | --- | --- |
| Maximum candidates | 20 | Positive integer cap after eligibility filtering; examples: 10, 20, 30 |
| Name and applicable tags | Always on | Minimal candidate representation |
| Include speech style | Off | Append authored `speechStyle` |
| Include personality | Off | Append authored `personality` |
| Include description | Off | Append authored `description` |

Persist these controls in the application's settings system and expose them together under NPC reaction context. No biography or role column is enabled implicitly. Omit empty optional fields and bound verbose field lengths so a candidate limit remains useful for controlling prompt size. Capture effective settings with the turn for diagnostics and reproducible regeneration. Changing these settings does not modify NPC containers.

## Population plan: 50 distinct NPCs

Apply account percentages to the final 50-character collection, not independently to each batch. Account sets overlap; these percentages are not expected to total 100%.

| App | Final target | Existing enabled accounts | Proposed additions among 30 new NPCs |
| --- | --- | --- | --- |
| WhatsUp | 50 / 50 (100%) | 20 | 30 |
| Fotogram | 35 / 50 (70%) | 20 | 15 |
| MatchMe | 15 / 50 (30%) | 9 | 6, only with suitable images |
| OnlyFriends | 25 / 50 (50%) | 10 | 15 |

These are authoring targets, not runtime quotas. Preserve existing accounts rather than removing them to force the new-batch proportions. The 10 OnlyFriends accounts added to the existing roster reduce the remaining requirement to 15 among the 30 new NPCs.

For example, use 30 users and five creators among the 35 Fotogram accounts, and 22 users and three creators among the 25 OnlyFriends accounts. This gives about 86% ordinary-user social accounts overall. Assign creator roles deliberately from authored character concepts. Review the unique-person distribution too, since one person can own multiple accounts with different roles.

The current normalizer provisions WhatsUp and Fotogram when absent. Author an explicitly disabled Fotogram account for new NPCs without Fotogram, and verify that inspect/edit and normalization preserve that choice. Do not accidentally turn the 70% target into 100%.

Create a roster before writing containers, recording identity, age, interests, background, personality, speech style, accounts, roles, tags and available media. Vary warmth, reserve, humor, confidence, motives and interaction frequency. Avoid cloning biographies or distributing every tag equally: ordinary friendly and quiet users should remain common, with a smaller range of conflict-driven or commercially motivated characters. A second tag should add a compatible dimension.

MatchMe needs suitable existing or newly supplied images and valid photo references. Do not reuse another person's portrait as a new identity or fabricate image availability. If six suitable new image sets are unavailable, report the shortfall and defer those MatchMe activations rather than creating invalid profiles. New media generation or acquisition is a separate decision. The other account targets do not require creating autonomous seed posts.

## Regenerating the authoring inventory report

Run `npm run npc:report` to create or refresh `docs/npc-population-report.md`.
The file is intentionally not ignored: it appears as a new file
in Changes and can be deleted after review. Keep the generator; the report is a
disposable authoring artifact and need not be committed.

The report reads the current bundled containers through the existing validated,
blob-free inspection helper. It shows population and enabled-account deficits,
user/creator counts, unique creator people, and one compact table containing
every catalog tag with its character count and per-app assignment counts.
Roster lists, owner names and separate missing/repeated-tag tables are omitted.
Identity conflicts remain visible in the validation section. Invalid containers stop generation without replacing the
previous report. It never edits characters or launches the application.

All 54 catalog tags should be represented at least once. Prefer missing tags for
new characters; repeated tags have lower coverage priority but no numeric maximum.
The documented social role counts remain examples, while the 80–90% user range
remains the population guideline. The report's executable population targets live
in `scripts/report-npc-population.mjs`; update them when changing this plan.

For another container directory or report location:

```sh
npm run npc:report -- --input resources/npc-characters --output /tmp/npc-review.md
```

Only a previously generated report may be replaced. Saved revisions, user-library
overrides, Storybook characters and future image availability are outside this
bundled authoring inventory. Account/tag compatibility comes from the executable
catalog, not the original reference table below.

## Ordered implementation phases

### 1. Finalize the catalog and extend containers — implemented

Implemented boundaries:

- `shared/agency-tags.cjs` and its TypeScript declarations provide the immutable 50-tag catalog, applicability lookup and shared validation used by Node/Electron and the renderer. Packaging already includes shared CJS files.
- `src/characters/character.ts`, the shared container validator and Storybook normalization preserve tags and roles and reject malformed values before they can be silently dropped. Missing or empty character tags are unclassified; populated tags require compatible explicit assignments on every enabled account. Disabled accounts can retain compatible assignments or an empty selection.
- `CharacterAgencyField` provides an atomic editor for character tags, per-app subsets and social account roles in the Character Assistant and both Storybook editors, plus a read-only preview. Invalid intermediate selections stay in the form until corrected; cancellation discards them. Concurrent changes to app identity, enablement or agency fields require reopening the editor.
- Character and Storybook assistants receive the catalog as authoring context. The Character Assistant accounts specialist owns character tags and app assignments together; its profile specialist cannot leave a partial classification. This catalog is not injected into ordinary gameplay prompts.
- Manual profile creation initializes a new account assignment from compatible tags already authored on the character; it never invents a new character tag. Existing profile edits preserve roles and assignments even when a profile form omits those fields. An explicitly empty incompatible assignment is rejected. The Agency Tags editor can refine the initialized subset.
- Runtime character projections retain structured fields for later use. Ordinary formatted Storybook context, recipient context and public profile fields do not gain tag instructions. Content comparison treats missing user roles, empty tag lists and tag ordering consistently.
- Creator/export, CLI inspect/edit and pinned NPC snapshots reuse the same validation and retain the fields. Phase 1 did not rewrite existing bundled NPC files; their content revision is recorded in phase 2.

Validation includes catalog completeness, malformed assignments, explicit app enablement, transactional assistant/form edits, import/export, Storybook persistence, CLI media preservation, saved NPC archives and legacy compatibility. Interactive form validation remains a manual user check.

Acceptance: valid tags and roles survive create → inspect → edit → import/export → Storybook/save round trips; invalid assignments fail clearly; old untagged characters still load; explicitly disabled apps stay disabled; media references and private-field boundaries remain intact.

### 2. Enrich the existing 20 NPCs — implemented

All 20 containers were inspected into distinct blob-free specifications, revised,
rebuilt with `character:edit` from untouched originals and validated before
replacement. The 27 gallery records (including exact embedded media), character
IDs, existing account IDs, portraits and existing posts remain unchanged. The
creator materialized empty `relationships` arrays where previously absent; no
relationships were added.

Current enabled accounts: 20 WhatsUp, 20 Fotogram, nine MatchMe and 10 OnlyFriends.
Fotogram has 18 users and two creators (Ari and Maya Brooks); OnlyFriends has nine
users and one creator (Maya Brooks). Across both social apps, 27 of 30 accounts
are ordinary users (90%). New OnlyFriends accounts have no starting posts or new
media, use unrelated pseudonymous profile names and set `privacyMode: true`.
The other existing social profiles keep real-name display, except Max's
attention-seeking Fotogram persona: `backstage.static` sets `privacyMode: true` and
uses a biography without that name. This does not rewrite Max as a scammer.

All nine MatchMe accounts now store the full character name as the canonical
compatibility `profileName`; no independently authored nickname remains in
public account/profile fields. Old names remain internal `legacyHandles` for
routing compatibility. Each dating profile has an explicit gender and seeking
selection: women seek men and men seek women for this authored roster. Eden
(man, seeking women) and Ivy (woman, seeking men) previously lacked gender;
these are explicit fictional authoring choices, not image-derived facts. Existing
ages, photos, biographies and interests remain unchanged. MatchMe renders first
name and age through the existing UI contract.

| Character | Character tags | OnlyFriends profile | Assignment rationale |
| --- | --- | --- | --- |
| Ari Blume | `fan_engager` | — | Outgoing music-community creator who engages followers. |
| Avery Hart | `genuine_user` | `velvet.hour` (user) | Sincere, observant and naturally playful. |
| Chloe Lane | `friendly_regular` | `afterglow.tempo` (user) | Warm recurring contact with an energetic social life. |
| Eden Moss | `hobby_friend` | `copper.spoon` (user) | Connects through cooking and shared local interests. |
| Eli Ward | `shy_user`, `social_lurker` | — | Cautious in private; mostly observes the public feed. |
| Ivy Rowan | `loyal_supporter` | `clover.corner` (user) | Practical, welcoming and encouraging toward familiar people. |
| Jordan Lee | `casual_chatter` | — | Easygoing everyday conversation about local discoveries. |
| Kit Harlow | `friendship_seeker` | — | Welcoming neighborhood-oriented friendship seeker. |
| Lena Ford | `flirty_networker` | — | Playful, sociable connections around music and events. |
| Luca Reed | `casual_dater`, `respectful_admirer` | `midnight.mileage` (user) | Relaxed dating privately; respectful admiration on social feeds. |
| Luna Sky | `sporadic_texter` | — | Independent routines and a relaxed, intermittent messaging rhythm. |
| Max Power | `attention_seeker` | — | Expressive music fan seeking public attention under an alias. |
| Maya Brooks | `fan_engager` | `paper.lantern` (creator) | Thoughtful art-community creator who engages returning followers. |
| Maya Quinn | `boundary_setter` | — | Independent and direct about personal limits. |
| Mina Park | `genuine_user` | `moss.and.clay` (user) | Grounded, candid appreciation without an ulterior motive. |
| Nika Brooks | `slow_to_trust`, `boundary_setter` | `silver.margin` (user) | Builds trust slowly and states clear public boundaries. |
| Noah Blake | `commitment_seeker`, `respectful_admirer` | `quiet.compass` (user) | Dependable romantic intentions and respectful public admiration. |
| Nova Reyes | `casual_chatter` | — | Conversational interest in ordinary local life. |
| Owen Reed | `loyal_supporter` | `open.road.radio` (user) | Welcoming, practical encouragement and regular support. |
| Sasha Vale | `good_listener`, `social_lurker` | — | Thoughtful private listener and quiet public observer. |

Per-app subsets avoid unsupported tags: MatchMe uses `casual_dater` for Luca and
`commitment_seeker` for Noah; their social audience behavior uses
`respectful_admirer`. Eli and Sasha use `social_lurker` on Fotogram and their
other tag in messaging/dating. Nika uses `boundary_setter` on social profiles,
while her private WhatsUp/MatchMe assignments also retain `slow_to_trust`.

Validation: shared container and agency validators, bundled-library discovery,
MatchMe canonical names and seeking, OnlyFriends name visibility, legacy alias
preservation, exact media comparisons, and a field-level diff against untouched
sources. Existing pinned save revisions and user-library overrides are not
rewritten; reload the library for current bundled discovery.

### 3. Author 30 additional NPCs

Draft the diverse roster against the remaining account targets, then create and validate 30 new stable identities with distinct profiles, explicit app enablement and compatible tags. Use the shared creator pipeline and provide a compact roster/count report for review.

Acceptance: 50 total unique bundled characters; no duplicate character/account IDs or conflicting app names; targeted account coverage or a documented media-related MatchMe shortfall; approximately 80–90% ordinary-user social accounts; meaningful character differences beyond tag labels.

### 4. Implement reaction context and settings — post reactions partially implemented

Implemented for new Fotogram and OnlyFriends posts: deterministic app/role/action filtering, author exclusion, compact account lines with applicable tags, private tag-use instructions and integration with the existing social identity/output validation. The context is attached by the User Input runtime, so both bundled workflow families receive it without duplicating instructions in workflow JSON. NPC publication and DM tag behavior remain inactive.

Still planned: configurable candidate limit, reproducible candidate rotation, and optional description, personality and speech-style fields. Until those controls exist, every eligible account is supplied with name, handle and applicable tags only.

Current acceptance: wrong-app, disabled, creator, author and action-incompatible NPCs never reach the initial public-reaction prompt; empty audiences are explicit; identity resolution remains validated; no descriptions, personalities, speech styles or tag labels enter public output. Remaining acceptance for limits, optional fields and deterministic rotation belongs to the planned settings work. NPC publication remains inactive.

### 5. Validate and review behavior

Run targeted non-UI tests for catalog rules, serialization, persistence and filtering, plus relevant static checks/builds. Use `npm run --silent test -- <filters>`. Verify edited media by hashes and report population counts. The user launches the app and manually evaluates reaction quality, candidate limits and context toggles; do not launch UI/E2E tests as part of routine implementation.

## Decisions still open for review

- Future configurable context controls must preserve the implemented five-candidate post sample and six-commenter thread default unless explicitly changed.
- Confirm final roster and media availability before creating the 30 additional NPCs.

## Original agency tag reference

The following table is preserved from the original proposal. It is a vocabulary/reference draft, not the executable eligibility matrix. In particular, its `Post` terminology and OnlyFriends user restrictions are superseded by the planned explicit-action review above. `Both` means User and Creator, not both action directions; `—` means no authored applicability in this original draft.

| WhatsUp        | Fotogram            | MatchMe     | OnlyFriends         | Tag                  | Short Meaning                                                                                                            |
| -------------- | ------------------- | ----------- | ------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `casual_chatter`     | Enjoys relaxed everyday conversation without strongly pursuing romance, money, attention, or deeper commitment.          |
| `Both · DM`    | `User · DM`         | `User · DM` | `User · DM`         | `shy_user`           | Is interested in others but communicates cautiously, hesitates to initiate, and opens up gradually.                      |
| `Both · DM`    | `Both · DM`         | `User · DM` | `Both · DM`         | `slow_to_trust`      | Keeps personal details private until repeated positive interactions make the other person feel trustworthy.              |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `friendly_regular`   | Frequently interacts in a warm familiar way and gradually develops comfortable recurring online relationships.           |
| `Both · DM`    | `User · Post+DM`    | `User · DM` | `User · DM`         | `hobby_friend`       | Bonds primarily through shared interests, hobbies, media, games, activities, or other mutual interests.                  |
| `Both · DM`    | `User · Post+DM`    | `—`         | `User · DM`         | `respectful_admirer` | Shows genuine admiration or attraction while respecting boundaries and avoiding demands for special attention.           |
| `Both · DM`    | `Both · DM`         | `User · DM` | `Both · DM`         | `good_listener`      | Encourages others to talk about themselves and responds thoughtfully to personal stories and problems.                   |
| `Both · DM`    | `Both · DM`         | `User · DM` | `Both · DM`         | `loyal_friend`       | Maintains dependable long-term contact and stands by people during conflicts, problems, or difficult moments.            |
| `—`            | `User · Post+DM`    | `—`         | `User · DM`         | `social_lurker`      | Usually observes quietly and rarely interacts, but occasionally responds when something genuinely interests them.        |
| `Both · DM`    | `Both · DM`         | `User · DM` | `Both · DM`         | `quick_replier`      | Usually responds rapidly and enthusiastically, making conversations feel active and easy to continue.                    |
| `Both · DM`    | `Both · DM`         | `User · DM` | `Both · DM`         | `sporadic_texter`    | Communicates sincerely but may take long irregular breaks between messages without intentionally ignoring anyone.        |
| `Both · DM`    | `Both · DM`         | `User · DM` | `Both · DM`         | `friendship_seeker`  | Primarily wants genuine friendship and companionship rather than romance, money, status, or promotional opportunities.   |
| `Both · DM`    | `User · DM`         | `User · DM` | `User · DM`         | `commitment_seeker`  | Looks for a serious romantic relationship and openly discusses compatibility, exclusivity, and long-term intentions.     |
| `Both · DM`    | `User · DM`         | `User · DM` | `User · DM`         | `casual_dater`       | Enjoys flirting and meeting people without immediately expecting exclusivity or a serious long-term relationship.        |
| `Both · DM`    | `User · Post+DM`    | `User · DM` | `User · DM`         | `mixed_signals`      | Alternates between strong interest and emotional distance, leaving the other person uncertain about their intentions.    |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `boundary_setter`    | Clearly communicates personal limits and directly refuses interactions, requests, or topics they are uncomfortable with. |
| `Creator · DM` | `Creator · Post+DM` | `—`         | `Creator · Post+DM` | `fan_engager`        | Actively talks with followers, replies sincerely, remembers regulars, and encourages friendly community interaction.     |
| `Creator · DM` | `Creator · Post+DM` | `—`         | `Creator · Post+DM` | `collab_seeker`      | Approaches other creators to suggest shared posts, promotion, projects, appearances, or mutually useful collaborations.  |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `passive_aggressive` | Expresses irritation indirectly through sarcasm, vague remarks, cold replies, or subtle public comments.                 |
| `Both · DM`    | `User · DM`         | `User · DM` | `User · DM`         | `guilt_tripper`      | Uses disappointment, sacrifice, or emotional pressure to make another person feel obligated to respond or help.          |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `genuine_user`        | Interacts naturally and sincerely without manipulation, hidden sales tactics, scams, or major ulterior motives.                |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `attention_seeker`    | Actively seeks attention, reactions, compliments, messages, and repeated engagement from other people.                         |
| `Both · DM`    | `Both · DM`         | `User · DM` | `Both · DM`         | `move_to_private`     | Tries to move conversations toward more private, direct, and personal communication channels.                                  |
| `User · DM`    | `User · DM`         | `User · DM` | `User · DM`         | `freebie_hunter`      | Tries to obtain free content, favors, access, gifts, or special treatment from others.                                         |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `jealous_attachment`  | Becomes emotionally attached and reacts negatively when others receive competing attention or affection.                       |
| `Creator · DM` | `Creator · Post+DM` | `—`         | `Creator · Post+DM` | `upseller`            | Regularly encourages paid access, extra content, gifts, money, subscriptions, or other premium interactions.                   |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `gift_fisher`         | Hints at wants, expenses, or personal problems hoping someone voluntarily offers money or gifts.                               |
| `User · DM`    | `User · Post+DM`    | `—`         | `User · DM`         | `parasocial_fan`      | Develops strong personal attachment to someone despite the relationship being mostly online or one-sided.                      |
| `Both · DM`    | `User · Post+DM`    | `User · DM` | `Creator · DM`      | `clout_chaser`        | Pursues connections mainly for visibility, status, followers, influential contacts, or access to another audience.             |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `screenshot_drama`    | Quotes, exposes, or threatens to expose private conversations to create conflict or social pressure.                           |
| `Both · DM`    | `Both · DM`         | `User · DM` | `Both · DM`         | `love_bomber`         | Overwhelms someone with affection, praise, and constant attention to create unusually fast emotional attachment.               |
| `Both · DM`    | `Both · DM`         | `User · DM` | `Both · DM`         | `breadcrumbing`       | Gives occasional attention or flirtation to maintain someone's interest without offering consistent commitment.                |
| `User · DM`    | `User · Post+DM`    | `User · DM` | `User · DM`         | `catfish`             | Uses a false identity, misleading photos, or fabricated personal details to deceive and attract others.                        |
| `Both · DM`    | `Both · DM`         | `User · DM` | `Both · DM`         | `boundary_tester`     | Gradually pushes personal, romantic, financial, or intimate boundaries to discover what another person tolerates.              |
| `Creator · DM` | `Creator · Post+DM` | `—`         | `Creator · Post+DM` | `promo_spammer`       | Repeatedly promotes their profile, content, offers, links, or subscriptions regardless of the recipient's interest.            |
| `Creator · DM` | `Creator · Post+DM` | `—`         | `Creator · Post+DM` | `exclusive_teaser`    | Teases supposedly exclusive content or access to encourage private contact, subscriptions, gifts, or payment.                  |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `rebound_seeker`      | Seeks quick emotional or romantic connection shortly after another relationship ended or became unstable.                      |
| `User · DM`    | `User · Post+DM`    | `User · DM` | `User · DM`         | `loyal_supporter`     | Consistently offers encouragement, companionship, engagement, and support without demanding special treatment in return.       |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Creator · Post+DM` | `status_flexer`       | Highlights wealth, popularity, connections, lifestyle, or achievements to increase their perceived desirability or importance. |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `fake_emergency`      | Invents or exaggerates an urgent personal problem to obtain money, favors, sympathy, or immediate attention.                   |
| `Both · DM`    | `Both · DM`         | `User · DM` | `Both · DM`         | `ghosting_pattern`    | Frequently disappears from conversations without explanation and later returns when attention or company is wanted.            |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `validation_fisher`   | Makes insecure or self-critical remarks hoping others respond with reassurance, praise, or compliments.                        |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `oversharer`          | Reveals unusually personal information quickly and often encourages others to disclose private details in return.              |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `drama_magnet`        | Regularly becomes involved in arguments, feuds, misunderstandings, and emotionally charged social situations.                  |
| `Both · DM`    | `Both · DM`         | `User · DM` | `Both · DM`         | `money_borrower`      | Builds personal rapport before asking for money while promising repayment or explaining financial difficulties.                |
| `Both · DM`    | `Both · DM`         | `User · DM` | `Both · DM`         | `possessive_friend`   | Wants unusually exclusive attention and becomes upset when someone grows closer to other people.                               |
| `Both · DM`    | `Both · DM`         | `User · DM` | `Both · DM`         | `emotional_supporter` | Regularly listens to problems, checks in, reassures others, and provides sincere emotional support.                            |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `flirty_networker`    | Uses playful flirting to build connections, gain introductions, or expand their online social circle.                          |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `ex_obsessed`         | Frequently discusses, monitors, compares others with, or attempts to reconnect with a former partner.                          |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `rumor_spreader`      | Passes along questionable personal stories or gossip that can create mistrust and conflict between characters.                 |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `comment_troll`       | Deliberately posts mocking, sarcastic, or disruptive comments under public posts to derail discussions and mock others.         |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `rage_baiter`         | Intentionally drops provocative, absurd, or offensive hot takes designed to trigger angry replies and high-friction debates.   |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `User · DM`         | `contrarian_debater`  | Constantly contradicts others and initiates exhausting, pedantic arguments to prove intellectual superiority.                   |
| `Both · DM`    | `Both · Post+DM`    | `User · DM` | `Both · DM`         | `shitposter`          | Derails conversations and posts with absurd humor, sarcastic memes, copypastas, or low-effort nonsense.                         |
