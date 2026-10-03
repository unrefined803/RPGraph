# Image Generation

`src/images/providers.ts` defines image-provider eligibility for the image assistant,
character preview, and workflow capability display. ComfyUI image
connections are eligible by role. OpenRouter connections require a selected model whose
health metadata reports image output; vision input alone does not qualify. Model changes
refresh capabilities through `useProviderConnections`.

OpenRouter generation uses `POST /api/v1/images` with the selected model, prompt, one
requested image, PNG output, and an aspect-ratio request from the image assistant (portrait 3:4 by default).
Other generation entry points can still request explicit pixel sizes. Actual dimensions depend
on the model. `electron/openRouterImages.cjs` validates requests and converts base64
responses to raster data URLs. The preload bridge propagates structured errors and
cancellation. Generation errors do not automatically retry paid requests or mark an
otherwise reachable API provider offline.

The image assistant and character preview share the provider routing in
`useProviderConnections`. Workflow runs do not generate images: the former
`Create character phone image` prompt action and its runner were removed, and stored
action entries with that ID are dropped when a workflow is loaded.

LoRAs, workflow settings, and model unload/reload operations apply only to ComfyUI.
API-image prompts omit the local settings and LoRA instruction block, and keep settings
null. Their separate reference capability block requires explicit Image 1–3 references
in the returned generation prompt. The assistant offers a format selector and disables
the local Image Settings tab for API connections.
Venice has a backend image handler but is not yet exposed by the shared eligibility
helper; integrating and validating that provider is a separate step.

API reference: [OpenRouter Image Generation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation).

## Reference Images

The image assistant supports up to three ordered references for OpenRouter image
connections and the bundled `Qwen-Image-2.1+Edit.json` ComfyUI image workflow.
`supportsImageGenerationReferences` is the capability boundary. ComfyUI workflow
inspection detects `LoadImage` together with the supported `TextEncodeQwenImage21`
encoder, including templates whose optional image inputs are disconnected. A loader
alone does not establish support for an arbitrary editing model. The filename is irrelevant.
Provider checks and workflow inspections refresh this capability in provider health;
the renderer only uses results matching the selected workflow path. Unknown workflows
keep reference controls disabled until inspected. The main process applies the same
node-based check before uploading reference images.
Before submission, it uploads references to ComfyUI temp storage and connects dedicated
`LoadImage` nodes to `images.image_1` through `images.image_3` in selection order.
Unused optional inputs are removed, including all three for text-only generation.
Original template files and unrelated graph connections remain unchanged. Upload errors
stop generation; servers control the lifetime of uploaded temp files. The gallery picker defaults to the
current phone character. Saved gallery images and generated previews both enter the
same selection. Duplicates are rejected; removing an image renumbers the remaining
references, and switching to an unsupported provider clears the selection.

`src/images/references.ts` keeps reference labels, assistant attachment order, and prompt
instructions aligned. The chat shows centered 30×30-pixel square thumbnails inline with reference notices.
Hover, focus, or click reveals a preview up to 256 CSS pixels per side; removing a
reference updates its active Image 1–3 label. Preview sizing does not resize the source
images. A vision-capable assistant receives the references before any separately
attached generated preview; the preview is never implicitly used for generation.

Generation sends the selected data URLs as OpenRouter `input_references` in the same
order. The backend validates the maximum count and raster data URL formats before the
request. The image model determines the actual reference-image support; provider errors
remain visible without automatic retries. References live only in the current assistant
dialog and are not saved into chat/session history.

## Character LoRA Compatibility

The image assistant checks character LoRA filenames against recognized model families
(Qwen, Krea 2, Flux 1/2, SDXL, SD 1.5), preferring the configured model over the
workflow filename. This is a naming heuristic, not weight-file validation. Unrecognized
or mismatched names remain selected but inactive (yellow); clicking the badge explicitly
activates them for the current provider configuration and LoRA selection. Without an
assigned Character LoRA slot, the badge is blocked (red) and cannot be overridden.
Tooltips include all applicable reasons and the chat reports inactive selections and
manual activation. Generation omits inactive character LoRAs. Slot resolution never
inserts a character LoRA into an unassigned slot or replaces a provider's fixed LoRA.
The assistant receives workflow, diffusion-model, checkpoint, and slot context, and must
describe character appearance fully when the selected LoRA cannot activate.

## Assistant context and capability limits

The assistant receives the selected provider and model. ComfyUI additionally supplies
workflow, checkpoint, diffusion model, and the current Character LoRA activation state,
including a manual override for that exact selection. API providers omit local model
and LoRA metadata. A selected generated preview remains attached after the ordered
references during ordinary assistant conversation as well as explicit description tasks;
it is not implicitly added to the generation references.

The controls do not query `/api/v1/images/models` for model-specific reference
counts or aspect ratios. They can therefore offer a combination the selected
model rejects. Provider errors remain visible.

The API format selector is authoritative. API assistant responses keep settings
null, so a format requested in conversation does not synchronize the selector.
