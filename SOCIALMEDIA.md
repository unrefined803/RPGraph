# Social Media Apps — Plan

Two new phone apps that share one common code base: **Fotogram** (Instagram-style,
public posts) and **OnlyFriends** (OnlyFans parody, posts must be unlocked/purchased).
This document is the working plan; we refine it before and while implementing.

## Goals

- Both apps are structurally the same app ("social feed"). An improvement to a
  shared feature (likes, comments, posting, feed rendering) automatically applies
  to both. Only branding (colors, name, icon) and a few behavior flags differ.
- Like the Banking app, the apps are simulated in the background during roleplay.
  Most feed content is dummy posts (placeholder images that look "not loaded").
- The only interface to the outside world: when the user closes the app, the LLM
  summarizes what happened, and that summary is sent to the chat history as an
  info box (same pattern as bank transfers: "X sent Y money").

## App identities

| | Fotogram | OnlyFriends |
|---|---|---|
| Real-world model | Instagram | OnlyFans |
| Post visibility | All posts public | Posts locked, unlock by paying |
| User role | Always a regular user | Creator **or** paying viewer (to be detailed) |
| Color scheme | Instagram-like purple/orange gradient | OnlyFans-like blue/white |
| Routing | Message Format `3`, shared | Message Format `3`, shared |

Routing update: social media now has its own **Message Format `3`** ("Social
Media" output channel on the LLM Prompt Switch, wired to the RP Output "Social
Media" input). Both apps share the channel; each action type gets its own Turn
Mode / prompt slot (currently `0` = Post). Message Format `2` + Turn Mode `0`
stays Banking. The close-app summary (Phase 3) will also use these routes.

## Shared structure

- New shared module, e.g. `src/components/phone-social/` with a common
  `PhoneSocialFeedScreen` used by both apps.
- Each app is a small config object passed to the shared screen:
  - `appId` (`fotogram` / `onlyfriends`), display name, icon, theme colors
  - behavior flags: `postsRequireUnlock`, `allowCreatorRole`, …
- Shared building blocks (one implementation, used by both):
  - feed list, post card (image, caption, likes, comments)
  - like / comment / post-your-own-image interactions
  - dummy-post generation (placeholder images, "not loaded" look)
  - direct messages inside the app (writing to other accounts)
- Per-character accounts: every character (and the player) has their own account
  and their own activity state (posts, likes, comments, DMs). Accounts never mix;
  switching the viewed character switches the account, like the Phone tab does.

## Shared platform (vision)

- Both apps sit on one shared platform simulation. Posts live in a common
  post store ("shared database"): if character A posts something and the
  player switches to character B and opens the app on B's phone, B sees A's
  post too.
- All characters that share phones also share the social platform: the phone
  contacts double as the followed accounts in the left side panel. Additional
  people can be added manually ("Add Person").
- Accounts are discoverable across both apps — a character can also be found
  on OnlyFriends, enabling roleplay intrigue (finding, unlocking, liking
  someone's account).
- What flows outward is always attributed to the acting person: when an app
  is closed, the summary describes who did what (who posted, who liked whose
  post, who unlocked what). That requires tracking interactions per account —
  built in a later phase, after the UI basics.

## Phases

### Phase 1 — UI only (current)

- Add both app icons to the phone desktop (`PhonePanel.tsx` app grid, alongside
  `whatsup`, `gallery`, `camera`, `banking`). ✅
- Build the shared feed screen with static dummy content: scrollable feed,
  placeholder-image posts, like/comment UI, "create post" UI. ✅
- WhatsUp-style two-column layout: left side panel with the followed accounts
  (phone contacts + manually added people, "Add Person", "New Post"), feed on
  the right; clicking an account shows that account's posts. ✅
- Posting flow (same in all social apps): "New Post" first asks for the image
  source — Camera assistant / Choose from Phone Gallery / Upload from Computer /
  Text Post — then the editor shows the picked image on top with the caption
  below. ✅
- OnlyFriends variant: locked posts with an unlock/pay interaction. ✅
- Unlocking is a real purchase (first backend link-up): "Unlock" opens a
  "Pay with Bank Account" confirmation showing the price and the owner's
  current balance; paying sends a normal bank transfer from the owner to the
  post's author (visible in the Banking app, lowers the balance; blocked when
  the balance is too low). ✅
- No LLM, no persistence beyond basic session state; goal is that clicking
  through both apps feels right and both provably share the same components.
  Post/account state is still local to the opened screen; the shared post
  store comes with Phase 2.

### Phase 2 — LLM content generation (started)

Every action in a social app is its own workflow turn. The new **Message
Format 3 = Social Media** routes these turns; each action type gets its own
prompt slot on the "Social Media" output channel of the LLM Prompt Switch,
which is wired to the new **Social Media** input of RP Output.

- Posting runs the workflow; the post is recorded in the chat history
  (`[Fotogram] Name (@handle) posted: "…"`) and the LLM returns JSON reactions
  (likes + comments), which appear on the post. ✅
- Photo posts pass the image to the run (vision models can see it) and include
  the stored gallery image description in the input block, so reactions can
  refer to what the photo actually shows. The input labels separate the
  user-written "Post text" from the "Image description". ✅
- The history line uses the English (translated) post text so the internal
  English pipeline stays consistent; the app keeps showing the caption as
  typed. ✅
- Per-app prompt slots on the Social Media channel: **Turn Mode 0 = Fotogram
  Post**, **Turn Mode 1 = OnlyFriends Post**. Fotogram reactions: 0–2 comments
  from real story characters (dynamic, never the author) plus 2–3 invented NPC
  friends. OnlyFriends reactions: 2–5 comments from invented fans only (the
  platform is private; story characters never appear). ✅
- Only story-character comments are written to the chat history; invented NPC
  comments stay in the app (they are unimportant background noise). ✅
- Posts and reactions are persisted on chat messages (`socialPost` /
  `socialReactions` records), so they are part of the RP save and reload with
  the session. ✅
- Accounts live in the Storybook (`characters[].social.fotogramUsername` and
  `.onlyfriendsUsername`, storybook format 1.18.0). A stored username skips
  the app's onboarding; creating an account in either app writes the username
  back into the Storybook. Fotogram accounts are expected for every character
  (the assistant always sets one); OnlyFriends accounts stay empty unless
  created. The bundled default workflow (v7) gives all four characters
  Fotogram usernames. ✅
- OnlyFriends sidebar starts empty (no story-character contacts) because the
  platform is private; accounts can only be added manually. ✅
- Planned next: more prompt slots (comment on an existing post, like activity,
  "Load More" dummy-feed generation, DM replies).

### Phase 3 — Workflow integration

- On app close, the LLM summarizes the session inside the app ("was on Fotogram,
  posted X, liked Y, wrote to Z…").
- The summary is emitted via Output Actions → RP Output into the chat history as
  an info box, so the narrator LLM knows what happened (same as bank transfers).
- Route via Message Format `2` with Turn Mode `1` / `2` as listed above.

## Accounts and Storybook

- Whether a character has an account is written in RP Storybook. If the
  Storybook says nothing about an account, the character has none.
- Creating an account is deliberately simple: a "Create account" step where the
  user picks a nickname — same flow in both apps.
- For OnlyFriends, the Storybook entry also records the role: regular user or
  creator.
- Later (not now): account state should also flow into the Opening History,
  like chat, phone messages, and bank transfers already do, so a pre-played
  session carries the accounts along. For the basics only "has account or not"
  matters; the rest is worked out later.

## Open questions

- Storybook "Import Current Chat" / opening history does not yet carry social
  media activity (posts, reactions, account changes) into the storybook; needs
  its own import block like chat, phone, and bank transfers.
- No UI yet for editing `social.fotogramUsername` in the storybook creator
  dialog; currently only the storybook assistant and JSON editing can set it.

- OnlyFriends creator role: what changes in the UI for a creator
  (posting & earning vs. paying & unlocking)?
- ~~Should unlocking OnlyFriends posts spend Banking money (shared wallet)?~~
  Answered: yes — unlocks pay via the Banking pipeline (implemented in Phase 1).
- How many dummy accounts/posts per session, and are they persisted or
  regenerated?
- Exact JSON shape of the Output Actions summary entries (Phase 3).
- Opening History integration details for account state (later phase).
