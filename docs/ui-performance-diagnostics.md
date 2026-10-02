# UI performance diagnostics

Hold **D**, **E** and **V** together outside text inputs to reveal the hidden
**Run Reliability** tab in Options. This developer access lasts until the app
reloads and is not saved. Typing the letters sequentially does not activate it.
Open **Options → Run Reliability → UI performance diagnostics**. Select **Start
recording**, close Options, and reproduce a few chat stutters (ideally a 10–30
second sample). Return to the same section and select **Stop and export report**.
Share the downloaded `rpgraph-ui-performance-*.json` file for analysis.

Recording continues while Options is closed. Stop/export cancels monitoring; a
new recording replaces the old one. Recording is never enabled automatically or
persisted across restarts. Export is manual and sends nothing over the network.
The recorder stores at most 12,000 samples, overwriting the oldest entries. The
report states how many samples were overwritten. No message text, character
names, images, prompts, credentials, or script URLs are collected.

## Summarizing a report

Reports contain thousands of per-frame scroll samples. Condense one with:

`npm run perf:summary -- <report.json> [--min-gap=34] [--top=8] [--context=60]`

The summary lists frame-gap counts, the slowest measured work, and one merged
timeline per stall without routine scroll samples. `… N ms without samples`
marks time between instrumented samples, where uninstrumented work is hidden.

## Reading a report

All times use the same monotonic clock relative to recording start.
`longestStalls` lists the 30 longest frame gaps/long tasks/long animation frames,
with nearby application work. `events` is the complete retained timeline.
Nested durations overlap and must not be added together. Nearby work identifies
candidates; temporal proximity does not prove causation. Opening Options or
exporting is not part of the chat reproduction, so distinguish those timestamps.

- `messages.stream` versus `messages.update`: streaming and committed updates.
  `fields` identifies speaker, dialogue/highlighting, embedded phone, and other
  metadata changes without recording their values. `messages.append` marks new
  records; `messages.timestamps` covers RP time updates.
- `characters.captureMessages` / `characters.reconcileMessages`: synchronous NPC
  history processing nested inside message changes.
- `characters.interactedIds`: cached NPC history classification used for color eligibility.
- `chat.timeline`: chat timeline reconstruction. `chat.rowRenderBatch` counts row
  component executions in short 16 ms windows (with up to 20 example message IDs),
  exposing broad rerenders. These are executions, not committed DOM updates;
  development Strict Mode can invoke rendering more than once.
  `rowPropChanges` contains up to 20 execution details per batch, formatted as
  `messageId:propName,propName`. Only names are retained, never prop values.
  `(baseline)` means this row has not executed earlier in the recording;
  `(unchanged)` means no shallow prop differences since its previous execution.
  These compare render attempts, not committed renders, and are not proof that
  a changed prop caused all observed work. Start recording before generation so
  the affected rows have an opportunity to establish a baseline.
- `chat.rowTimelines`: row-local timeline projection. Rows receive only their
  linked phone/social records, quoted phone replies and own grouping state.
  Unrelated timeline edits preserve these row props. Actual linked changes,
  timestamps, regrouping and undo still invalidate the affected rows.
- `phone.socialDirectory`, `phone.notifications`, `phone.conversations`: derived
  phone data work, including when the Phone panel itself is not visible.
- `history.serialize`, `history.originalHistory`, `history.translatedHistory`:
  completed-history preparation for graph previews.
- `react-render`: React Profiler timings for App, Chat and Graph. These measure
  render work, not browser layout/paint. Standard production React builds can
  omit these callbacks; `reactProfilerObserved` makes that absence explicit.
- `app.render` (`start`, `bodyEnd`), `render.mark` and `app.commit` (`layout`,
  `effects`): position markers for one application render. `start` to `bodyEnd`
  is the App function body; `chatRuntimeEnd`, `graphRunStart` and `headerStart`
  split it at fixed source positions. React renders siblings in order, so the time between
  `graph.start`, `graph.end`, `chatPanel.start`, `chatPanel.end` and `dialogs.end`
  belongs to the subtree between those markers. `dialogs.end` to `layout` covers
  the remaining render and DOM mutation; `layout` to `effects` covers layout
  effects, browser rendering and scheduling. A repeated `start` without `bodyEnd`
  or commit markers indicates a restarted render. These markers are available in
  standard builds, unlike the React Profiler callbacks.
- `scroll.readLayout` / `scroll.writePosition`: synchronous scroll frame work;
  expensive reads can indicate a forced layout. Scroll start/bottom markers
  distinguish work during motion from work after scrolling finishes.
- `images.contextualIds`: reference-image selection and stable ID-set derivation.
  Equal ID membership retains the previous Set across message metadata updates.
- `phone.messageSound`: sound trigger, independently of Phone rendering.
- `frame-gap`: visible animation-frame intervals of at least 24 ms. Background
  visibility changes reset the interval. A gap alone does not identify its cause.
- `longtask` / `long-animation-frame`: browser-provided timings, when supported.
  Animation-frame entries include aggregate script, forced-layout and rendering
  durations. Rendering/style fields describe time from phase start to frame end,
  so they overlap and do not isolate painting. No browser attribution URLs or DOM
  targets are exported.

A long message-update span with nested character work suggests data processing.
Many row executions and long React timings suggest broad component updates.
Small application spans with a long browser rendering phase suggest layout or
rendering work. Missing browser/React metrics are not evidence that those phases
were fast. GPU/system scheduling and uninstrumented work remain possible.

Implementation: `src/diagnostics/uiPerformance.ts`. Monitoring does not update
React state for individual samples, write to the console, or serialize reports
while chat output runs. The observer and per-frame sampler exist only during an
explicit recording. Instrumentation adds some overhead, so compare repeated
short samples before attributing a small timing difference to a code change.

## Profiling build for unresolved stalls

Run `npm run build -- --mode profiling`, then start the desktop application
normally. This opt-in build aliases `react-dom/client` to React's production
profiling renderer so the existing App, Chat and Graph Profiler boundaries can
report render durations. Record and export through the same diagnostics UI.
Check `reactProfilerObserved` in the next report. A normal `npm run build`
restores the standard renderer. Profiling adds overhead, so use it for attribution,
not as a directly comparable benchmark against standard builds.

Additional synchronous probes cover `highlighting.selectSpeakers`,
`characters.runtimeRebuild`, `phone.accountLinkGrants`,
`phone.authoredConnections` and `phone.runtimeCharacters`. These capture no
function inputs or outputs. They narrow gaps outside the chat-row execution
markers; missing time can still include React commit work and browser rendering.

Reference: [React profiling builds](https://react.dev/reference/dev-tools/react-performance-tracks).
