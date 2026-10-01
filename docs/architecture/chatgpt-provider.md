# ChatGPT provider

## Connections and account profiles

The `chatgpt` LLM provider uses Sign in with ChatGPT and eligible ChatGPT plan
usage. A `ConnectionPreset` stores a `chatgptProfileId`, model slug and label.
Multiple presets reference one reusable profile and can select different models
for different nodes. Creating a new ChatGPT preset selects the workspace's last
used profile without starting another OAuth flow. Removing a preset or changing
its provider type does not sign out its profile.

`ChatGPTProviderSettings` provides saved account selection, browser sign-in,
additional accounts, explicit sign-out, a first-use plan confirmation and
Manage usage. Model selection displays the account catalog's `display_name` and
stores its `slug`. Only catalog entries with `visibility: "list"` are offered.
The current integration supports text requests. Vision, image and voice
generation, reasoning controls and model capability discovery are deferred.
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
main user-data directory. Profile identity, registration and first-use
confirmation are plain metadata; the access, refresh and retained ID tokens
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
their actual expiry. Explicit sign-out attempts
refresh-token revocation and removes local tokens while retaining registration.
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
Generic sampling, reasoning and output-token-limit fields are omitted.

The existing `chatCompletion` and `streamChatCompletion` bridge methods dispatch
ChatGPT connections to this adapter. Non-streaming callers collect the internal
stream; streaming callers receive the existing accumulated-text callback format.
Success requires `response.completed` and nonempty text. Failed, incomplete,
cancelled and truncated streams fail the call. Reported usage feeds the existing
token metrics. The built-in assistant and ComfyUI workflow repair use the same
adapter. Error codes, HTTP status, parameter and request IDs survive structured
IPC errors. No automatic fallback to another provider or billing path occurs.

Manage usage opens ChatGPT usage settings. RPGraph does not estimate remaining
plan allowance or scrape an undocumented usage endpoint.

## References and validation

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

Unit tests cover signed identity validation, callback state, profile restoration,
workspace separation, concurrent refreshes, storage failures, account permissions,
revocation, model selection and streamed completion. Tests inject the browser,
loopback listener and OpenAI transport; they do not perform real sign-in.
Interactive validation requires an eligible account and a completed live request.
