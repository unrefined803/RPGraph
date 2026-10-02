# NPC authoring handoff

## Current working state

All 50 NPCs are packed and installed in `resources/npc-characters` after the
consistency review (see "Third batch" below). The unpacked workspace remains the
editing source; repack with the inspect/edit procedure described there.

The local workspace is `user_data/npc-authoring/` in this checkout. It is ignored
by Git, persists across a chat reset on this machine, and is not included in a
clone or commit. Preserve it when cleaning local files.

- `existing/`: all 42 original NPCs, each with a blob-free `character.json` and
  extracted images. The six revised NPC specifications contain the latest edits.
- `existing/.originals/` and `existing/manifest.json`: original container backups
  and the unpack tool's manifest. Keep these intact.
- `new-characters/`: eight new plain creation specifications, each named
  `character.json`, with one local `images/P-portrait.png`. These are not edit
  specifications and are not entries in the existing-character pack manifest.
- `image-prompts.json`: the final prompts used with the built-in image generator;
  the tracked copy is [parent-npc-image-prompts.json](parent-npc-image-prompts.json).

All four generated images are 1086 x 1448 pixels, exactly 3:4 portrait. Each new
specification has a manually selected face crop for the circular avatar. The
full image remains intact. No new parent container has been published under
`resources/npc-characters`.

## Authored characters and connections

| New NPC | Age | Family | Additional connection |
| --- | --- | --- | --- |
| Helen Sterling | 52 | Zoe Sterling's mother | Supervises Sienna Ray's occasional theatre shifts |
| Daniel Park | 56 | Mina Park's father | Friends with Graham through the repair cafe |
| Marisol Reyes | 49 | Nova Reyes's mother | Commissions Graham for housing association repairs |
| Graham Harlow | 60 | Kit Harlow's father | Garden friend of Eden Moss; repair-cafe friend of Daniel |

All eight relationships are authored in both directions with WhatsUp contacts.
The four family pairs and Graham/Eden also follow each other on Fotogram.
Professional contacts do not imply access to private accounts or family secrets.

Each new parent has one portrait, WhatsUp and a browsing Fotogram account, no
initial posts and no MatchMe account. Both men also have a private OnlyFriends
browsing account, with no posts. Their OnlyFriends accounts are not linked to
relatives or colleagues. These choices apply to the new parents; existing NPC
accounts and publications are preserved.

## Already applied to bundled NPC files

Before the request to leave everything unpacked, six existing containers were
revised: `zoe-sterling`, `mina-park`, `nova-reyes`, `kit-harlow`, `sienna-ray` and
`eden-moss`. Each has an added background sentence and a reciprocal relationship.
The creator also removed obsolete per-account `agencyTags` and `accountRole`
fields during normal serialization. All image bytes, portrait crops, current
account data, publications and other characterization were verified unchanged.

Their new relationships point to the pending parents, so the bundled set is an
intermediate authoring state, not a completed content release. Do not publish
these changes without eventually including the parent containers.

No Storybook character or Storybook file was modified. Some NPCs also occur in
the bundled Storybooks and must remain excluded from edits: `marc_vance`,
`mira_chen`, `adrian_cole`, `avery_hart`, `chloe_bella_vance`, `chloe_lane`,
`camila_vega` and `lena_ford`. Recheck Storybook membership if the content changes.

## Next phase

The second batch is complete. The user plans a separate AI consistency review before any packing.
Aim for at least one, preferably two or three, meaningful connections per NPC,
while continuing to leave Storybook characters untouched. This is a future
authoring target, not a claim that the current library already meets it.
Mix family, employment and friendship sparingly. Use stable IDs, describe each
side of the relationship and update both characters' background where needed.
Do not infer kinship from a shared surname alone.

When packing is explicitly requested, create the new characters from their
plain specifications with `character:create`. Revise existing characters with
the inspect/edit tools, preserving original media. The workspace pack command
only covers its manifest entries and applies filename-based app assignments;
review that behavior before using it for the whole library. Check new parent
portrait crops and all relationship targets after eventual container creation.

The first creation attempt was interrupted before writing a container. It had
produced no diagnostics; do not assume the conversion/detection pipeline was
validated. Manual crops are now present in the new specifications.

Completed checks: creator, relationship and Electron NPC-library unit tests
passed; existing media and account preservation was checked structurally.
No application, browser or UI tests were launched.


## Second batch: ages 37–45

This batch changes only unpacked specifications and documentation. All packed
resource JSON files were verified byte-for-byte unchanged during this phase.
There are now 50 draft characters: 42 existing NPCs plus eight new NPCs.

| New NPC | Age | Connections | Optional accounts |
| --- | --- | --- | --- |
| Celine Dubois | 43 | Clara's mother; Sasha Vale's bookshop employer | MatchMe |
| Victor Reed | 41 | Owen's older brother and manager; Tyler Briggs's parts contact | OnlyFriends, MatchMe |
| Rafael Vance | 39 | Tariq's older brother; Max Power's jam-session friend | OnlyFriends |
| Priya Shah | 37 | Nika Brooks's studio owner and mentor; Maya Brooks's friend | None |

All four have WhatsUp and Fotogram, one 1086 x 1448 portrait and no starting
publications. MatchMe reuses that same portrait. Both men's OnlyFriends accounts
are private browsing accounts with no posts and no authored family/work follows.
Celine and Victor are divorced and open to dating; Rafael and Priya are partnered.
Celine had Clara at 24. No kinship is inferred between other shared surnames.

Eight reciprocal relationship pairs were added. Eight previously unconnected
existing NPCs received a background sentence and a reciprocal relationship:
`clara-dubois`, `sasha-vale`, `owen-reed`, `tyler-briggs`, `tariq-Vance`,
`max-power`, `nika-brooks`, and `maya-brooks`. Their other fields, accounts and
media were verified unchanged. Original unpacked specifications from before
this batch are in `user_data/npc-authoring/review-backups/batch-two/`.

Final built-in image generation prompts and image paths are recorded locally in
`user_data/npc-authoring/batch-two-image-prompts.json`. Images reside inside each
new character's `images/` folder. The two dating portraits use the filename
`M-P-portrait.png`; the others use `P-portrait.png`. These folders remain outside
the existing-character pack manifest. No new NPC was packed or installed.

Validation covered exact portrait aspect ratios, crop bounds, reciprocal
connections, enabled account targets, dating-photo references, no initial posts,
and preservation of all packed resources. A full narrative consistency review
and eventual container creation remain for the next phase. Many unrelated NPCs
still have no relationships; the library-wide connection target is unfinished.


## Third batch: consistency review and packing

A narrative review of all 50 cards fixed these issues in the unpacked specs:

- Clara and Celine no longer follow each other on Fotogram. Clara's public,
  real-name feed advertises compensated dates, so a follow contradicted Celine
  not knowing. Celine's card no longer names Clara's secret.
- Priya no longer presupposes Nika's private OnlyFriends account; Graham's card
  no longer implies that he knows a friend's private account.
- Kit moved across the city, not to another town, so Graham's local friends and
  their walks remain plausible. Graham's allotment is the community garden.
- Helen consistently "manages" the community theatre. Celine grew up in Lyon,
  explaining Clara's French charm. Daniel (married), Graham (divorced) and
  Marisol (single parent) now state their relationship status.
- Mina's pseudonymous OnlyFriends bio no longer mirrors her MatchMe bio.
- Grammar fixes for Nika and Noah Blake.

Maya and Nika Brooks are now sisters; Maya introduced Nika to Priya's studio.
Twenty further reciprocal pairs give every non-Storybook NPC at least one
connection: Clara–Sasha, Kit–Luna, Eden–Jordan, Ari–Mina, Ari–Ivy,
Mira Thorne–Maya Brooks, Mira Thorne–Nova, Mira Thorne–Elena, Zoe–Maya Quinn,
Eli–Nia, Dante–Marcus, Dante–Valeria, Dante–Kira, Marcus–Julian, Kira–Amber,
Luca–Tyler, Noah Voss–Simon, Noah Voss–Felix, Noah Blake–Marisol and
Tariq–Max. Pseudonymous Fotogram accounts (Tyler, Simon, Felix, Max) receive
WhatsUp-only connections. Each new tie adds one background sentence per side.
Pre-edit specifications are in `user_data/npc-authoring/review-backups/batch-three/`.

Packing used `character:inspect` / `character:edit` on the bundled containers,
copying only text fields, relationships and changed bios. The workspace
`character:pack` command was not used for installation because its
filename-based assignment would replace avatars (for example Nia's Fotogram
avatar) and add avatars to disabled accounts. Images were verified unchanged;
obsolete per-account `agencyTags`/`accountRole` were dropped by serialization.
The eight new NPCs were created with `character:create` using their manual
crops. Storybook characters were not modified; `marc_vance` still points to the
Storybook-only `sarah_carter`.
