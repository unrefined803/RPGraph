# Code-Review-Aufgabenliste

Gepflegte To-do-Liste aus Code-Reviews (siehe AGENTS.md). Erledigte Punkte werden
mit ✅, Datum und kurzem Kommentar markiert.

Hinweis: Die ursprüngliche Datei mit den Einträgen 1–16 war nicht im Repository
und ist verloren gegangen. Die Nummern 17 und 18 sind aus den Verweisen in
AGENTS.md rekonstruiert; neue Einträge werden ab 19 fortgezählt.

| Nr. | Thema | Status |
| --- | --- | --- |
| 17 | ESLint-Altbestand: bekannter Rückstand an Lint-Findings im Bestandscode. Keine neuen Findings einführen; Altbestand nicht nebenbei mitfixen. | offen |
| 18 | knip-Altbestand: gemeldete tote Dateien/Exports/Typen (`npm run check:unused`); False-Positive-Einstiegspunkte stehen in `knip.json`. | offen |
| 19 | Custom Node: Nutzer-Code läuft ohne Zeitlimit im UI-Hauptthread (`src/nodes/custom-node/runtime.ts`). Eine Endlosschleife (z. B. vom Assistenten generiertes `while(true)`) friert die ganze App ein. Lösung: Ausführung in einen Web Worker mit Timeout auslagern; die `llm`/`llmJson`-Aufrufe müssen dann per Message-Passing zum Hauptthread zurück. Größerer Umbau. (Gefunden im Custom-Node-Review am 2026-07-05.) | offen |
| 20 | Custom Node: graph-run failures from `executeCustomNode` are only shown through the graph runtime error path and are not automatically added to the Custom Node Assistant chat history. Manual Run button failures are covered, but full workflow-run failures should also become assistant context when a Custom Node Assistant history exists for that node. | ✅ 2026-07-05: Custom Node run errors are now collected as dismissible Assistant diagnostics and included in Assistant context. |
| 21 | Custom Node Assistant preview uses a mock LLM response instead of the selected provider, so LLM-based Custom Nodes can appear to work in preview even when the real provider call would fail. Either label this clearly as a mock preview or add an optional real-provider preview run. | open |
| 22 | Voice privacy: deleting generated ComfyUI voice outputs fails silently. `deleteComfyOutputFile` in `electron/main.cjs` ignores its result, so when the ComfyUI build has no delete route the user believes clips are removed while they stay in the ComfyUI output folder. Surface a one-time warning (or health detail) when deletion fails. | ✅ 2026-07-06: deletion is now verified with a follow-up existence check; failures warn at most twice per provider, the second warning tells the user to delete the files manually. |
| 23 | Voice privacy: uploaded reference voice samples (`rpgraph-voice-<hash>.mp3`) accumulate forever in the ComfyUI input directory and are never deleted, even with "delete voice outputs" enabled. Consider deleting them after the run or documenting the leftover files. | ✅ 2026-07-06: with the delete option on, the uploaded sample is deleted (and verified) after every voice run, even when the run fails; failures use the same warning path as #22. |
