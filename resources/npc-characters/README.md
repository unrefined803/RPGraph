# Built-in NPC Characters

Place validated, plain Character Container V2 JSON files directly in this
directory. Electron packages this directory as the read-only built-in NPC tier.
Encrypted containers and nested directories are intentionally not discovered.
Legacy demo accounts are bundled only when backed by a real image file;
image-less social-catalog and MatchMe placeholders are intentionally absent.

Inspect image-backed characters with `npm run character:inspect` and revise them
with `npm run character:edit`. This keeps embedded image bytes out of the edit
specification and preserves untouched media exactly; do not hand-edit base64
payloads.

## Authored roster

The 20 bundled NPCs have one or two agency tags with explicit per-app assignments.
They provide 20 WhatsUp, 20 Fotogram, nine MatchMe and 10 OnlyFriends accounts.
Fotogram has 18 users and two creators; OnlyFriends has nine users and one creator.
All OnlyFriends profiles use pseudonyms with real-name display disabled.
MatchMe profiles use character names and explicit gender/seeking selections;
historical nicknames remain routing aliases only.

See [the phase 2 roster](../../docs/architecture/npc-agency-tags.md#2-enrich-the-existing-20-npcs--implemented)
for assignments and account details. Library reload exposes revised built-ins;
existing user overrides and pinned RP copies keep their own authored revisions.
