# Character Container V2 — Branch Review

Reviewed on 2026-09-07 against `main...be104ee` (16 commits, 156 changed files),
using `character-container-v2.md` as the implementation contract. Stage 8 remains
optional and is not treated as a missing implementation in this review.

The review covered schema and migration, registry and discovery, snapshots and
save hydration, publication and media ownership, promotion, messenger validation,
profile editors, creation tooling and packaging configuration. Findings below
distinguish local corrections from broader work deliberately left open.

## Open findings

### P1 — WhatsUp sender identity still uses fuzzy name resolution

`src/app/useGraphRun.ts` resolves the recipient with `resolveWhatsUpRecipient`,
but calls `canonicalPhoneName` for the sender in direct phone output, embedded
messages and command-generated messages. `src/App.tsx` also catches failures to
resolve the sender account in `appendPhoneMessage` and continues without an ID.

For a character named `Nova Test`, a sender string `Nova` becomes `Nova Test`;
an unknown sender string remains accepted by the name canonicalizer. A canonical
account ID supplied as `from` is not converted to its owner's display name by
that helper. This can attribute generated messages to the wrong person or create
an unbound historical sender despite the new exact-identity contract.

Follow-up: resolve both endpoints before any phone side effect and carry their
canonical names and account IDs through every delivery path. Preserve explicitly
recognized historical contacts and test ambiguous names, account IDs, disabled
accounts and unknown senders. This requires coordinated delivery-path changes;
it was not patched as a local name-helper change.

### P2 — Profile edits do not validate the whole effective registry

`commitStorybookToNode` in `src/storybook/useStorybookActions.ts` validates only
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

Follow-up: provide a shared candidate-registry preflight for full Storybook
replacement, both editors, assistant updates and phone profile saves. Preserve
whole-character override precedence and distinguish new conflicts from existing
unrelated library diagnostics. Validate before clearing the current session.

### P2 — `playable: false` is not enforced by player selection

`src/characters/registry.ts` computes `playerSelectable`, but
`storyCharactersFromNodes` in `src/storybook/runtime.ts` returns every Storybook
character without retaining the flag. The player menu in `src/App.tsx` renders
that complete list. A V3 Storybook containing a character with `playable: false`
therefore still offers that character as a player.

Follow-up: separate player eligibility from the full Storybook participant list,
including selected-player restoration, phone-owner switching and event actors.
Do not simply remove non-playable characters from the shared runtime list, since
that would also remove their accounts, context and other participant behavior.

### P2 — Legacy unscoped post IDs can still share interaction state

The local correction below prevents an unrelated timeline post from suppressing
a seed solely because their IDs match. However, Storybook seed IDs remain bare
source IDs, and the social UI and reactions still key state by app/post ID.
Importing a seed whose ID equals another author's existing live post can produce
two posts sharing likes, comment lookup or UI keys. Character import checks other
character seeds, but does not check live timeline IDs.

Follow-up: reject new ambiguous imports against retained timeline activity, or
design an explicit ownership-aware compatibility scheme for those legacy IDs.
Changing saved reaction, purchase, checkpoint and message-origin keys requires a
coordinated migration; existing Storybook seed IDs were not rewritten here.

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

The original branch passed the complete non-UI test suite, build and lint.
The corrected state also passed `npm run --silent test`, `npm run build`,
`npm run lint` and `git diff --check`.

No application, Electron window, browser, UI test or E2E test was launched.
Interactive validation remains with the user, particularly disabled-account
setup, MatchMe filtering, gallery retention and the documented promotion/save
round trip. Packaging configuration was inspected; no packaged application was
launched. Passing automated checks does not resolve the open findings above.
