# Built-in NPC Characters

Place validated, plain Character Container V2 JSON files directly in this
directory. Electron packages this directory as the read-only built-in NPC tier.
Encrypted containers and nested directories are intentionally not discovered.

Inspect image-backed characters with `npm run character:inspect` and revise them
with `npm run character:edit`. This keeps embedded image bytes out of the edit
specification and preserves untouched media exactly; do not hand-edit base64
payloads.
