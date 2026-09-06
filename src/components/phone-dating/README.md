# MatchMe integration notes

The phone UI currently uses local demo profiles and reciprocal likes. Alex and
Robin are the reciprocal demo matches. Replies are explicitly labeled fixtures.
No provider calls or messages to real accounts are made.

`PhoneDatingScreen` owns navigation, profile editing and per-match drafts.
`MatchMeConversation` renders a conversation and reports send actions through
callbacks; it does not call the demo reply generator or any LLM itself.
`datingMessages.ts` defines message records and isolates the demo reply fixture.

Profiles and conversations persist through `onSaveDatingProfile` in the
Storybook social record. The existing `plotTwist` storage field and `plottwist`
phone layout key remain unchanged to preserve earlier saved data. Photos refer
to gallery IDs, with at most three references. Changing the main photo only
reorders those references.

For the provider integration, replace the demo exchange at the screen's send
callback with the common app-message service. Persist the outgoing message first,
then append a validated reply to its original owner and match ID. Add pending,
retry and unread state for asynchronous delivery. Keep conversation IDs scoped to
app, owner and partner, so switching apps or characters never redirects replies.
Reuse provider transport and message validation across social apps while keeping
their conversation histories separate. Replace demo identities and reciprocal
likes with stable directory IDs and actual match events before enabling replies.

Manual UI checks: create/edit a profile, change gender and override preferences,
select three album/upload photos and change the main photo, swipe or use buttons,
open both demo matches, send text and emoji, switch conversations with unsent
drafts, close/reopen the app, and check compact layouts and keyboard focus.
