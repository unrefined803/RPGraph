# UI Design

Visual language of RPGraph Studio. Big Screen mode is the reference; dialogs
are restyled to match it one at a time. All styles live in `src/styles.css`.

## Principles

- Deep navy surfaces instead of grey panels. Depth comes from gradients and a
  soft blue glow, not from heavy borders.
- Hairline borders: translucent white or blue-grey, never solid mid-grey.
- Flat controls at rest. Colour appears on hover, selection and for the one
  primary action.
- Blue marks the active or selected state. Purple is the brand accent and is
  used sparingly. Green, amber and red carry meaning only.
- Colours are translucent tints over the navy surface, not opaque fills.

## Palette

| Role | Value |
| --- | --- |
| Window gradient | `linear-gradient(180deg, #111a2a, #0c1320)` |
| Top glow on windows | `radial-gradient(ellipse 80% 60% at 50% 0%, rgba(52, 82, 140, 0.16), transparent 75%)` |
| Window border | `rgba(130, 160, 220, 0.12)` |
| Outer glow | `0 0 140px rgba(60, 100, 180, 0.14)` |
| Backdrop behind dialogs | `rgba(2, 3, 6, 0.74)` with `blur(6px)` |
| Divider / hairline | `rgba(148, 163, 184, 0.08)` |
| Recessed area (footer, sidebar, inputs) | `rgba(2, 3, 6, 0.22)` to `rgba(2, 3, 6, 0.3)` |
| Card at rest | background `rgba(148, 170, 214, 0.035)`, border `rgba(148, 163, 184, 0.09)` |
| Card hover | background `rgba(148, 170, 214, 0.07)`, border `rgba(148, 163, 184, 0.16)` |
| Blue accent | `#7aa2e8` |
| Active gradient | `linear-gradient(180deg, #34476a, #233150)`, border `rgba(122, 162, 232, 0.45)` |
| Brand purple | `var(--accent)` `#8a73c9`, light `#b29ce3` |
| Success green | `#56d99a`, text `#9fdcbc` |
| Amber | `#e0a96a` |
| Danger red | `#e87070`, text `#efb5b5` |

Text colours, brightest to quietest:

| Role | Value |
| --- | --- |
| Titles, active text | `var(--soft-white)` |
| Primary text | `#dbe3f2` |
| Control text | `#b7c4da` |
| Secondary text | `#8292ae`, `#8d9bb5` |
| Meta text | `#66738c` |
| Section labels | `#536079` |

## Components

**Window.** Radius 16-18px, window gradient with top glow, window border, outer
glow. Header and footer are separated by hairlines; the footer sits on a
recessed area.

**Section label.** Uppercase, 11px, weight 750, letter-spacing `0.1em`,
colour `#536079`.

**Button, default.** Border `rgba(255, 255, 255, 0.08)`, background
`rgba(255, 255, 255, 0.04)`, text `#b7c4da`, radius 10px, no shadow. Hover:
border `rgba(122, 162, 232, 0.45)`, background `rgba(122, 162, 232, 0.12)`,
text `var(--soft-white)`.

**Button, primary.** One per window. Active gradient, blue border, inset top
highlight `inset 0 1px 0 rgba(255, 255, 255, 0.13)` and glow
`0 0 16px rgba(92, 132, 214, 0.3)`. The Turn Trace copy button uses the same
raised construction in translucent purple.

**Button, positive (Open, Playable).** Border `rgba(86, 217, 154, 0.26)`,
background `rgba(86, 217, 154, 0.07)`, text `#9fdcbc`. Hover: border `#56d99a`,
background `rgba(86, 217, 154, 0.15)`, soft green glow.

**Button, destructive.** Faint translucent red, never a solid fill: border
`rgba(232, 112, 112, 0.3)`, background
`linear-gradient(180deg, rgba(232, 112, 112, 0.16), rgba(232, 112, 112, 0.06))`,
text `#efb5b5`, inset top highlight. Hover raises the tint and adds a small
red glow.

**List row / card.** Card at rest and card hover from the palette, radius 12px.
Selected: active gradient at 60% opacity, blue border, `inset 3px 0 0 #7aa2e8`
bar on the left and a soft blue glow.

**Type badge.** Pill, no border, tinted text on a 12-14% tint of the same hue:
workflow purple, Storybook blue, RP Save amber, character pink, in-Storybook
green.

**Input.** Background `rgba(2, 3, 6, 0.3)`, border `rgba(255, 255, 255, 0.08)`,
radius 10px. Focus: border `rgba(122, 162, 232, 0.45)`, no outline ring.

**Dropdown (`NodeCustomSelect`).** Shared by every dialog and node. Popover:
navy `rgba(12, 18, 30, 0.97)`, border `rgba(130, 160, 220, 0.22)`, radius 10px.
Option hover `rgba(148, 170, 214, 0.1)`; selected option uses the active
gradient.

**Checkbox / radio.** `accent-color: #7aa2e8`. A checked option card takes the
selected card look.

**Slider.** Track `rgba(148, 170, 214, 0.16)`, 6px high. Thumb: blue gradient
`linear-gradient(180deg, #8fb4f0, #5f86d0)` with a light border, inset top
highlight and a blue glow that strengthens on hover.

**Scrollbar.** Thumb `#222c3f` on a transparent track; hover `#33405a`.

**Transitions.** `0.18s ease` on colour, background, border and shadow. No
movement on hover.

## Implementation

- `.deep-dialog` is the shared skin. Add it to a dialog `section` to apply the
  window, header, buttons, rows, badges, inputs and footer described above.
  Start, Files, Save/Unlock, character save and the delete and provider-type
  confirmations use it.
- Dialogs with their own class tree carry the palette in their own rules:
  NPC Library (`.npc-library-dialog`), System Log, Debug Snapshot and its
  viewer, the Turn Trace window frame, Providers (`.connection-dialog`) and
  Options (`.options-dialog`).
- Base rules stay in place for dialogs not yet restyled; skin rules override
  them by specificity. When restyling a dialog, check hover, selected and
  disabled states as well as the resting state.
- Turn Trace content and node internals on the graph keep their own styling.
