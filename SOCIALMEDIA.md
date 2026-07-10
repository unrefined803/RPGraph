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
| Turn Mode (Output Actions) | `1` | `2` |

Message Format `2` (Output Actions) + Turn Mode `0` is Banking; Turn Modes `1`
and `2` are reserved for Fotogram and OnlyFriends.

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
- Posting with images: reuse the WhatsUp image menu (Camera assistant /
  Choose from Phone Gallery / Upload from Computer). ✅
- OnlyFriends variant: locked posts with an unlock/pay interaction (visual only). ✅
- No LLM, no persistence beyond basic session state; goal is that clicking
  through both apps feels right and both provably share the same components.
  Post/account state is still local to the opened screen; the shared post
  store comes with Phase 2.

### Phase 2 — LLM content generation

- While the user plays inside the app, the LLM generates content in the
  background: post captions, comments, replies to DMs, reactions to the user's
  own posts.
- Interactions and generated content are stored per account in the session.

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

- OnlyFriends creator role: what changes in the UI for a creator
  (posting & earning vs. paying & unlocking)?
- Should unlocking OnlyFriends posts spend Banking money (shared wallet)?
- How many dummy accounts/posts per session, and are they persisted or
  regenerated?
- Exact JSON shape of the Output Actions summary entries (Phase 3).
- Opening History integration details for account state (later phase).
