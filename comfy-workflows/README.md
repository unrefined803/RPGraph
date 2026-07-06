# ComfyUI Workflows

RPGraph keeps ComfyUI workflows in two shapes:

- `api-workflows-with-variables/` contains API JSON files that RPGraph can run. These files include RPGraph placeholders such as `prompt`, `width`, `height`, `speech_text`, or `voice_audio`.
- `normal-comfyui-workflows/` contains regular ComfyUI UI workflows for first-time setup. Open these in ComfyUI to install custom nodes, download models, and confirm the workflow runs before selecting the matching API workflow in RPGraph.

Each shape is split into `image/` and `voice/` folders so image and voice provider presets only show compatible workflows.
