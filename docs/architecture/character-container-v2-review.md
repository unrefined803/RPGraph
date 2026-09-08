# Character Container V2 — Branch Review

Reviewed on 2026-09-07 against `main...be104ee` (16 commits, 156 changed files),
using `character-container-v2.md` as the implementation contract. Stage 8 remains
optional and is not treated as a missing implementation in this review.

The review covered schema and migration, registry and discovery, snapshots and
save hydration, publication and media ownership, promotion, messenger validation,
profile editors, creation tooling and packaging configuration. The original
findings below are retained alongside their resolutions and follow-up review.

## Resolved findings (2026-09-08)

### P1 — WhatsUp sender identity used fuzzy name resolution

Originally, `src/app/useGraphRun.ts` resolved the recipient with
`resolveWhatsUpRecipient`, but called `canonicalPhoneName` for the sender in
direct phone output, embedded messages and command-generated messages.
`src/App.tsx` also caught sender-resolution failures in `appendPhoneMessage`
and continued without an ID.

For a character named `Nova Test`, a sender string `Nova` becomes `Nova Test`;
an unknown sender string remains accepted by the name canonicalizer. A canonical
account ID supplied as `from` is not converted to its owner's display name by
that helper. This can attribute generated messages to the wrong person or create
an unbound historical sender despite the new exact-identity contract.

Resolution: every delivery path now resolves both endpoints before a phone side
effect and carries canonical names and account IDs into the timeline. Stable
account IDs resolve to their owners, disabled and ambiguous identities are
rejected, and explicitly recorded historical contacts remain available.

### P2 — Profile edits did not validate the whole effective registry

Originally, `commitStorybookToNode` in `src/storybook/useStorybookActions.ts` validated only
the edited Storybook's characters. `saveDatingProfile` in
`src/storybook/useStorybookPhoneImages.ts` checks usernames within that same
Storybook, while `saveSocialUsername` builds its directory without library or
snapshot entries. The `replaceExisting` branch also returns before the new
payload/account validation.

Reproduction: edit a fresh Storybook account to use an existing library NPC's
username. Each source passes its local directory check, but the effective
registry then resolves that username as ambiguous. Raw account-ID collisions can
also make previously available accounts unusable. The import preflight already
checks the registry, so imports and edits currently have different guarantees.

Resolution: Storybook commits, replacements, assistant updates and phone profile
saves now build and validate a candidate effective registry before mutation.
Whole-character precedence is retained, newly introduced conflicts are blocked,
and unrelated diagnostics already present in the library remain non-blocking.
Replacement validation completes before the current session is cleared.

### P2 — `playable: false` was not enforced by player selection

Originally, `src/characters/registry.ts` computed `playerSelectable`, but
`storyCharactersFromNodes` in `src/storybook/runtime.ts` returns every Storybook
character without retaining the flag. The player menu in `src/App.tsx` renders
that complete list. A V3 Storybook containing a character with `playable: false`
therefore still offers that character as a player.

Resolution: runtime characters retain an explicit player-eligibility flag. The
speaker picker, restored/fallback selection, phone switching and indirect social
selection use the playable subset, while the complete participant list continues
to provide accounts, context, contacts and event behavior.

### P2 — Legacy unscoped post IDs could share interaction state

The local correction below prevents an unrelated timeline post from suppressing
a seed solely because their IDs match. However, Storybook seed IDs remain bare
source IDs, and the social UI and reactions still key state by app/post ID.
Importing a seed whose ID equals another author's existing live post can produce
two posts sharing likes, comment lookup or UI keys. Character import checks other
character seeds, but does not check live timeline IDs.

Resolution: the shared Storybook candidate preflight compares bare starting-post
IDs with retained timeline posts and rejects newly introduced cross-owner
collisions. Existing owner-matching replacement behavior and saved legacy keys
remain unchanged, avoiding a reaction or checkpoint migration.

## Local corrections applied

- Capture known NPC comment authors from structured reaction handles, including
  comments on a player's live post. Ambiguous handles do not capture anyone.
- Replace a projected starting post only when the timeline post also matches its
  owner; matching an app/post ID alone no longer suppresses it.
- Keep external gallery images referenced by portraits, app avatars, MatchMe
  photo selections or initial posts during automatic pruning. Unreferenced
  external images remain eligible for pruning.
- Enable an existing disabled MatchMe account when its setup is saved, in both
  shared character setup and phone profile editing.
- Apply saved MatchMe gender preferences to new discovery candidates. Existing
  matches remain accessible; legacy profiles without preferences remain
  unrestricted. Candidates without a specified gender do not satisfy an explicit
  preference.

Regression coverage was added for comment-author capture and save restoration,
owner-aware seed replacement, and gallery-reference preservation during pruning.
Player eligibility, fuzzy sender resolution and cross-source handle ambiguity
were additionally reproduced through non-UI calls to the relevant pure helpers.

## Validation

The follow-up review of the uncommitted fixes found and corrected additional
integration and compatibility gaps:

- Validate embedded WhatsUp image actions before applying captions, and validate
  user phone inputs before gallery or run mutations. Resolve through the complete
  app cast so disabled library accounts cannot reappear through history.
- Preserve recorded historical contact IDs and implicit legacy Storybook phone
  IDs through repeated resolution. Canonical IDs take precedence over names;
  temporary phone views do not provision new accounts.
- Model full replacement using incoming Opening History snapshots instead of
  the discarded session archive. Include incoming posts in collision checks,
  but do not reject a new session because of discarded timeline activity.
- Reject cross-app reuse of raw account IDs and apply differential registry
  validation to character imports as well as profile edits.
- Recognize own legacy posts without canonical author IDs, and validate literal
  Storybook post IDs even when they begin with `npc-seed:`.
- Open NPC phone conversations from a playable participant's side, falling back
  to narrator inspection when neither participant is playable. NPC social links
  also remain inspectable without selecting their owner as player. Event actors
  continue to use the complete Storybook participant list.

Regression tests exercise actual Storybook commit and phone profile hooks as
well as player selection transitions, in addition to the pure registry,
publication and messenger helpers. No UI is mounted by these hook tests.

The original branch passed the complete non-UI test suite, build and lint.
The corrected state also passed `npm run --silent test`, `npm run build`,
`npm run lint` and `git diff --check`. The 2026-09-08 resolutions passed the same
complete non-UI test, build, lint and diff-check validation.

No application, Electron window, browser, UI test or E2E test was launched.
Interactive validation remains with the user, particularly disabled-account
setup, MatchMe filtering, gallery retention and the documented promotion/save
round trip. Packaging configuration was inspected; no packaged application was
launched. Existing ambiguous legacy post state is not migrated by this change;
new conflicting imports and edits are rejected before mutation.
