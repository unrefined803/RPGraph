# Built-in NPC Characters

Place validated Character Container V2 JSON files directly in this directory.
Electron packages it as the read-only built-in NPC tier. Nested directories are
not scanned. Encrypted character files remain locked until a matching active
game or account password is available; encrypted Storybooks are not NPC sources.

Inspect characters with `npm run character:inspect` and revise them with
`npm run character:edit`. The lightweight edit specification preserves untouched
embedded media exactly; do not hand-edit Base64 payloads.

Characters can have up to two character-level agency tags. App accounts have no
separate tags or creator/user role. See [NPC Agency Tags](../../docs/architecture/npc-agency-tags.md)
for the schema and reaction context. Generate a disposable inventory with:

```sh
npm run npc:report -- --output /tmp/rpgraph-npc-population.md
```

Library reload exposes the current bundled revision. User overrides, active
Storybook definitions and pinned RP copies retain their precedence. Keep stable
character, account, image and post IDs when revising a container.
