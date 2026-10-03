# ChatGPT provider

## Connections and account profiles

The `chatgpt` LLM provider uses Sign in with ChatGPT and eligible ChatGPT plan
usage. A `ConnectionPreset` stores a `chatgptProfileId`, model slug and label.
Multiple presets reference one reusable profile and can select different models
for different nodes. Creating a new ChatGPT preset selects the workspace's last
used profile without starting another OAuth flow. Removing a preset or changing
its provider type does not sign out its profile. A preset whose profile no longer
exists after sign-out adopts the workspace's current profile and keeps its model.

`useChatGPTProviderSettings` supplies the account and authentication fields for
the shared provider form. Preset name, model, capabilities and reasoning keep
the same placement as other LLM providers; the email replaces Base URL and
authentication replaces API Key. The form displays the signed-in email, browser sign-in,
explicit sign-out, a persistent account information box and Manage usage. The workspace
uses one active account registration; changing accounts requires signing out
first. Explicit sign-out removes the local profile, credentials, identity and
workspace-bound client registration. The next sign-in starts dynamic registration
so another ChatGPT account can connect; the installation host ID stays stable. Account selection and adding additional accounts are not
exposed. Model selection displays the account catalog's `display_name` and
stores its `slug`. Only catalog entries with `visibility: "list"` are offered.
The integration supports text and image input with fixed text, vision and
thinking capabilities. Thinking levels come from the selected model's catalog
entry (`supported_reasoning_levels`, `default_reasoning_level`), including Off
when the model reports `none`; levels RPGraph does not know are not offered. A
model without reported levels offers Low (default), Medium and High. The selected
level is sent as `reasoning.effort` in Responses requests. A saved level the
model does not support normalizes to the model default, otherwise Low. Image and
voice generation are not supported.
Generic API key, endpoint and sampling controls are hidden for this provider.

## OAuth and storage

`electron/chatgptAuth.cjs` manages OAuth entirely in the main process. Each sign-in
uses a temporary `127.0.0.1` listener at `/auth/callback`, random state and nonce,
and S256 PKCE. Initial registration uses `dynamic_agent_client`; the issued
client ID is saved before code exchange and reused for returning sign-ins.
OpenID discovery supplies the JWKS and revocation endpoint; authentication
endpoints must belong to `https://auth.openai.com`. ID tokens require a verified
RS256 or ES256 signature, issuer, audience, expiry, nonce and stable account
identity. Plan usage additionally requires the granted
`chatgpt.tokens.use.direct` scope.

`userData/chatgpt-host.json` contains one opaque UUID host identifier for the
installation. Each local workspace stores `chatgpt-profiles.json` in
`localAccounts.root`, alongside its settings. The unnamed workspace uses the
main user-data directory. Profile identity, registration and the legacy usage
confirmation flag are plain metadata; the access, refresh and retained ID tokens
are encrypted together with Electron `safeStorage`. Linux `basic_text` is
rejected. Without secure storage, tokens remain in process memory and a later
application session requires sign-in. Unreadable encrypted records are retained
until explicitly replaced or signed out. Writes are atomic with POSIX mode 0600.

Profile state and models cross IPC without credentials. Tokens and authorization
URLs must not be logged or included in exported settings, workflows or saves.

Near expiry, refreshes are serialized per profile in the Electron runtime and
the replacement token set is saved before reuse. Failed credential writes are
retried before the replacement can be used. Temporary failures preserve the
session; terminal refresh errors (`invalid_grant`, `invalid_refresh_token`,
`token_expired`, `refresh_token_expired`, `refresh_token_invalidated` and
`refresh_token_reused`) clear unusable credentials and require sign-in with the
saved registration. Access tokens without a refresh token remain usable until
their actual expiry. A refresh in flight is never aborted by cancellation or a
workspace transition, because the rotated refresh token would be lost. A token
response's `earliest_refresh_at` (epoch seconds or ISO timestamp) delays renewal;
an expired session that cannot be renewed yet asks for a retry, not a new sign-in.
Explicit sign-out attempts refresh-token revocation, retrying one network or
server failure, and removes the local profile and its registration.
It does not clear system-browser cookies or delete the registered app at OpenAI.
Failure to confirm remote revocation is shown to the user, including when saved
credentials cannot be decrypted for revocation.

The first ChatGPT operation claims Electron's native single-instance lock for
the user-data runtime, preventing competing RPGraph processes from racing rotating
refresh tokens or profile writes. Another instance can continue using other
providers, but cannot use ChatGPT while the owner runs. Electron releases its
native lock when the owner exits, including after a crash. Local account switching
does not release the lock.

## Local workspace transitions

Switching local RPGraph accounts is not ChatGPT sign-out. `handleAccountTransition`
cancels pending OAuth operations and LLM requests before the workspace operation
gate waits for completion. ChatGPT IPC operations capture the workspace root;
late callbacks cannot write credentials to a newly selected account directory.
Saved profile credentials remain available when returning to the original
workspace, including in-memory credentials during the same app session. Deleting
a local account also releases its cached profiles.

## Requests

`electron/providers/chatgptAdapter.cjs` pins model discovery and inference to
`https://api.openai.com/v1`. It uses the selected profile's OAuth bearer token,
independently of generic API-key and endpoint settings. Every inference request
uses `/responses`, `store: false`, `stream: true` and a complete `input` array.
Generic sampling and output-token-limit fields are omitted. Thinking uses
`reasoning: { effort }`; image attachments use `input_image` content items.

The existing `chatCompletion` and `streamChatCompletion` bridge methods dispatch
ChatGPT connections to this adapter. Non-streaming callers collect the internal
stream; streaming callers receive the existing accumulated-text callback format.
Success requires `response.completed` and nonempty text. Failed, incomplete,
cancelled and truncated streams fail the call. Reported usage feeds the existing
token metrics. ChatGPT cached input tokens are retained in call statistics and
run reports, and displayed only in LLM Runtime summaries and call details. Missing
cache usage remains unknown; a reported zero means no cache hit. Cached tokens
are a subset of input tokens and are not added to totals again. The built-in assistant and ComfyUI workflow repair use the same
adapter. Error codes, HTTP status, parameter and request IDs survive structured
IPC errors. Failures without a dedicated message name the received HTTP status,
the server's error code, the rejected parameter and its `error.message`;
unstructured admission `detail` text is not shown. No automatic fallback to another provider or billing path occurs.

Manage usage opens ChatGPT usage settings. RPGraph does not estimate remaining
plan allowance or scrape an undocumented usage endpoint.

## References

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
