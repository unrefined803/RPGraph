# Code Review To-Dos

Maintained to-do list from code reviews. Completed items are marked ✅ with the
date and a short comment; new noteworthy debt gets a new numbered row.

| # | Status | Item |
|---|--------|------|
| 1 | open | LLM call stage info is stringly typed: `runActionAwarePrompt` encodes the pass in label strings ("Step <name>", "Step <name> replay N", "Action follow-up: …") and `llmCallStageLabel` regex-parses them back for display. Works, but every new pass label must be added in both places or the progress UI silently falls back to the raw label. Consider passing a structured stage object through `llmActiveCallLabel` instead. (2026-07-18, multistep review) |
