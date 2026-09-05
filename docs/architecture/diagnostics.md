# Debug Snapshot and Turn Trace

Debug Snapshot captures selected application and current runtime state when its
dialog opens. It can include recent turns, graph topology, prompt diagnostics,
events, and logs. Turn Trace records one run attempt associated with a turn,
including attempts that fail or are cancelled. Each export is self-contained;
neither references the other tool or an unselected trace.

## Recording

`NodeLlmApi` observes requests before connection resolution, bridge dispatch,
stream updates, and completion or failure. Graph executions have a scoped
observer; helper API copies with the same run AbortSignal share the run observer.
The graph distinguishes response execution from next-turn preparation. Request
snapshots contain sanitized prompt text, response text, optional partial streamed
text, image metadata actually supplied to the bridge, routing annotations, stage,
model/sampling settings, and available usage. Connection credentials are excluded.

Prompt sections and their action/step insertion markers are attached only when
they reconstruct the exact request text. The original request remains recorded.
Final node state is never used to reconstruct an earlier call. Separate node
execution events record requested output handles, start/completion/error states,
prepared-at-start flags, resulting text, and prompt action results available at
node completion/failure after an observed request. Memoized dependency reads do not
invent extra executions or LLM requests. Warnings and format results remain an
ordered event list associated with nodes and phases, rather than being attached
to an arbitrary pass of a node.

Run ID, turn ID/number, original turn creation time, run start, capture completion,
and export assembly time are distinct fields. Monotonic millisecond timestamps
allow node, request, and diagnostic events to be correlated within the running
application. Provider usage tokens are separate from export token estimates.

A completed trace is a detached sanitized value. Later node preparation, edits,
rollback, or delayed provider completion cannot change it. Regeneration and retry
retain distinct attempts. Storage retains up to 90 attempts across the latest 30
turn numbers in RAM. Loading/resetting clears traces; undo removes the undone
turn's attempts. Traces are not part of RP saves.

## Export and compaction

Snapshot schema version 2 uses 2,400 preview characters and 100 collection items,
or 800 characters and 40 items in compressed mode. Event entity maps are bounded
explicitly, prioritizing upcoming events and retaining IDs under an `entries`
wrapper. Omission counts live outside that map, so real IDs cannot collide with
metadata. Graph nodes and connections are not capped by these collection limits.

Turn Trace schema version 6 uses 2,400 preview characters. Request passes, output
passes, node executions, and diagnostic events retain their order and are not
capped. Auxiliary history segments and action-result collections use the standard
100-item cap when applicable. Long text contains character/token estimates and
explicit omission counts, usually retaining its beginning and end. History and
Text Input contexts prefer the latest portion. Truncation begins only beyond the
preview budget plus 160 characters, avoiding overhead for marginally longer text.

Both exports reuse the same sanitized-value compaction where its semantics match:
exact source strings can reference earlier exported values; identical excerpts can
reference earlier excerpts without equating different original texts. Small
repetitions remain inline when reference overhead would outweigh savings. Pointers
escape `/` and `~` and are constructed after collection selection. Arbitrary
objects retain their structure, including routing and status fields.

Turn Trace's UI shows captured text. The export-preview tab shows the exact JSON
or TOON copied by the clipboard action, including truncation and references. Its
total token estimate measures that formatted string with the configured estimator.
Per-turn estimates represent independent exports and need not add up to the range
estimate. TOON roundtrips use `expandPaths: 'safe'` to match safe key folding.

## Limits and manual verification

- Graph/character/provider preflight checks before the turn collector is created
  do not produce a Turn Trace. Their messages remain in the system log/Snapshot.
- Requests outside the graph observer and without the run AbortSignal can only
  appear as report-only successful calls if the run report recorded them. Their
  prompts are not reconstructed. Non-LLM external actions are represented by
  graph outputs, inserted action results, and diagnostics, not full network logs.
- Bridge dispatch is not proof of provider receipt. The trace records the prompt
  passed to the completion bridge, not a provider's final HTTP envelope.
- A pending request at trace capture may later settle; the historical capture
  deliberately stays unchanged. Failed streams have only the text received so far.
- Bounded exports cannot recover omitted text. Raw captures are retained in RAM
  within the attempt limit, not under a strict byte limit. A long single run can
  still occupy substantial memory.
- An already shortened supplied snapshot can demonstrate additional excerpt
  deduplication, but cannot verify reconstruction of its missing source text.

Manual checks should cover a successful multistep prompt, an action follow-up and
replay, a switch fallback, provider failure during a later pass, cancellation and
restart, translation failure before graph execution, and next-turn preparation.
Compare individual and combined turn exports in JSON and TOON, then exercise
regeneration, undo, session load, and reset. Check long Text Input sections, image
metadata, format errors, selected output handles, timestamps, and clipboard text.
Application, browser, and UI/E2E tests are intentionally left to the user.
