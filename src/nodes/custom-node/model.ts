import type { PortSnapshot } from '../../types';

export type CustomNodeLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type CustomNodeElementType =
  | 'button'
  | 'checkbox'
  | 'slider'
  | 'number-input'
  | 'text-input'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'meter'
  | 'text';

export type CustomNodeElement = {
  id: string;
  type: CustomNodeElementType;
  label: string;
  text?: string;
  value?: unknown;
  options?: string[];
  action?: 'run-code' | 'set-state' | 'toggle-state';
  stateKey?: string;
  stateValue?: unknown;
  min?: number;
  max?: number;
  step?: number;
  layout?: CustomNodeLayout;
};

export type CustomNodeDefinition = {
  version: '1.0.0';
  title?: string;
  controls: CustomNodeElement[];
  displays: CustomNodeElement[];
  inputs: PortSnapshot[];
  outputs: PortSnapshot[];
  state: Record<string, unknown>;
  code: string;
};

export type CustomNodeAssistantResult = {
  reply: string;
  changedFields: string[];
  definition?: CustomNodeDefinition;
};

type CustomNodeCodePatch = {
  find: string;
  replace: string;
};

type CustomNodeDefinitionPatch = {
  title?: string;
  inputs?: PortSnapshot[];
  outputs?: PortSnapshot[];
  controls?: CustomNodeElement[];
  displays?: CustomNodeElement[];
  state?: Record<string, unknown>;
  stateMerge?: Record<string, unknown>;
  code?: string;
  codePatches?: CustomNodeCodePatch[];
  codeAppend?: string;
  codePrepend?: string;
};

export const defaultCustomNodeInfoText =
  'Custom Node can be shaped by the Node Assistant. Select an LLM provider, describe the node you want, run checks, then apply the generated definition. It can later define controls, display boxes, connector ports, small state, JavaScript logic, and controlled LLM calls.';

export function defaultCustomNodeDefinition(): CustomNodeDefinition {
  return {
    version: '1.0.0',
    title: 'Custom Node',
    controls: [],
    displays: [
      {
        id: 'about',
        type: 'text',
        label: 'About',
        text: defaultCustomNodeInfoText,
        layout: { x: 12, y: 104, w: 341, h: 112 },
      },
    ],
    inputs: [],
    outputs: [],
    state: {},
    code: '',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isLayout(value: unknown): value is CustomNodeLayout {
  return (
    isRecord(value) &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.w === 'number' &&
    typeof value.h === 'number' &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.w) &&
    Number.isFinite(value.h)
  );
}

function isElementType(value: unknown): value is CustomNodeElementType {
  return (
    value === 'button' ||
    value === 'checkbox' ||
    value === 'slider' ||
    value === 'number-input' ||
    value === 'text-input' ||
    value === 'textarea' ||
    value === 'select' ||
    value === 'radio' ||
    value === 'meter' ||
    value === 'text'
  );
}

function isElement(value: unknown): value is CustomNodeElement {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isElementType(value.type) &&
    typeof value.label === 'string' &&
    (value.text === undefined || typeof value.text === 'string') &&
    (value.options === undefined ||
      (Array.isArray(value.options) && value.options.every((option) => typeof option === 'string'))) &&
    (value.action === undefined ||
      value.action === 'run-code' ||
      value.action === 'set-state' ||
      value.action === 'toggle-state') &&
    (value.stateKey === undefined || typeof value.stateKey === 'string') &&
    (value.min === undefined || (typeof value.min === 'number' && Number.isFinite(value.min))) &&
    (value.max === undefined || (typeof value.max === 'number' && Number.isFinite(value.max))) &&
    (value.step === undefined || (typeof value.step === 'number' && Number.isFinite(value.step))) &&
    (value.layout === undefined || isLayout(value.layout))
  );
}

function isPort(value: unknown): value is PortSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.direction === 'input' || value.direction === 'output') &&
    typeof value.valueType === 'string' &&
    typeof value.label === 'string' &&
    (value.multiple === undefined || typeof value.multiple === 'boolean')
  );
}

export function isCustomNodeDefinition(value: unknown): value is CustomNodeDefinition {
  return (
    isRecord(value) &&
    value.version === '1.0.0' &&
    (value.title === undefined || typeof value.title === 'string') &&
    Array.isArray(value.controls) &&
    value.controls.every(isElement) &&
    Array.isArray(value.displays) &&
    value.displays.every(isElement) &&
    Array.isArray(value.inputs) &&
    value.inputs.every((port) => isPort(port) && port.direction === 'input') &&
    Array.isArray(value.outputs) &&
    value.outputs.every((port) => isPort(port) && port.direction === 'output') &&
    isRecord(value.state) &&
    typeof value.code === 'string'
  );
}

export function customNodeDefinition(value: unknown): CustomNodeDefinition {
  return isCustomNodeDefinition(value) ? value : defaultCustomNodeDefinition();
}

function stripJsonFence(text: string) {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function hasOwnKey(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isCodePatch(value: unknown): value is CustomNodeCodePatch {
  return (
    isRecord(value) &&
    typeof value.find === 'string' &&
    typeof value.replace === 'string'
  );
}

function isDefinitionPatch(value: unknown): value is CustomNodeDefinitionPatch {
  return (
    isRecord(value) &&
    (value.title === undefined || typeof value.title === 'string') &&
    (value.inputs === undefined ||
      (Array.isArray(value.inputs) && value.inputs.every((port) => isPort(port) && port.direction === 'input'))) &&
    (value.outputs === undefined ||
      (Array.isArray(value.outputs) && value.outputs.every((port) => isPort(port) && port.direction === 'output'))) &&
    (value.controls === undefined ||
      (Array.isArray(value.controls) && value.controls.every(isElement))) &&
    (value.displays === undefined ||
      (Array.isArray(value.displays) && value.displays.every(isElement))) &&
    (value.state === undefined || isRecord(value.state)) &&
    (value.stateMerge === undefined || isRecord(value.stateMerge)) &&
    (value.code === undefined || typeof value.code === 'string') &&
    (value.codePatches === undefined ||
      (Array.isArray(value.codePatches) && value.codePatches.every(isCodePatch))) &&
    (value.codeAppend === undefined || typeof value.codeAppend === 'string') &&
    (value.codePrepend === undefined || typeof value.codePrepend === 'string')
  );
}

function applyCodePatches(code: string, patches: CustomNodeCodePatch[] | undefined) {
  return (patches ?? []).reduce((current, patch) => {
    if (!current.includes(patch.find)) {
      throw new Error(`Code patch find text was not found: ${patch.find.slice(0, 120)}`);
    }
    return current.replace(patch.find, patch.replace);
  }, code);
}

function applyDefinitionPatch(
  fallbackDefinition: CustomNodeDefinition,
  patch: CustomNodeDefinitionPatch,
): CustomNodeDefinition {
  const patchedCode = [
    patch.codePrepend ?? '',
    patch.code !== undefined
      ? patch.code
      : applyCodePatches(fallbackDefinition.code, patch.codePatches),
    patch.codeAppend ?? '',
  ].filter(Boolean).join('\n');

  return {
    version: '1.0.0',
    title: patch.title ?? fallbackDefinition.title,
    inputs: patch.inputs ?? fallbackDefinition.inputs,
    outputs: patch.outputs ?? fallbackDefinition.outputs,
    controls: patch.controls ?? fallbackDefinition.controls,
    displays: patch.displays ?? fallbackDefinition.displays,
    state: patch.state ?? {
      ...fallbackDefinition.state,
      ...(patch.stateMerge ?? {}),
    },
    code: patchedCode,
  };
}

function changedFieldsFromPatch(patch: CustomNodeDefinitionPatch) {
  const fields = new Set<string>();
  if (patch.title !== undefined) fields.add('title');
  if (patch.inputs !== undefined) fields.add('inputs');
  if (patch.outputs !== undefined) fields.add('outputs');
  if (patch.controls !== undefined) fields.add('controls');
  if (patch.displays !== undefined) fields.add('displays');
  if (patch.state !== undefined || patch.stateMerge !== undefined) fields.add('state');
  if (
    patch.code !== undefined ||
    patch.codePatches !== undefined ||
    patch.codeAppend !== undefined ||
    patch.codePrepend !== undefined
  ) {
    fields.add('code');
  }
  return [...fields];
}

export function parseCustomNodeAssistantResult(
  text: string,
  fallbackDefinition: CustomNodeDefinition,
): CustomNodeAssistantResult {
  const parsed = JSON.parse(stripJsonFence(text)) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Assistant response is not a JSON object.');
  }
  const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
  const patch = parsed.patch;
  const definition = (() => {
    const hasDefinition = hasOwnKey(parsed, 'definition');
    const hasPatch = hasOwnKey(parsed, 'patch');
    if (hasDefinition && hasPatch) {
      throw new Error('Assistant response must include either "definition" or "patch", not both.');
    }
    if (hasDefinition && isCustomNodeDefinition(parsed.definition)) {
      return parsed.definition;
    }
    if (hasDefinition) {
      throw new Error('Assistant response included an invalid Custom Node definition.');
    }
    if (hasPatch && isDefinitionPatch(patch)) {
      return applyDefinitionPatch(fallbackDefinition, patch);
    }
    if (hasPatch) {
      throw new Error('Assistant response included an invalid Custom Node patch.');
    }
    if (reply) {
      return undefined;
    }
    throw new Error('Assistant response must include a valid "reply", "definition", or "patch".');
  })();
  if (definition && !isCustomNodeDefinition(definition)) {
    throw new Error('Assistant response produced an invalid Custom Node definition.');
  }
  return {
    reply: reply || 'Custom Node updated.',
    changedFields: !definition
      ? []
      : stringArray(parsed.changedFields).length
        ? stringArray(parsed.changedFields)
        : isDefinitionPatch(patch)
          ? changedFieldsFromPatch(patch)
          : [],
    definition,
  };
}

export function customNodeAssistantPrompt(
  currentDefinition: CustomNodeDefinition,
  instruction: string,
  assistantContext = '',
) {
  return [
    'You are the Custom Node Assistant for RPGraph.',
    'Return only valid JSON. No markdown. No comments. No extra keys.',
    'You can answer questions, create one Custom Node definition, or edit the current Custom Node definition. You are not editing RPGraph source code.',
    'If the user asks a question or asks for an explanation, answer with a reply-only JSON object and do not include definition, patch, or changedFields.',
    'If the user asks you to build, change, fix, rename, add, remove, or update the Custom Node, return a definition or patch.',
    'RPGraph is a node-based roleplay and story workflow tool. Custom Nodes should be useful for text processing, story processing, roleplay state, JSON transformation, routing, formatting, and controlled LLM calls.',
    'The Custom Node may only use data that comes from its connector inputs, its UI controls, its internal state, or the selected RPGraph LLM helper.',
    'The Custom Node must not access the computer, local disks, files, folders, environment variables, browser APIs, network, internet, external URLs, databases, plugins, shell commands, or hidden application internals.',
    'If the user asks for filesystem, SSD, hard drive, folder search, internet, website, API, browser, clipboard, OS, process, or network access, do not implement that access. Explain in the reply that Custom Nodes are limited to workflow inputs, controls, state, and LLM calls.',
    'Safe capabilities include basic JavaScript data processing, text processing, number processing, boolean logic, JSON parsing/formatting, arrays/objects, small internal state, display updates, connector outputs, image forwarding from workflow image inputs to the selected LLM, and LLM/LLM JSON requests through llm and llmJson only.',
    'Generate JavaScript code whenever the requested node should compute, transform, route, count, format, parse JSON, call the LLM, or update display output.',
    'The runtime calls the code with variables named inputs, controls, state, llm, llmJson, json, number, text, clamp, words, and lines already available.',
    'Use const answer = await llm(promptText) when the node should call the selected LLM provider.',
    'You may also call await llm({prompt, label, maxTokens, temperature}).',
    'For vision/multimodal prompts, add an image input connector with valueType "image" and call await llm({prompt, images:true}) to send all connected workflow images, or images:"image_input_id" to send one named image input.',
    'Use const data = await llmJson(promptText) when the LLM should return structured JSON.',
    'For structured vision results, call await llmJson({prompt, images:true}, fallback) or await llmJson({prompt, images:"image_input_id"}, fallback).',
    'llmJson automatically asks the LLM for JSON only and parses the result. Always still validate the parsed shape before using it.',
    'Use json(value, fallback), number(value, fallback), text(value, fallback), clamp(value,min,max), words(value), and lines(value) instead of hand-written coercion helpers.',
    'The code must return an object: {outputs:{}, displays:{}, state:{}}.',
    'Use outputs keys matching output ids and displays keys matching display ids.',
    'Always return state, even when unchanged.',
    'State persists between runs and is saved with the workflow, so it can hold counters, flags, and small accumulated data. Display contents are not saved; recompute them each run.',
    'Do not use imports, require, fetch, window, document, globalThis, self, process, eval, Function, the constructor property, XMLHttpRequest, WebSocket, EventSource, network, filesystem, browser APIs, or dynamic code execution.',
    'Those blocked names refer to JavaScript identifiers in code. Ordinary prose inside string literals is fine, for example the word "window" or "process" in a prompt text.',
    '',
    'Allowed connector valueType values: "text", "number", "boolean", "json", "image", "mixed".',
    'Allowed control/display types: "button", "checkbox", "slider", "number-input", "text-input", "textarea", "select", "radio", "meter", "text".',
    'Always set definition.title to a short functional English title when the node purpose is known.',
    'Every id must be lowercase kebab-case or snake_case, stable, unique, and concise.',
    'Connector inputs must have direction "input". Connector outputs must have direction "output".',
    'Inputs are external workflow values. Outputs are values sent back to the workflow. Controls are user-editable settings on the node. Displays are visible status/result boxes on the node.',
    'Image inputs are external workflow image attachments only. Code sees inputs.image_id as safe image metadata, not disk paths or raw files. To send those images to the LLM, use the llm/llmJson request images option.',
    'Use valueType "mixed" for flexible LLM-generated outputs that may be connected to text, number, boolean, or json inputs. Never use mixed for images.',
    'When the user does not explicitly specify connector value types, choose the best logical type yourself.',
    'Prefer concrete input types: text for prose/context, number for numeric values, boolean for true/false switches, json for objects/arrays, image for workflow images.',
    'For outputs, use concrete types when the code validates and normalizes the value before returning it. Use number for normalized numbers, boolean for normalized booleans, json for arrays/objects, and text for known prose strings.',
    'For raw or lightly processed LLM responses, use output valueType "mixed" by default because downstream nodes may parse them as text, number, boolean, or JSON.',
    'For llmJson outputs, use concrete output types if the code validates each field before outputting it; use json when forwarding the full parsed object or array.',
    'If a node computes a value from an input, create an output for that value unless the user explicitly wants display-only behavior.',
    'A display-only Custom Node may have inputs and no outputs; it runs after the main RP output when it has an incoming connection and updates only its displays.',
    'Controls may include value, options, min, max, step, and layout, but visual order is controlled by array order.',
    'select and radio controls fall back to their first option when value is not set; set value explicitly when a different default is wanted.',
    'Non-button controls render full node width. Button controls render two per row by array order, or one alone when only one button is present.',
    'If there are four buttons, they render as a compact 2x2 button grid.',
    'When no special order is requested, group controls in a clean top-to-bottom order: mode/settings controls first, text or number controls next, state buttons if any, run button near the end.',
    'Be sparing with displays. The normal Custom Node shape is inputs, processing code, and outputs with no displays; downstream nodes show the values. Add a display only when the user explicitly asks to see a value on the node itself.',
    'Displays should usually use type "text" and may include text.',
    'Use display type "meter" for a read-only green min/max/current bar. A meter display uses min, max, value, label, and optional text. Runtime code can update it by returning displays: { meter_id: currentValue }.',
    'If the user asks for UI-only behavior, inputs and outputs may be empty arrays.',
    'Buttons do not run code unless action is exactly "run-code".',
    'Custom Nodes run automatically when the workflow reaches their outputs. Do not add a Run button by default.',
    'Use exactly one dedicated run button with {"type":"button","action":"run-code"} only when the user explicitly asks for manual execution or a manual test button.',
    'For mode choices, variants, on/off state, or internal switching, prefer checkbox, select, or radio controls.',
    'If the user explicitly asks for a button that only changes internal state, use action "set-state" or "toggle-state" with stateKey and optional stateValue.',
    'State-changing buttons do not compute outputs immediately; their state is used on the next workflow run or run-code button click.',
    'If the user asks for a result area, create a text display.',
    'Do not rely on absolute layout positioning for ordinary controls; use array order instead.',
    'Use textarea layout.h or a textarea control only when multiline text is useful. Use text-input or number-input for compact single-line input.',
    '',
    'Visual structure in the rendered node is fixed:',
    'Top row: node label and the Customize Node button that opens this assistant.',
    'Next: definition.title as the functional title.',
    'Next: LLM call metrics when available.',
    'Next: LLM Provider selector and Prepare next turn when reached.',
    'Next: all displays in array order, then all controls in array order.',
    'Next: connector inputs.',
    'Next: connector outputs.',
    'Bottom: runtime status text such as Updated via provider or run errors.',
    '',
    'JSON workflow guidance:',
    'Use valueType "json" for connector inputs or outputs that carry objects or arrays.',
    'Use valueType "mixed" for connector outputs that contain free LLM responses whose final downstream type depends on prompting.',
    'When reading JSON inputs, use json(inputs.some_id, fallback) if the input might be a string.',
    'When calling the LLM for structured data, use llmJson(prompt, fallback).',
    'After llmJson, validate arrays with Array.isArray and normalize numbers with number(value, fallback).',
    'For RP/stat updates, preserve existing JSON fields unless the user explicitly asks to replace them.',
    'For sorted or ranked outputs, sort again in JavaScript after the LLM response so the node remains deterministic.',
    'For displays, show a concise readable summary or JSON.stringify(data, null, 2) for debugging.',
    '',
    'Image workflow guidance:',
    'Use valueType "image" only for connector inputs that should receive images from the workflow, usually from User Input image output.',
    'Do not try to read image files, paths, URLs, base64 strings, clipboard data, or disks. Custom Node code cannot access those.',
    'Use await llm({prompt:"Describe the connected image for RP context.", images:true}) for a text response from all connected image inputs.',
    'Use await llm({prompt, images:"image"}) when the image input id is "image". Use images:["front_image","reference_image"] for multiple named image inputs.',
    'Use await llmJson({prompt:"Return {scene:string,mood:string,visible_characters:string[]} from the image only.", images:true}, {scene:"", mood:"", visible_characters:[]}) for structured vision output.',
    '',
    'Prefer small patches for existing nodes. Do not rewrite the whole definition unless the user asks for a full rebuild or many sections must change.',
    'Use "patch" to replace only specific arrays or edit only specific code blocks.',
    'For code edits, prefer codePatches with exact find/replace text from Current definition.code.',
    'If exact find text is not reliable, use code to replace the full code string only.',
    'Do not return both definition and patch.',
    '',
    'Return one of these exact response shapes:',
    '{"reply":"short user-facing answer"}',
    '{"reply":"short user-facing answer","changedFields":["title","inputs","outputs","controls","displays","code"],"definition":{"version":"1.0.0","title":"Short Functional Title","controls":[],"displays":[],"inputs":[],"outputs":[],"state":{},"code":""}}',
    '{"reply":"short user-facing answer","changedFields":["code"],"patch":{"codePatches":[{"find":"exact old code block","replace":"new code block"}]}}',
    '{"reply":"short user-facing answer","changedFields":["title"],"patch":{"title":"Short Functional Title"}}',
    '{"reply":"short user-facing answer","changedFields":["controls"],"patch":{"controls":[]}}',
    '',
    'Example input port:',
    '{"id":"text","direction":"input","valueType":"text","label":"Text"}',
    'Example output port:',
    '{"id":"result","direction":"output","valueType":"number","label":"Count"}',
    'Example image input port:',
    '{"id":"image","direction":"input","valueType":"image","label":"Image Input"}',
    'Example slider control:',
    '{"id":"amount","type":"slider","label":"Amount","value":50,"min":0,"max":100,"step":1,"layout":{"x":12,"y":72,"w":220,"h":40}}',
    'Example run button:',
    '{"id":"run","type":"button","label":"Run","action":"run-code","layout":{"x":12,"y":120,"w":80,"h":36}}',
    'Example radio control:',
    '{"id":"mode","type":"radio","label":"Mode","value":"fast","options":["fast","slow"],"layout":{"x":12,"y":160,"w":220,"h":54}}',
    'Example meter display:',
    '{"id":"capacity","type":"meter","label":"Context Capacity","value":40,"min":0,"max":100,"text":"Current usage"}',
    'Example word-count code:',
    'const text = String(inputs.text ?? controls.text ?? ""); const words = text.trim() ? text.trim().split(/\\s+/) : []; return { outputs: { count: words.length }, displays: { result: `${words.length} words` }, state };',
    'Example text-router code:',
    'return { outputs: { result: inputs.condition ? inputs.text_a : inputs.text_b }, displays: {}, state };',
    'Example LLM code:',
    'const prompt = String(inputs.text ?? controls.prompt ?? ""); const answer = await llm(prompt); return { outputs: { result: answer }, displays: { result: answer }, state };',
    'Example LLM JSON code:',
    'const data = await llmJson(`Sort these numbers ascending and return {"sorted":[number,number,number,number]} only: ${[inputs.a, inputs.b, inputs.c, inputs.d].join(", ")}`, {sorted: []}); const sorted = Array.isArray(data.sorted) ? data.sorted.map((value) => number(value)).sort((a, b) => a - b) : [inputs.a, inputs.b, inputs.c, inputs.d].map((value) => number(value)).sort((a, b) => a - b); return { outputs: { first: sorted[0], second: sorted[1], third: sorted[2], fourth: sorted[3] }, displays: { result: JSON.stringify({sorted}) }, state };',
    'Example image LLM code:',
    'const answer = await llm({ prompt: "Describe the connected image for roleplay context in 2 concise sentences.", images: true }); return { outputs: { description: answer }, displays: { result: answer }, state };',
    'Example image LLM JSON code:',
    'const data = await llmJson({ prompt: "Return JSON only: {mood:string, location:string, visible_details:string[]} based on the connected image.", images: "image" }, {mood:"", location:"", visible_details:[]}); return { outputs: { mood: text(data.mood), location: text(data.location), details: JSON.stringify(Array.isArray(data.visible_details) ? data.visible_details : []) }, displays: { result: JSON.stringify(data, null, 2) }, state };',
    'Example meter update code:',
    'const current = clamp(number(inputs.current ?? controls.current), 0, 100); return { outputs: { value: current }, displays: { capacity: current }, state };',
    'Example code patch:',
    '{"patch":{"codePatches":[{"find":"const text = String(inputs.text ?? controls.text ?? \\"\\");","replace":"const text = String(inputs.text ?? controls.text ?? controls.extra ?? \\"\\");"}]}}',
    '',
    assistantContext
      ? `Recent assistant chat, checks, and errors:\n${assistantContext}`
      : 'Recent assistant chat, checks, and errors: none.',
    '',
    `Current definition:\n${JSON.stringify(currentDefinition, null, 2)}`,
    '',
    `User instruction:\n${instruction}`,
  ].join('\n');
}
