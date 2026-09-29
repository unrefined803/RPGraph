# Character colors

## Stable slots

`useCharacterColors` owns a session-local `CharacterColorSlots` record keyed by canonical `StorybookCharacter.sourceId`. Initial playable characters reserve slots in Storybook order. Only NPCs returned by `interactedNpcIds` reserve slots next. The roleplay runtime and NPC Library share this exact classification from the canonical message timeline, including loaded messages and Opening History. A playable character and the NPC must each have sent a private message to the other in the same messenger (WhatsUp, Fotogram, OnlyFriends or MatchMe). Comments, reactions, prose mentions, shared accounts, likes, superlikes, matches, one-way messages and NPC-only exchanges do not qualify. Rendering or opening the catalog never reserves slots. Inactive NPCs receive no color, even if an older save contains a previously reserved slot.

Slots are never reassigned when characters are sorted, renamed, promoted, demoted or removed. A new character receives the next unused slot. `runtime.current.characterColorSlots` persists the record in RP Saves. Older saves initialize the record from their playable characters and interacted participants. Starting a new RP resets it. Undo does not recycle slots. Standalone character and Storybook files do not carry RP-specific slot assignments.

`reciprocalMessageContacts` resolves both directions through canonical accounts and
legacy aliases. The contact system and interaction classification use the same
pairing logic; shared-account contact grants do not establish interaction.
Removing the only reply through undo retracts the status and color. Saved color
slots and retained NPC snapshots alone do not confer Interacted status.
`characterUsageReasons` remains a separate broad reference check for safe removal.

Color maps and CSS token dictionaries retain their references when their contents
are unchanged, even if equivalent character or activity arrays are recreated.
Actual renames, role changes, slot changes and removals still update the colors.

## Paired palette

`characterColorPalette` has twenty pairs. The first ten playable colors retain the original palette exactly. The second ten extend it with shifted vivid colors. NPC variants shift the hue again and reduce saturation while retaining a clearly visible pastel tint. Both roles use the same slot; promotion changes only the variant and enables the existing gradients. After twenty slots, the pairs repeat.

| Slot | Playable | NPC |
| --- | --- | --- |
| 1 | `#d59645` | `#dbcd9f` |
| 2 | `#3fa8c5` | `#9fc3db` |
| 3 | `#c75c9a` | `#db9fb6` |
| 4 | `#5fae68` | `#9fdbb3` |
| 5 | `#8a73c9` | `#bd9fdb` |
| 6 | `#c65f5f` | `#dbac9f` |
| 7 | `#c7af45` | `#dbdb9f` |
| 8 | `#3aa091` | `#9fd7db` |
| 9 | `#7eb9c5` | `#9fc7db` |
| 10 | `#ad6ec5` | `#d79fdb` |
| 11 | `#d3c35e` | `#d9dcad` |
| 12 | `#578cc4` | `#adb9dc` |
| 13 | `#c8728a` | `#dcadb0` |
| 14 | `#72b28c` | `#addcc9` |
| 15 | `#ad86cb` | `#cfaddc` |
| 16 | `#c78d75` | `#dcc3ad` |
| 17 | `#bac65d` | `#ccdcad` |
| 18 | `#469cab` | `#adc9dc` |
| 19 | `#8baac6` | `#adbddc` |
| 20 | `#c882c6` | `#dcadcf` |

## Rendering

`characterColors` maps canonical names to CSS color tokens encoding source identity and effective role. The studio root supplies the token values. `CharacterName` and `CharacterAvatar` render the assigned colors and omit gradients for NPC tokens. Existing app-account resolution determines which canonical character owns a profile name. Current character colors take precedence over historical message colors, so promotion updates old messages too.

Speaker analysis receives the effective app character registry, including interactive NPCs. Their attributed dialogue uses the same muted color with no dialogue gradient. Neutral narration and message-bubble wave settings remain independent of character identity.

All name, avatar and text gradients are static. A deterministic content hash supplies a small phase offset so highlights vary without changing on rerenders. Names and avatar rings use the character name; message and narration text use their displayed content. The phase stays on the darker rising portion of the wave rather than at either peak.
