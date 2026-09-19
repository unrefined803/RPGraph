# NPC Population and Agency Coverage Report

Source: resources/npc-characters. Generated from validated containers and the executable agency catalog.

Scope: bundled authoring inventory only; saved revisions, user-library overrides and Storybook characters are excluded. No containers were modified. Delete this generated file after review; rerun `npm run npc:report` to recreate it.

Targets: `docs/architecture/npc-agency-tags.md`; executable target values: `scripts/report-npc-population.mjs`. Every catalog tag should occur on at least one character. Counts below use enabled accounts only; missing social roles mean user.

## At a glance

| Measure | Current | Target / remaining |
| --- | --- | --- |
| Characters | 33 | 50 / 17 still needed; 0 above target |
| Distinct character tags | 41 | 50 / 9 missing |
| Tags assigned to enabled apps | 41 | 50 / 9 not active |
| Unclassified characters | 0 | 0 unclassified |
| Repeated tags | 11 | Review before reusing; no maximum per tag is specified |
| Ordinary-user social accounts | 38 / 47 (80.9%) | 80–90% users; 10–20% creators |

## Enabled account targets

| App | Final target | Existing | Still needed | Above target |
| --- | --- | --- | --- | --- |
| WhatsUp | 50 / 50 | 33 | 17 | 0 |
| Fotogram | 35 / 50 | 33 | 2 | 0 |
| MatchMe | 15 / 50 | 27 | 0 | 12 |
| OnlyFriends | 25 / 50 | 14 | 11 | 0 |

Accounts overlap across people. Preserve existing accounts. Explicitly disable Fotogram on new characters that should not have it; creation otherwise provisions standard accounts. MatchMe additions require suitable identity-specific images and valid photo references; this report does not establish image suitability or future media availability.

## Social account roles

| App | Users | Creators | User share | Example final users / creators | Needed for example U / C | Above example U / C |
| --- | --- | --- | --- | --- | --- | --- |
| Fotogram | 28 | 5 | 84.8% | 30 / 5 | 2 / 0 | 0 / 0 |
| OnlyFriends | 10 | 4 | 71.4% | 22 / 3 | 12 / 0 | 0 / 1 |

The 30/5 Fotogram and 22/3 OnlyFriends splits are planning examples, not mandatory quotas. At the final account totals, 80–90% users allows 4–7 Fotogram creators and 3–5 OnlyFriends creators. Unique people with a creator account: 6; with both user and creator social roles: 1.

## Complete tag coverage

Character counts count each person once. App columns count explicit assignments on enabled accounts. Prioritize tags with zero characters when authoring new characters. A tag need not appear on every compatible app; zero in an app column is not an additional quota.

| Tag | Characters | WhatsUp | Fotogram | MatchMe | OnlyFriends |
| --- | --- | --- | --- | --- | --- |
| casual_chatter | 2 | 2 | 2 | 2 | 0 |
| shy_user | 1 | 1 | 0 | 1 | 0 |
| slow_to_trust | 1 | 1 | 0 | 1 | 0 |
| friendly_regular | 3 | 1 | 1 | 3 | 1 |
| hobby_friend | 1 | 1 | 1 | 1 | 1 |
| respectful_admirer | 2 | 2 | 2 | 0 | 2 |
| good_listener | 2 | 2 | 1 | 1 | 0 |
| loyal_friend | 1 | 1 | 1 | 1 | 0 |
| social_lurker | 2 | 0 | 2 | 0 | 0 |
| quick_replier | 1 | 1 | 1 | 1 | 0 |
| sporadic_texter | 1 | 1 | 1 | 1 | 0 |
| friendship_seeker | 1 | 1 | 1 | 1 | 0 |
| commitment_seeker | 1 | 1 | 0 | 1 | 0 |
| casual_dater | 1 | 1 | 0 | 1 | 0 |
| mixed_signals | 1 | 1 | 1 | 1 | 0 |
| boundary_setter | 2 | 2 | 2 | 2 | 1 |
| fan_engager | 2 | 2 | 2 | 0 | 1 |
| collab_seeker | 1 | 1 | 1 | 0 | 1 |
| passive_aggressive | 0 | 0 | 0 | 0 | 0 |
| guilt_tripper | 0 | 0 | 0 | 0 | 0 |
| genuine_user | 2 | 2 | 2 | 2 | 2 |
| attention_seeker | 1 | 1 | 1 | 1 | 0 |
| move_to_private | 2 | 2 | 2 | 0 | 1 |
| freebie_hunter | 0 | 0 | 0 | 0 | 0 |
| jealous_attachment | 0 | 0 | 0 | 0 | 0 |
| upseller | 1 | 1 | 1 | 0 | 1 |
| gift_fisher | 1 | 1 | 1 | 1 | 0 |
| parasocial_fan | 0 | 0 | 0 | 0 | 0 |
| clout_chaser | 1 | 1 | 1 | 0 | 1 |
| screenshot_drama | 1 | 1 | 1 | 0 | 0 |
| love_bomber | 1 | 1 | 1 | 1 | 0 |
| breadcrumbing | 0 | 0 | 0 | 0 | 0 |
| catfish | 1 | 1 | 1 | 1 | 0 |
| boundary_tester | 2 | 2 | 2 | 2 | 0 |
| promo_spammer | 1 | 1 | 1 | 0 | 1 |
| exclusive_teaser | 1 | 1 | 1 | 0 | 0 |
| rebound_seeker | 1 | 1 | 1 | 1 | 0 |
| loyal_supporter | 2 | 2 | 2 | 2 | 2 |
| status_flexer | 1 | 1 | 1 | 0 | 1 |
| fake_emergency | 1 | 1 | 1 | 1 | 0 |
| ghosting_pattern | 1 | 1 | 1 | 0 | 0 |
| validation_fisher | 0 | 0 | 0 | 0 | 0 |
| oversharer | 1 | 1 | 1 | 1 | 1 |
| drama_magnet | 1 | 1 | 1 | 1 | 0 |
| money_borrower | 1 | 1 | 1 | 1 | 0 |
| possessive_friend | 0 | 0 | 0 | 0 | 0 |
| emotional_supporter | 1 | 1 | 1 | 1 | 0 |
| flirty_networker | 1 | 1 | 1 | 1 | 0 |
| ex_obsessed | 0 | 0 | 0 | 0 | 0 |
| rumor_spreader | 1 | 1 | 1 | 0 | 0 |

## Validation and planning issues

No inventory conflicts or capacity issues detected. All source containers passed shared validation.
