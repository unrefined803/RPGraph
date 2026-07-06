import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { DarkAudioPlayer } from './DarkAudioPlayer';
import { outputFormatHelp, type OutputFormatHelpKind } from '../nodes/output/formatHelp';
import { CustomNodeBody } from '../nodes/custom-node/Card';
import {
  customNodeDefinition,
  type CustomNodeDefinition,
  type CustomNodeElement,
} from '../nodes/custom-node/model';
import {
  outputRuntimePortValues,
  runCustomNodeDefinition,
} from '../nodes/custom-node/runtime';
import {
  defaultRpStorybookCharacterVoiceConfig,
  defaultRpStorybookImageDescriptionPrompt,
  defaultRpStorybookImageDescriptionPromptSettings,
  emptyRpStorybookV1,
  nextStorybookCharacterImageId,
  parseRpStorybookJson,
  rpStorybookFormattedText,
  rpStorybookFormattedTextSettings,
  rpStorybookImageDescriptionPromptSettings,
  rpStorybookImageDescriptionPromptText,
  rpStorybookPhoneContactAllowed,
  rpStorybookPhoneContactCharacters,
  storybookCharacterImageOwnerIdBase,
  withRpStorybookPhoneContactPairBlocked,
  type RpStorybookCharacterComfyConfig,
  type RpStorybookCharacterVoiceConfig,
  type RpStorybookCharacterImage,
  type RpStorybookCharacterProfileImage,
  type RpStorybookFormattedTextSettings,
  type RpStorybookV1,
} from '../nodes/rp-storybook-v1/model';
import { NodeCustomSelect } from '../nodes/shared/NodeCustomSelect';
import { runStateClassName } from '../nodes/shared/CardView';
import { providerOption } from '../nodes/shared/providerHealthLabels';
import {
  configForPromptActionToken,
  parsePromptActionTokens,
  promptActionConfigs,
  type PromptActionConfig,
} from '../nodes/shared/promptActions';
import { JsonSyntaxTextarea } from '../nodes/shared/JsonSyntaxTextarea';
import {
  promptPresetDisplayText,
  promptPresetSource,
  promptSettingForSource,
  type PromptPresetSource,
} from '../nodes/shared/promptPresets';
import { ModelIdPicker } from './ModelIdPicker';
import { comfyCharacterLoraName } from '../settings';
import { isComfyImageConnection, isComfyVoiceConnection } from '../comfy/connectionRole';
import type {
  ChatImageAttachment,
  ConnectionPreset,
  ImageCaptionChange,
  ProviderConnectionHealth,
  SystemLogEntry,
  SystemLogLevel,
  WorkflowNode,
} from '../types';
import { formatContextValue } from '../data-management/formatters';
import { TextMetricsApi } from '../llm/tokenMetrics';
import { sanitizeDataUrls, sanitizeDataUrlsInText } from '../utils/sanitize';
import { normalizeImageAttachment } from '../utils/imageNormalization';
import { copyTextToClipboard } from '../utils/clipboard';
import { formatLogTimestamp } from '../utils/format';
import { CharacterAvatar } from './CharacterAvatar';
import { TurnTraceDialog } from './TurnTraceDialog';
import { useBackdropDismiss } from './useBackdropDismiss';
import type { TurnTrace } from '../app/turnTrace';
import {
  llmPromptSwitchPromptAftersByOutput,
  llmPromptSwitchPromptBeforesByOutput,
} from '../workflow';

export type StorybookCreatorMessage = {
  role: 'user' | 'assistant' | 'error';
  text: string;
};

export type CustomNodeAssistantMessage = {
  role: 'user' | 'assistant' | 'error';
  text: string;
};

export type CustomNodeAssistantDiagnostic = {
  id: string;
  source: string;
  message: string;
  createdAt: number;
  expanded: boolean;
};

const characterLoraFavoritesStorageKey = 'rpgraph.favoriteCharacterLoraModels';
const characterComfyPreviewScenarios = [
  {
    id: 'mirror-selfie',
    label: 'Mirror Selfie',
    prompt: 'stylish mirror selfie, indoor apartment lighting, natural pose, detailed face and outfit',
  },
  {
    id: 'beach-bikini',
    label: 'Beach Bikini',
    prompt: 'standing on a sunny beach in a bikini, soft daylight, ocean background, full body',
  },
  {
    id: 'neon-alley',
    label: 'Neon Alley Portrait',
    prompt: 'cinematic neon alley portrait at night, rain reflections, fashionable streetwear, dramatic rim light',
  },
] as const;

export type RunLlmCallReport = {
  id: string;
  order: number;
  nodeId: string;
  nodeLabel: string;
  label: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  durationMs: number;
  startedAtMs?: number;
};

export type RunLlmReport = {
  runId: string;
  startedAt: string;
  calls: RunLlmCallReport[];
};

export type LlmRunHistoryEntry = {
  report: RunLlmReport;
  durationMs: number;
};

function formatRuntimeSeconds(durationMs: number) {
  return (durationMs / 1000).toFixed(2);
}

function tokenCell(value: number | undefined) {
  return value === undefined ? '-' : value.toLocaleString();
}

function callTotalTokens(call: RunLlmCallReport) {
  return call.totalTokens ?? (call.inputTokens ?? 0) + (call.outputTokens ?? 0);
}

function runLlmReportTotals(report: RunLlmReport) {
  return report.calls.reduce(
    (totals, call) => ({
      inputTokens: totals.inputTokens + (call.inputTokens ?? 0),
      outputTokens: totals.outputTokens + (call.outputTokens ?? 0),
      reasoningTokens: totals.reasoningTokens + (call.reasoningTokens ?? 0),
      hasReasoningTokens: totals.hasReasoningTokens || call.reasoningTokens !== undefined,
      totalTokens: totals.totalTokens + callTotalTokens(call),
      durationMs: totals.durationMs + call.durationMs,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      hasReasoningTokens: false,
      totalTokens: 0,
      durationMs: 0,
    },
  );
}

export function RunLlmReportDialog({
  currentReport,
  currentDurationMs,
  history,
  isRunning,
  onClose,
}: {
  currentReport: RunLlmReport;
  currentDurationMs: number;
  history: LlmRunHistoryEntry[];
  isRunning: boolean;
  onClose: () => void;
}) {
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onClose);
  const currentTotals = runLlmReportTotals(currentReport);

  const renderRunCard = (title: string, report: RunLlmReport | undefined, durationMs: number | undefined, isCurrent = false) => {
    const totals = report ? runLlmReportTotals(report) : null;
    
    return (
      <div className={`run-llm-card ${isCurrent ? 'current' : ''}`}>
        <div className="run-llm-card-header">
          <h4>{title}</h4>
          {isCurrent && isRunning && <span className="run-llm-card-badge">Running</span>}
        </div>
        <div className="run-llm-card-body">
          <div className="run-llm-card-row">
            <span className="run-llm-card-label">Duration</span>
            <span className="run-llm-card-value font-mono">
              {durationMs !== undefined ? `${formatRuntimeSeconds(durationMs)} s` : '-'}
            </span>
          </div>
          <div className="run-llm-card-row">
            <span className="run-llm-card-label">LLM Calls</span>
            <span className="run-llm-card-value">
              {report ? report.calls.length : '-'}
            </span>
          </div>
          <div className="run-llm-card-row">
            <span className="run-llm-card-label">Input Tokens</span>
            <span className="run-llm-card-value font-mono">
              {totals ? tokenCell(totals.inputTokens) : '-'}
            </span>
          </div>
          <div className="run-llm-card-row">
            <span className="run-llm-card-label">Output Tokens</span>
            <span className="run-llm-card-value font-mono">
              {totals ? tokenCell(totals.outputTokens) : '-'}
            </span>
          </div>
          <div className="run-llm-card-row">
            <span className="run-llm-card-label">RSN Tokens</span>
            <span className="run-llm-card-value font-mono">
              {totals ? tokenCell(totals.hasReasoningTokens ? totals.reasoningTokens : undefined) : '-'}
            </span>
          </div>
          <div className="run-llm-card-row">
            <span className="run-llm-card-label">Total Tokens</span>
            <span className="run-llm-card-value font-mono font-bold">
              {totals ? tokenCell(totals.totalTokens) : '-'}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="dialog-backdrop" role="presentation" {...backdropDismiss}>
      <section
        className="run-llm-report-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-llm-report-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <div>
            <h2 id="run-llm-report-title">LLM Runtime</h2>
            <p>
              Overview and call history comparison.
            </p>
          </div>
          <button className="close-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="run-llm-report-body">
          <div className="run-llm-report-comparison-section">
            <h3 className="run-llm-report-section-title">Overview Comparison</h3>
            <div className="run-llm-cards-grid">
              {renderRunCard("Current Run", currentReport, currentDurationMs, true)}
              {renderRunCard("Last Run", history[0]?.report, history[0]?.durationMs)}
              {renderRunCard("2 Runs Ago", history[1]?.report, history[1]?.durationMs)}
              {renderRunCard("3 Runs Ago", history[2]?.report, history[2]?.durationMs)}
            </div>
          </div>

          <div className="run-llm-report-details-section">
            <h3 className="run-llm-report-section-title">
              {isRunning ? 'Current Run Details' : 'Last Completed Run Details'}
            </h3>
            {currentReport.calls.length === 0 ? (
              <p className="run-llm-report-empty">No LLM calls recorded for this run yet.</p>
            ) : (
              <table className="run-llm-report-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Node</th>
                    <th>Call</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>RSN</th>
                    <th>Total</th>
                    <th>Seconds</th>
                  </tr>
                </thead>
                <tbody>
                  {currentReport.calls.map((call) => (
                    <tr key={call.id}>
                      <td>{call.order}</td>
                      <td title={call.nodeId}>{call.nodeLabel}</td>
                      <td>{call.label}</td>
                      <td>{tokenCell(call.inputTokens)}</td>
                      <td>{tokenCell(call.outputTokens)}</td>
                      <td>{tokenCell(call.reasoningTokens)}</td>
                      <td>{tokenCell(callTotalTokens(call))}</td>
                      <td>{formatRuntimeSeconds(call.durationMs)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td></td>
                    <td>Total</td>
                    <td></td>
                    <td>{currentTotals.inputTokens.toLocaleString()}</td>
                    <td>{currentTotals.outputTokens.toLocaleString()}</td>
                    <td>{tokenCell(currentTotals.hasReasoningTokens ? currentTotals.reasoningTokens : undefined)}</td>
                    <td>{currentTotals.totalTokens.toLocaleString()}</td>
                    <td>{formatRuntimeSeconds(currentTotals.durationMs)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function updatePreviewControlValue(
  definition: CustomNodeDefinition,
  controlId: string,
  value: unknown,
): CustomNodeDefinition {
  return {
    ...definition,
    controls: definition.controls.map((control) =>
      control.id === controlId ? { ...control, value } : control,
    ),
  };
}

const customNodePromptSuggestions = [
  {
    title: 'Scene Mood Extractor',
    prompt: [
      'Build a Custom Node that reads a roleplay scene and extracts its mood.',
      'Use one text input named scene_text and call llmJson to return {"mood":"string","tension":0} where tension is from 0 to 10.',
      'Clamp tension between 0 and 10 in code.',
      'Create a text output mood and a number output tension. No displays.',
    ].join('\n'),
  },
  {
    title: 'Tone Rewriter',
    prompt: [
      'Build a Custom Node that rewrites incoming roleplay text in a selected tone.',
      'Use one text input named source_text and a select control named tone with options darker, softer, romantic, threatening, and comedic.',
      'Use llm to rewrite the text in the selected tone while keeping character facts and scene continuity intact.',
      'Create one text output rewritten_text. No displays, no buttons.',
    ].join('\n'),
  },
  {
    title: 'Text Shortener',
    prompt: [
      'Build a Custom Node that shortens long roleplay text.',
      'Use one text input named long_text and a slider control named max_sentences from 1 to 8.',
      'Use llm to compress the text to at most the selected number of sentences while keeping names and key facts.',
      'Create one text output short_text. No displays.',
    ].join('\n'),
  },
  {
    title: 'Dialogue Extractor',
    prompt: [
      'Build a Custom Node that pulls only the spoken dialogue out of mixed roleplay text.',
      'Use one text input named scene_text and call llm to return only the spoken lines, one per line, without narration or actions.',
      'Create one text output dialogue_text. No displays.',
    ].join('\n'),
  },
  {
    title: 'Continuity Checker',
    prompt: [
      'Build a Custom Node that checks new scene text against existing roleplay memory.',
      'Use two text inputs: memory_context and new_scene_text. Call llmJson to return {"has_conflict":false,"summary":"string"}.',
      'Create a boolean output has_conflict and a text output summary. No displays.',
    ].join('\n'),
  },
  {
    title: 'NPC Reaction Generator',
    prompt: [
      'Build a Custom Node that writes a short npc reaction to a character action.',
      'Use two text inputs: character_action and npc_profile.',
      'Use llm to write a two to three sentence reaction that fits the npc profile.',
      'Create one text output reaction. No displays.',
    ].join('\n'),
  },
  {
    title: 'Relationship Score Tracker',
    prompt: [
      'Build a Custom Node that tracks a running relationship score across turns.',
      'Use one text input named scene_exchange. Call llmJson to return {"delta":0,"reason":"string"} where delta is from -5 to 5.',
      'Keep the running score in state, add the clamped delta on every workflow run, and clamp the total between -100 and 100.',
      'Create a number output score and a text output reason.',
      'Add one button that only resets the stored score state back to 0. Do not add a Run button.',
    ].join('\n'),
  },
  {
    title: 'Memory Compressor',
    prompt: [
      'Build a Custom Node that compresses long roleplay history into short memory bullets.',
      'Use one text input named long_history and a slider control named max_bullets from 3 to 10.',
      'Use llmJson to return {"memory_bullets":["string"]} with at most the selected number of bullets.',
      'Join the bullets into one plain text list in code and create one text output memory_text. No displays.',
    ].join('\n'),
  },
  {
    title: 'Word Counter',
    prompt: [
      'Build a Custom Node that counts words without any LLM call.',
      'Use one text input named input_text.',
      'In code, count the words and characters.',
      'Create a number output word_count and a number output char_count. No displays, no buttons.',
    ].join('\n'),
  },
  {
    title: 'Style Instruction Picker',
    prompt: [
      'Build a Custom Node that outputs a writing style instruction without any LLM call.',
      'Use no inputs. Add a select control named style with options cinematic, slow burn, action heavy, dark, and lighthearted.',
      'In code, map the selected style to a short instruction sentence for the story LLM.',
      'Create one text output style_instruction. No displays.',
    ].join('\n'),
  },
];

type CustomNodeAssistantDialogProps = {
  node: WorkflowNode;
  connections: ConnectionPreset[];
  defaultConnectionId: string;
  messages: CustomNodeAssistantMessage[];
  diagnostics: CustomNodeAssistantDiagnostic[];
  onSubmit: (message: string, connectionId: string) => Promise<void>;
  onStructureCheck: () => void;
  onSecurityCheck: (connectionId: string) => Promise<void>;
  onApplyDefinitionText: (text: string) => void;
  onToggleDiagnostic: (diagnosticId: string) => void;
  onDismissDiagnostic: (diagnosticId: string) => void;
  onClearChat: () => void;
  onReset: () => void;
  onClose: () => void;
};

export function CustomNodeAssistantDialog({
  node,
  connections,
  defaultConnectionId,
  messages,
  diagnostics,
  onSubmit,
  onStructureCheck,
  onSecurityCheck,
  onApplyDefinitionText,
  onToggleDiagnostic,
  onDismissDiagnostic,
  onClearChat,
  onReset,
  onClose,
}: CustomNodeAssistantDialogProps) {
  const [draft, setDraft] = useState('');
  const [viewMode, setViewMode] = useState<'ui' | 'code' | 'edit'>('ui');
  const llmConnections = connections.filter((connection) => connection.kind !== 'comfyui');
  const fallbackConnectionId = defaultConnectionId || llmConnections[0]?.id || '';
  const [selectedConnectionId, setSelectedConnectionId] = useState(
    [node.data.connectionId, fallbackConnectionId].find((connectionId) =>
      connectionId && llmConnections.some((connection) => connection.id === connectionId),
    ) ?? fallbackConnectionId,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingSecurity, setIsCheckingSecurity] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [editCodeDraft, setEditCodeDraft] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [previewZoom, setPreviewZoom] = useState(0.82);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const previewDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const definition = useMemo(
    () => customNodeDefinition(node.data.customNodeDefinition),
    [node.data.customNodeDefinition],
  );
  const customNodeIsEmpty =
    !definition.code.trim() &&
    definition.inputs.length === 0 &&
    definition.outputs.length === 0 &&
    definition.controls.length === 0;
  const [previewDefinition, setPreviewDefinition] = useState<CustomNodeDefinition>(definition);
  const [previewDisplays, setPreviewDisplays] = useState<Record<string, string>>({});
  const [previewRuntimePortValues, setPreviewRuntimePortValues] = useState<Record<string, string>>({});
  const [previewStatus, setPreviewStatus] = useState(node.data.preview);
  const connectionOptions = llmConnections.map((connection) => ({
    value: connection.id,
    label: connection.label,
  }));
  const definitionJson = JSON.stringify(definition, null, 2);
  const definitionMetadataJson = JSON.stringify({
    ...definition,
    code: undefined,
  }, null, 2);
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onClose);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) {
        return;
      }
      setPreviewDefinition(definition);
      setPreviewDisplays({});
      setPreviewRuntimePortValues({});
      setPreviewStatus(node.data.preview);
      setEditDraft(definitionMetadataJson);
      setEditCodeDraft(definition.code);
      setEditStatus('');
    });
    return () => {
      active = false;
    };
  }, [definition, definitionMetadataJson, node.data.preview]);

  function submit(event: FormEvent) {
    event.preventDefault();
    submitDraft();
  }

  function submitDraft() {
    const message = draft.trim();
    if (!message || isSubmitting) {
      return;
    }
    setDraft('');
    setIsSubmitting(true);
    void onSubmit(message, selectedConnectionId).finally(() => setIsSubmitting(false));
  }

  function zoomPreview(change: number) {
    setPreviewZoom((current) => Math.min(1.4, Math.max(0.35, Number((current + change).toFixed(2)))));
  }

  function resetPreviewTransform() {
    setPreviewZoom(0.82);
    setPreviewPan({ x: 0, y: 0 });
  }

  function checkCodeSecurity() {
    if (isCheckingSecurity) {
      return;
    }
    setIsCheckingSecurity(true);
    void onSecurityCheck(selectedConnectionId).finally(() => setIsCheckingSecurity(false));
  }

  async function copyDefinition() {
    setMoreOpen(false);
    await copyTextToClipboard(definitionJson);
  }

  async function pasteDefinition() {
    setMoreOpen(false);
    try {
      const text = await navigator.clipboard.readText();
      onApplyDefinitionText(text);
    } catch (error) {
      setEditStatus(`Paste failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function applyEditedDefinition() {
    let parsedDefinition: unknown;
    try {
      parsedDefinition = JSON.parse(editDraft);
    } catch (error) {
      setEditStatus(`JSON failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    if (!parsedDefinition || typeof parsedDefinition !== 'object' || Array.isArray(parsedDefinition)) {
      setEditStatus('JSON failed: Definition must be an object.');
      return;
    }

    const parsedRecord = parsedDefinition as Record<string, unknown>;
    // A full definition pasted into the JSON pane keeps its own code; the
    // Runtime Code pane only fills in when the JSON has no code field.
    const mergedCode = typeof parsedRecord.code === 'string' ? parsedRecord.code : editCodeDraft;
    onApplyDefinitionText(JSON.stringify({
      ...parsedRecord,
      code: mergedCode,
    }, null, 2));
    setEditStatus('Applied.');
  }

  function resetDefinition() {
    setMoreOpen(false);
    onReset();
  }

  function changePreviewControl(controlId: string, value: unknown) {
    setPreviewDefinition((current) => updatePreviewControlValue(current, controlId, value));
    setPreviewStatus('Preview value changed');
  }

  function clickPreviewStateButton(control: CustomNodeElement) {
    setPreviewDefinition((current) => {
      if (!control.action || control.action === 'run-code' || !control.stateKey) {
        return current;
      }
      const state = { ...current.state };
      if (control.action === 'toggle-state') {
        state[control.stateKey] = !state[control.stateKey];
      } else {
        state[control.stateKey] = control.stateValue ?? true;
      }
      return { ...current, state };
    });
    setPreviewStatus(control.stateKey ? `${control.label} changed preview state` : `${control.label} clicked`);
  }

  async function runPreviewCode(label: string) {
    setPreviewStatus(`${label} preview running ...`);
    try {
      const result = await runCustomNodeDefinition(previewDefinition, {}, {
        llm: async (request) => {
          const prompt = typeof request === 'string' ? request : request.prompt;
          return JSON.stringify({
            preview: true,
            prompt,
            sorted: [1, 2, 3, 4],
          });
        },
      });
      setPreviewDefinition((current) => ({ ...current, state: result.state }));
      setPreviewDisplays(result.displays);
      setPreviewRuntimePortValues((current) => outputRuntimePortValues(result.outputs, current));
      setPreviewStatus(`${label} preview ran`);
    } catch (error) {
      setPreviewStatus(`Preview failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function shouldStartPreviewPan(target: EventTarget | null) {
    return target instanceof HTMLElement && !target.closest('input, textarea, select, button, label, .nodrag');
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <section className="storybook-creator-dialog custom-node-assistant-dialog" role="dialog" aria-modal="true" aria-label="Custom Node Assistant">
        <div className="dialog-header storybook-creator-header">
          <div className="storybook-title-row">
            <h2>Custom Node Assistant</h2>
            <p>Custom Node · build controls, ports, displays, and code</p>
          </div>
          <div className="storybook-header-actions custom-node-assistant-header-actions">
            <button className="inspect-button nodrag" type="button" onClick={onStructureCheck}>
              Structure Check
            </button>
            <button className="inspect-button nodrag" type="button" onClick={checkCodeSecurity} disabled={isCheckingSecurity}>
              {isCheckingSecurity ? 'Reviewing...' : 'Security Review'}
            </button>
            <button
              className="inspect-button nodrag"
              type="button"
              onClick={onClearChat}
              disabled={messages.length === 0 && diagnostics.length === 0}
            >
              Delete Chat
            </button>
            <div className="storybook-more-menu custom-node-more-menu">
              <button
                className="inspect-button storybook-more-button nodrag"
                type="button"
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                onClick={() => setMoreOpen((current) => !current)}
              >
                More
              </button>
              {moreOpen && (
                <div className="storybook-more-popover" role="menu">
                  <button type="button" role="menuitem" onClick={resetDefinition}>
                    Reset
                  </button>
                  <button type="button" role="menuitem" onClick={() => void copyDefinition()}>
                    Copy Code
                  </button>
                  <button type="button" role="menuitem" onClick={() => void pasteDefinition()}>
                    Paste Code
                  </button>
                </div>
              )}
            </div>
            <div className="custom-node-assistant-provider">
              <label htmlFor="custom-node-assistant-provider">Provider</label>
              <NodeCustomSelect
                id="custom-node-assistant-provider"
                value={selectedConnectionId}
                onChange={setSelectedConnectionId}
                options={connectionOptions}
              />
            </div>
            <button type="button" className="close-button danger" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="storybook-creator-body">
          <div className="storybook-main-workspace">
            <div className="storybook-document-panel custom-node-preview-panel">
              <div className="storybook-panel-header">
                <span className="panel-title">Custom Node Preview</span>
                <div className="custom-node-preview-tools">
                  {viewMode === 'ui' && (
                    <div className="custom-node-zoom-controls" aria-label="Preview zoom controls">
                      <button type="button" className="tab-button" onClick={() => zoomPreview(-0.1)}>−</button>
                      <span>{Math.round(previewZoom * 100)}%</span>
                      <button type="button" className="tab-button" onClick={() => zoomPreview(0.1)}>+</button>
                      <button type="button" className="tab-button" onClick={resetPreviewTransform}>Reset</button>
                    </div>
                  )}
                  <div className="storybook-tabs">
                    <button
                      type="button"
                      className={`tab-button ${viewMode === 'ui' ? 'active' : ''}`}
                      onClick={() => setViewMode('ui')}
                    >
                      UI Preview
                    </button>
                    <button
                      type="button"
                      className={`tab-button ${viewMode === 'code' ? 'active' : ''}`}
                      onClick={() => setViewMode('code')}
                    >
                      Code Preview
                    </button>
                    <button
                      type="button"
                      className={`tab-button ${viewMode === 'edit' ? 'active' : ''}`}
                      onClick={() => setViewMode('edit')}
                    >
                      JSON Edit
                    </button>
                  </div>
                </div>
              </div>

              <div className="storybook-panel-content">
                {viewMode === 'code' && (
                  <div className="custom-node-readable-code-panel">
                    <section className="custom-node-readable-section">
                      <div className="custom-node-readable-heading">Definition</div>
                      <JsonSyntaxTextarea readOnly value={definitionMetadataJson} wrap="soft" />
                    </section>
                    <section className="custom-node-readable-section custom-node-readable-code-section">
                      <div className="custom-node-readable-heading">Runtime Code</div>
                      <textarea
                        className="custom-node-runtime-code-editor"
                        value={definition.code.trim() || '// No runtime code yet.'}
                        readOnly
                        spellCheck={false}
                        wrap="soft"
                      />
                    </section>
                  </div>
                )}

                {viewMode === 'edit' && (
                  <div className="storybook-json-panel custom-node-code-panel custom-node-edit-panel">
                    <div className="custom-node-readable-code-panel custom-node-edit-split-panel">
                      <section className="custom-node-readable-section">
                        <div className="custom-node-readable-heading">Definition JSON</div>
                        <JsonSyntaxTextarea
                          value={editDraft}
                          onChange={(val) => setEditDraft(val)}
                          wrap="soft"
                        />
                      </section>
                      <section className="custom-node-readable-section custom-node-readable-code-section">
                        <div className="custom-node-readable-heading">Runtime Code</div>
                        <textarea
                          className="custom-node-runtime-code-editor"
                          value={editCodeDraft}
                          onChange={(event) => setEditCodeDraft(event.target.value)}
                          spellCheck={false}
                          wrap="soft"
                        />
                      </section>
                    </div>
                    <div className="custom-node-edit-actions">
                      <span className="run-note">{editStatus || 'Edit the definition or runtime code, then apply it.'}</span>
                      <button className="inspect-button nodrag" type="button" onClick={applyEditedDefinition}>
                        Apply JSON
                      </button>
                    </div>
                  </div>
                )}

                {viewMode === 'ui' && (
                  <div
                    className="storybook-ui-view custom-node-ui-preview"
                    onWheel={(event) => {
                      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, .nodrag')) {
                        return;
                      }
                      if (!event.ctrlKey && !event.metaKey) {
                        return;
                      }
                      event.preventDefault();
                      zoomPreview(event.deltaY > 0 ? -0.06 : 0.06);
                    }}
                    onMouseDown={(event) => {
                      if (event.button !== 0 || !shouldStartPreviewPan(event.target)) {
                        return;
                      }
                      previewDragRef.current = {
                        startX: event.clientX,
                        startY: event.clientY,
                        originX: previewPan.x,
                        originY: previewPan.y,
                      };
                    }}
                    onMouseMove={(event) => {
                      const drag = previewDragRef.current;
                      if (!drag) {
                        return;
                      }
                      setPreviewPan({
                        x: drag.originX + event.clientX - drag.startX,
                        y: drag.originY + event.clientY - drag.startY,
                      });
                    }}
                    onMouseUp={() => {
                      previewDragRef.current = null;
                    }}
                    onMouseLeave={() => {
                      previewDragRef.current = null;
                    }}
                  >
                    <div
                      className={`workflow-node custom-node custom-node-preview-card${runStateClassName(node.data)}`}
                      style={{
                        transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${previewZoom})`,
                      }}
                    >
                      <CustomNodeBody
                        data={{
                          ...node.data,
                          connectionId: selectedConnectionId,
                          preview: previewStatus,
                          runtimePortValues: previewRuntimePortValues,
                          customNodeRuntimeDisplays: previewDisplays,
                        }}
                        definition={previewDefinition}
                        connectionElement={(
                          <>
                            <label className="node-field-label">LLM PROVIDER</label>
                            <NodeCustomSelect
                              id={`${node.id}-assistant-preview-provider`}
                              value={selectedConnectionId}
                              onChange={setSelectedConnectionId}
                              options={connectionOptions}
                            />
                          </>
                        )}
                        postConnectionElement={(
                          <div className="post-output-toggle-row">
                            <label className="node-toggle post-output-toggle nodrag">
                              <input
                                className="nodrag nowheel"
                                type="checkbox"
                                checked={node.data.runAfterRpOutput ?? false}
                                readOnly
                              />
                              Prepare next turn when reached
                            </label>
                          </div>
                        )}
                        renderHandles={false}
                        onControlChange={changePreviewControl}
                        onGeneratedButtonClick={(label) => void runPreviewCode(label)}
                        onStateButtonClick={clickPreviewStateButton}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="storybook-chat-panel">
              <div className="storybook-chat-header">
                <span className="panel-title">Node Assistant</span>
                <span className="panel-subtitle">
                  {customNodeIsEmpty
                    ? 'Describe the node you want. The assistant will later generate a checked definition.'
                    : 'Ask questions, describe changes, or paste an error you want fixed.'}
                </span>
              </div>

              {diagnostics.length > 0 && (
                <div className="custom-node-diagnostics" aria-label="Custom Node diagnostics">
                  {diagnostics.map((diagnostic) => (
                    <div className="custom-node-diagnostic" key={diagnostic.id}>
                      <div className="custom-node-diagnostic-row">
                        <button
                          className="custom-node-diagnostic-toggle"
                          type="button"
                          onClick={() => onToggleDiagnostic(diagnostic.id)}
                          aria-expanded={diagnostic.expanded}
                        >
                          <span aria-hidden="true">{diagnostic.expanded ? 'v' : '>'}</span>
                          <strong>{diagnostic.source}</strong>
                        </button>
                        <button
                          className="custom-node-diagnostic-dismiss"
                          type="button"
                          onClick={() => onDismissDiagnostic(diagnostic.id)}
                          aria-label={`Dismiss ${diagnostic.source}`}
                        >
                          x
                        </button>
                      </div>
                      {diagnostic.expanded && (
                        <pre>{diagnostic.message}</pre>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="storybook-chat-log">
                {messages.length === 0 ? (
                  customNodeIsEmpty ? (
                    <div className="chat-empty-state">
                      <div className="assistant-avatar-large">AI</div>
                      <p className="empty-title">Build a Custom Node</p>
                      <p className="empty-description">
                        Ask for simple text, number, UI, routing, or LLM helper behavior.
                      </p>
                      <ul className="prompt-suggestions custom-node-prompt-suggestions">
                        {customNodePromptSuggestions.map((suggestion) => (
                          <li key={suggestion.title} onClick={() => setDraft(suggestion.prompt)}>
                            <span className="prompt-suggestion-copy">
                              <strong>{suggestion.title}</strong>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="chat-message-row assistant custom-node-ready-message">
                      <div className="message-sender-avatar">AI</div>
                      <div className="chat-message-bubble">
                        <p>
                          This Custom Node already has a definition. Ask me how it works, tell me what to change, or use the diagnostics above if a workflow run failed.
                        </p>
                      </div>
                    </div>
                  )
                ) : (
                  messages.map((message, index) => (
                    <div className={`chat-message-row ${message.role}`} key={`${message.role}-${index}`}>
                      <div className="message-sender-avatar">
                        {message.role === 'user' ? 'U' : message.role === 'assistant' ? 'AI' : '!'}
                      </div>
                      <div className="chat-message-bubble">
                        <p>{message.text}</p>
                      </div>
                    </div>
                  ))
                )}
                {isSubmitting && (
                  <div className="chat-message-row assistant thinking">
                    <div className="message-sender-avatar">AI</div>
                    <div className="chat-message-bubble typing-bubble">
                      <div className="typing-indicator">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <form className="storybook-chat-form" onSubmit={submit}>
                <textarea
                  className="nodrag nowheel"
                  rows={4}
                  value={draft}
                  placeholder={customNodeIsEmpty ? 'Describe the Custom Node you want...' : 'Ask a question or describe the change you want...'}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      submitDraft();
                    }
                  }}
                />
                <button type="submit" className="send-message-button" disabled={isSubmitting || !draft.trim()}>
                  {isSubmitting ? 'Sending...' : 'Send'}
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

type StorybookCreatorDialogProps = {
  node: WorkflowNode;
  workflowNodes: WorkflowNode[];
  messages: StorybookCreatorMessage[];
  isSubmitting: boolean;
  connections: ConnectionPreset[];
  providerHealthById: Record<string, ProviderConnectionHealth>;
  onSubmit: (message: string) => Promise<void>;
  onLoad: () => Promise<boolean>;
  onSaveStorybook: () => void;
  promptTextCustomPresets: Record<string, string>;
  setPromptTextCustomPresets: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  usedImageIds: ReadonlySet<string>;
  imageCaptionChangesById: ReadonlyMap<string, ImageCaptionChange[]>;
  onUpdateStorybook: (storybook: RpStorybookV1, status?: string) => void;
  onChangeImageCaptionUpdate: (change: ImageCaptionChange, caption: string) => void;
  onUpdateFormattedTextSettings: (settings: RpStorybookFormattedTextSettings) => void;
  onDescribeCharacterImage: (
    characterContext: string,
    image: RpStorybookCharacterImage,
    prompt: string,
  ) => Promise<string>;
  onLoadCharacterComfyLoras: (providerId: string) => Promise<string[]>;
  onGenerateCharacterComfyPreview: (request: {
    providerId: string;
    characterName: string;
    characterContext: string;
    loraName: string;
    appearance: string;
    scenarioPrompt: string;
  }) => Promise<Array<{ dataUrl: string; filename: string }>>;
  onGenerateCharacterVoicePreview: (request: {
    providerId: string;
    speechText: string;
    sampleDataUrl: string;
  }) => Promise<Array<{ dataUrl: string; filename: string }>>;
  onUnloadCharacterComfyModels: (providerId: string) => Promise<void>;
  onImportOpeningHistory: () => void;
  onClearOpeningHistory: () => void;
  onResetStorybook: () => void;
  onImportSillyTavernCharacter: () => Promise<void>;
  onClose: () => void;
};

const storybookFormattedTextSettingControls: Array<{
  key: keyof RpStorybookFormattedTextSettings;
  label: string;
}> = [
  { key: 'title', label: 'Title' },
  { key: 'introduction', label: 'Intro' },
  { key: 'scenario', label: 'Scenario' },
  { key: 'characters', label: 'Charakter' },
  { key: 'openingHistory', label: 'Opening History' },
  { key: 'characterImages', label: 'Character Images' },
];

type StorybookImageOwner = { kind: 'character'; characterId: string };
type CharacterImagesDialogMode = 'images' | 'profile';
type ProfileCrop = RpStorybookCharacterProfileImage['crop'];

function storybookImageOwnerKey(owner: StorybookImageOwner) {
  return `character:${owner.characterId}`;
}

function storybookImageOwnerName(storybook: RpStorybookV1, owner: StorybookImageOwner) {
  const character = storybook.characters.find((entry) => entry.id === owner.characterId);
  return character?.name || character?.id || 'Character';
}

function storybookImageOwnerContext(storybook: RpStorybookV1, owner: StorybookImageOwner) {
  const character = storybook.characters.find((entry) => entry.id === owner.characterId);
  if (!character) {
    return `Name: ${storybookImageOwnerName(storybook, owner)}`;
  }
  return [
    character.name ? `Name: ${character.name}` : '',
    character.description ? `Description: ${character.description}` : '',
    character.personality ? `Personality: ${character.personality}` : '',
    character.speechStyle ? `Speech Style: ${character.speechStyle}` : '',
    character.role ? `Role: ${character.role}` : '',
  ].filter(Boolean).join('\n') || `Name: ${storybookImageOwnerName(storybook, owner)}`;
}

function storybookImageOwnerImages(storybook: RpStorybookV1, owner: StorybookImageOwner) {
  return storybook.characters.find((character) => character.id === owner.characterId)?.images ?? [];
}

function withStorybookImageOwnerImages(
  storybook: RpStorybookV1,
  owner: StorybookImageOwner,
  images: RpStorybookCharacterImage[],
): RpStorybookV1 {
  return {
    ...storybook,
    characters: storybook.characters.map((character) =>
      character.id === owner.characterId
        ? {
            ...character,
            ...(character.profileImage && !images.some((image) => image.id === character.profileImage?.imageId)
              ? { profileImage: undefined }
              : {}),
            images,
          }
        : character
    ),
  };
}

function withStorybookCharacterProfileImage(
  storybook: RpStorybookV1,
  owner: StorybookImageOwner,
  profileImage: RpStorybookCharacterProfileImage,
): RpStorybookV1 {
  return {
    ...storybook,
    characters: storybook.characters.map((character) =>
      character.id === owner.characterId ? { ...character, profileImage } : character
    ),
  };
}

function storybookImageOwnerProfileImage(storybook: RpStorybookV1, owner: StorybookImageOwner) {
  return storybook.characters.find((character) => character.id === owner.characterId)?.profileImage;
}

function storybookCharacterComfyConfig(storybook: RpStorybookV1, characterId: string) {
  return storybook.characters.find((character) => character.id === characterId)?.comfyConfig ?? {
    loraName: '',
    loraUrl: '',
    appearance: '',
  };
}

function storybookCharacterComfyConfigured(character: { comfyConfig?: RpStorybookCharacterComfyConfig }) {
  return Boolean(
    character.comfyConfig?.appearance.trim() ||
    character.comfyConfig?.loraName.trim(),
  );
}

function usedCreateImagePromptActions(nodes: WorkflowNode[]) {
  return nodes.flatMap((node): PromptActionConfig[] => {
    if (
      node.data.kind !== undefined ||
      (node.data.nodeType !== 'llm-prompt' && node.data.nodeType !== 'llm-prompt-switch')
    ) {
      return [];
    }
    const actionConfigs = promptActionConfigs(node.data.llmPromptActions);
    const promptTexts = node.data.nodeType === 'llm-prompt'
      ? [node.data.llmPromptBefore ?? '', node.data.llmPromptAfter ?? '']
      : [
          ...llmPromptSwitchPromptBeforesByOutput(node.data).flat(),
          ...llmPromptSwitchPromptAftersByOutput(node.data).flat(),
        ];
    return promptTexts
      .flatMap((text) => parsePromptActionTokens(text))
      .map((token) => configForPromptActionToken(actionConfigs, token.title))
      .filter((action) => action.actionId === 'createImage');
  });
}

function storybookCharacterComfyStatus({
  character,
  createImageActions,
  connections,
  providerHealthById,
}: {
  character: { name?: string; comfyConfig?: RpStorybookCharacterComfyConfig };
  createImageActions: PromptActionConfig[];
  connections: ConnectionPreset[];
  providerHealthById: Record<string, ProviderConnectionHealth>;
}) {
  const characterConfigured = storybookCharacterComfyConfigured(character);
  if (!characterConfigured) {
    return {
      active: false,
      text: 'ComfyUI character generation is not configured for this character.',
    };
  }
  if (createImageActions.length === 0) {
    return {
      active: false,
      text: 'This function is not used because the workflow does not call a Create character phone image action.',
    };
  }
  const selectedProviderIds = Array.from(new Set(
    createImageActions
      .map((action) => action.comfyProviderId?.trim() ?? '')
      .filter(Boolean),
  ));
  if (selectedProviderIds.length === 0) {
    return {
      active: false,
      text: 'This function is not used because no ComfyUI provider is selected in the Create character phone image action.',
    };
  }
  const comfyProviderIds = new Set(connections.filter(isComfyImageConnection).map((connection) => connection.id));
  const missingProvider = selectedProviderIds.find((providerId) => !comfyProviderIds.has(providerId));
  if (missingProvider) {
    return {
      active: false,
      text: 'This function is not used because the selected ComfyUI provider is no longer available.',
    };
  }
  const healthValues = selectedProviderIds.map((providerId) => providerHealthById[providerId]);
  if (healthValues.some((health) => health?.status === 'online')) {
    return {
      active: true,
      text: 'This character setup is used by the workflow Create character phone image action.',
    };
  }
  if (healthValues.some((health) => health?.status === 'checking' || health?.status === 'unknown')) {
    return {
      active: false,
      text: 'This function is not used yet because the selected ComfyUI provider has not been checked.',
    };
  }
  if (healthValues.some((health) => health?.status === 'warning')) {
    return {
      active: false,
      text: 'This function is not used yet because the selected ComfyUI provider setup is incomplete.',
    };
  }
  return {
    active: false,
    text: 'This function is not used because ComfyUI is offline.',
  };
}

function withStorybookCharacterComfyConfig(
  storybook: RpStorybookV1,
  characterId: string,
  comfyConfig: RpStorybookCharacterComfyConfig,
): RpStorybookV1 {
  return {
    ...storybook,
    characters: storybook.characters.map((character) =>
      character.id === characterId
        ? { ...character, comfyConfig }
        : character
    ),
  };
}

function storybookCharacterVoiceConfig(
  storybook: RpStorybookV1,
  characterId: string,
): RpStorybookCharacterVoiceConfig {
  return storybook.characters.find((character) => character.id === characterId)?.voiceConfig ??
    defaultRpStorybookCharacterVoiceConfig();
}

function withStorybookCharacterVoiceConfig(
  storybook: RpStorybookV1,
  characterId: string,
  voiceConfig: RpStorybookCharacterVoiceConfig,
): RpStorybookV1 {
  return {
    ...storybook,
    characters: storybook.characters.map((character) =>
      character.id === characterId
        ? { ...character, voiceConfig }
        : character
    ),
  };
}

function storybookCharacterImageFromAttachment(
  image: ChatImageAttachment,
): RpStorybookCharacterImage {
  return {
    id: image.id,
    name: image.id,
    mimeType: 'image/jpeg',
    size: image.size,
    dataUrl: image.dataUrl,
    width: image.width,
    height: image.height,
    description: '',
  };
}

function imageStatusText(images: RpStorybookCharacterImage[]) {
  if (images.length === 0) {
    return 'No images';
  }
  const described = images.filter((image) => image.description.trim()).length;
  return `${images.length} image${images.length === 1 ? '' : 's'}, ${described} described`;
}

function imageProvenanceLabel(image: RpStorybookCharacterImage) {
  const receivedFrom = image.receivedFrom?.trim();
  if (receivedFrom) {
    return `Received from ${receivedFrom}`;
  }
  return image.imageAccess ? 'Image Access' : '';
}

const storybookImagePageSize = 100;
const profilePickOutputSize = 512;
const profilePickMinSize = 18;

function lastItem<T>(items: T[]) {
  return items.length ? items[items.length - 1] : undefined;
}

function storybookImages(storybook: RpStorybookV1) {
  return storybook.characters.flatMap((character) => character.images);
}

function storybookImageOwnerBase(storybook: RpStorybookV1, owner: StorybookImageOwner) {
  const character = storybook.characters.find((entry) => entry.id === owner.characterId);
  return storybookCharacterImageOwnerIdBase(character?.name ?? '', character?.id ?? owner.characterId);
}

function profileCropHeightPercent(crop: ProfileCrop, imageRatio: number) {
  return crop.size * imageRatio;
}

function clampProfileCrop(crop: ProfileCrop, imageRatio: number): ProfileCrop {
  const maxSize = Math.max(profilePickMinSize, Math.min(100, 100 / imageRatio));
  const size = Math.min(maxSize, Math.max(profilePickMinSize, crop.size));
  const maxX = Math.max(0, 100 - size);
  const maxY = Math.max(0, 100 - size * imageRatio);
  return {
    x: Math.min(maxX, Math.max(0, crop.x)),
    y: Math.min(maxY, Math.max(0, crop.y)),
    size,
  };
}

function centeredProfileCrop(imageRatio: number): ProfileCrop {
  const size = Math.min(56, 100, 100 / imageRatio);
  const crop = {
    x: (100 - size) / 2,
    y: (100 - size * imageRatio) / 2,
    size,
  };
  return clampProfileCrop(crop, imageRatio);
}

function imageElementFromDataUrl(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load image for profile pic.'));
    image.src = dataUrl;
  });
}

async function croppedProfileImageDataUrl(image: RpStorybookCharacterImage, crop: ProfileCrop) {
  const source = await imageElementFromDataUrl(image.dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = profilePickOutputSize;
  canvas.height = profilePickOutputSize;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas is unavailable.');
  }
  const sourceSize = (crop.size / 100) * source.naturalWidth;
  context.drawImage(
    source,
    (crop.x / 100) * source.naturalWidth,
    (crop.y / 100) * source.naturalHeight,
    sourceSize,
    sourceSize,
    0,
    0,
    profilePickOutputSize,
    profilePickOutputSize,
  );
  return canvas.toDataURL('image/jpeg', 0.9);
}

function ProfilePickDialog({
  characterName,
  image,
  currentProfileImage,
  onApply,
  onClose,
}: {
  characterName: string;
  image: RpStorybookCharacterImage;
  currentProfileImage?: RpStorybookCharacterProfileImage;
  onApply: (profileImage: RpStorybookCharacterProfileImage) => void;
  onClose: () => void;
}) {
  const imageFrameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    mode: 'move' | 'resize';
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCrop: ProfileCrop;
    frameWidth: number;
    frameHeight: number;
  } | null>(null);
  const [imageRatio, setImageRatio] = useState(() =>
    image.width && image.height ? image.width / image.height : 1
  );
  const [crop, setCrop] = useState<ProfileCrop>(() =>
    currentProfileImage?.imageId === image.id
      ? currentProfileImage.crop
      : centeredProfileCrop(image.width && image.height ? image.width / image.height : 1)
  );
  const [status, setStatus] = useState('');
  const clampedCrop = clampProfileCrop(crop, imageRatio);
  const cropHeight = profileCropHeightPercent(clampedCrop, imageRatio);

  function beginDrag(mode: 'move' | 'resize', event: ReactPointerEvent<HTMLElement>) {
    const frame = imageFrameRef.current;
    if (!frame) {
      return;
    }
    const rect = frame.getBoundingClientRect();
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCrop: clampedCrop,
      frameWidth: rect.width,
      frameHeight: rect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function dragCrop(event: ReactPointerEvent<HTMLElement>) {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - active.startClientX;
    const deltaY = event.clientY - active.startClientY;
    if (active.mode === 'move') {
      setCrop(clampProfileCrop({
        ...active.startCrop,
        x: active.startCrop.x + (deltaX / active.frameWidth) * 100,
        y: active.startCrop.y + (deltaY / active.frameHeight) * 100,
      }, imageRatio));
      return;
    }
    const deltaSize = Math.max(deltaX, deltaY) / active.frameWidth * 100;
    setCrop(clampProfileCrop({
      ...active.startCrop,
      size: active.startCrop.size + deltaSize,
    }, imageRatio));
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  async function applyProfileImage() {
    try {
      setStatus('Applying profile pic ...');
      const nextCrop = clampedCrop;
      const dataUrl = await croppedProfileImageDataUrl(image, nextCrop);
      onApply({
        imageId: image.id,
        dataUrl,
        crop: nextCrop,
      });
    } catch (error) {
      setStatus(`Profile pic failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onClose);

  return (
    <div
      className="profile-pick-backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <section className="profile-pick-dialog" role="dialog" aria-modal="true" aria-label={`${characterName} profile pic`}>
        <div className="profile-pick-header">
          <div>
            <h4>Change Profile Pic</h4>
            <p>{image.name}</p>
          </div>
          <button type="button" className="close-button" onClick={onClose}>
            Close
          </button>
        </div>
        {status && <span className="run-note storybook-image-status">{status}</span>}
        <div className="profile-pick-stage">
          <div className="profile-pick-image-frame" ref={imageFrameRef}>
            <img
              src={image.dataUrl}
              alt={image.name}
              onLoad={(event) => {
                const loadedImage = event.currentTarget;
                const nextRatio = loadedImage.naturalWidth / loadedImage.naturalHeight || 1;
                setImageRatio(nextRatio);
                if (currentProfileImage?.imageId !== image.id) {
                  setCrop(centeredProfileCrop(nextRatio));
                }
              }}
            />
            <div className="profile-pick-scrim" aria-hidden="true" />
            <button
              type="button"
              className="profile-pick-crop"
              style={{
                left: `${clampedCrop.x}%`,
                top: `${clampedCrop.y}%`,
                width: `${clampedCrop.size}%`,
                height: `${cropHeight}%`,
              }}
              onPointerDown={(event) => beginDrag('move', event)}
              onPointerMove={dragCrop}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              aria-label="Move profile crop"
            >
              <span className="profile-pick-crop-handle" aria-hidden="true" />
              <span
                className="profile-pick-crop-resize"
                role="presentation"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  beginDrag('resize', event);
                }}
                onPointerMove={dragCrop}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
            </button>
          </div>
        </div>
        <div className="profile-pick-actions">
          <button className="inspect-button nodrag" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="contextual-action-button nodrag" type="button" onClick={() => void applyProfileImage()}>
            Apply
          </button>
        </div>
      </section>
    </div>
  );
}

function CharacterImagesDialog({
  storybook,
  owner,
  initialMode,
  usedImageIds,
  imageCaptionChangesById,
  promptTextCustomPresets,
  setPromptTextCustomPresets,
  onUpdateStorybook,
  onChangeImageCaptionUpdate,
  onDescribeCharacterImage,
  onClose,
}: {
  storybook: RpStorybookV1;
  owner: StorybookImageOwner;
  initialMode: CharacterImagesDialogMode;
  usedImageIds: ReadonlySet<string>;
  imageCaptionChangesById: ReadonlyMap<string, ImageCaptionChange[]>;
  onUpdateStorybook: (storybook: RpStorybookV1, status?: string) => void;
  onChangeImageCaptionUpdate: (change: ImageCaptionChange, caption: string) => void;
  onDescribeCharacterImage: StorybookCreatorDialogProps['onDescribeCharacterImage'];
  promptTextCustomPresets: Record<string, string>;
  setPromptTextCustomPresets: StorybookCreatorDialogProps['setPromptTextCustomPresets'];
  onClose: () => void;
}) {
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState<CharacterImagesDialogMode>(initialMode);
  const [describingIds, setDescribingIds] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(0);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [profilePickImageId, setProfilePickImageId] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [workflowPromptText, setWorkflowPromptText] = useState<string | undefined>();
  const characterName = storybookImageOwnerName(storybook, owner);
  const characterContext = storybookImageOwnerContext(storybook, owner);
  const images = storybookImageOwnerImages(storybook, owner);
  const profileImage = storybookImageOwnerProfileImage(storybook, owner);
  const imageDescriptionPrompt = rpStorybookImageDescriptionPromptSettings(storybook.imageDescriptionPrompt);
  const imageDescriptionPromptPresetKey = 'storybook.image-description-prompt';
  const localImageDescriptionPromptText = promptTextCustomPresets[imageDescriptionPromptPresetKey];
  const imageDescriptionPromptSource = promptPresetSource(
    imageDescriptionPrompt,
    defaultRpStorybookImageDescriptionPrompt,
    localImageDescriptionPromptText,
  );
  const imageDescriptionPromptText = promptPresetDisplayText(
    imageDescriptionPromptSource,
    imageDescriptionPrompt,
    defaultRpStorybookImageDescriptionPrompt,
    localImageDescriptionPromptText,
  );
  const effectiveWorkflowPromptText = workflowPromptText ?? (
    imageDescriptionPromptSource === 'workflow' ? imageDescriptionPrompt.customText : undefined
  );
  const [promptDraft, setPromptDraft] = useState(imageDescriptionPromptText);
  const [descriptionDrafts, setDescriptionDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(images.map((image) => [image.id, image.description])),
  );
  const selectedImage = selectedImageId
    ? images.find((image) => image.id === selectedImageId) ?? null
    : null;
  const selectedImageCaptionHistory = selectedImage
    ? imageCaptionChangesById.get(selectedImage.id) ?? []
    : [];
  const selectedImageLatestCaptionChange = lastItem(selectedImageCaptionHistory);
  const profilePickImage = profilePickImageId
    ? images.find((image) => image.id === profilePickImageId) ?? null
    : null;
  const totalPages = Math.max(1, Math.ceil(images.length / storybookImagePageSize));
  const visiblePage = Math.min(page, totalPages - 1);
  const visibleImages = images.slice(
    visiblePage * storybookImagePageSize,
    (visiblePage + 1) * storybookImagePageSize,
  );
  const undescribedImages = images.filter((image) => !(descriptionDrafts[image.id] ?? image.description).trim());

  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = promptTextareaRef.current;
    if (textarea && promptOpen) {
      const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 17;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight + lineHeight * 4, 560)}px`;
    }
  }, [promptDraft, promptOpen]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) {
        return;
      }
      setPromptDraft(imageDescriptionPromptText);
    });
    return () => {
      active = false;
    };
  }, [imageDescriptionPromptText]);

  function commitPromptDraft() {
    const nextPrompt = imageDescriptionPromptSource === 'default' || promptDraft === defaultRpStorybookImageDescriptionPrompt
      ? defaultRpStorybookImageDescriptionPromptSettings()
      : { mode: 'custom' as const, customText: promptDraft };
    if (
      nextPrompt.mode === imageDescriptionPrompt.mode &&
      nextPrompt.customText === imageDescriptionPrompt.customText
    ) {
      return storybook;
    }
    const nextStorybook = {
      ...storybook,
      imageDescriptionPrompt: nextPrompt,
    };
    onUpdateStorybook(nextStorybook, 'Updated image description prompt.');
    return nextStorybook;
  }

  function saveLocalImageDescriptionPrompt(value: string) {
    setPromptTextCustomPresets((current) => ({
      ...current,
      [imageDescriptionPromptPresetKey]: value,
    }));
  }

  function updateImageDescriptionPromptForSource(source: PromptPresetSource) {
    if (imageDescriptionPromptSource === 'workflow' && imageDescriptionPrompt.customText) {
      setWorkflowPromptText(imageDescriptionPrompt.customText);
    }
    const nextPrompt = promptSettingForSource(
      source,
      promptDraft,
      defaultRpStorybookImageDescriptionPrompt,
      localImageDescriptionPromptText,
      effectiveWorkflowPromptText,
    );
    if (source === 'custom') {
      saveLocalImageDescriptionPrompt(nextPrompt.customText ?? defaultRpStorybookImageDescriptionPrompt);
    }
    const nextStorybook = {
      ...storybook,
      imageDescriptionPrompt: nextPrompt.customText === defaultRpStorybookImageDescriptionPrompt
        ? defaultRpStorybookImageDescriptionPromptSettings()
        : nextPrompt,
    };
    setPromptDraft(
      source === 'default'
        ? defaultRpStorybookImageDescriptionPrompt
        : nextPrompt.customText ?? defaultRpStorybookImageDescriptionPrompt,
    );
    onUpdateStorybook(
      nextStorybook,
      source === 'default'
        ? 'Using default image description prompt.'
        : source === 'custom'
          ? 'Using custom image description prompt.'
          : 'Using workflow image description prompt.',
    );
  }

  async function openImages() {
    try {
      setStatus('Opening images ...');
      const result = await window.rpgraph.selectImages();
      if (result.canceled || result.images.length === 0) {
        setStatus('');
        return;
      }
      const ownerBase = storybookImageOwnerBase(storybook, owner);
      const reservedImageIds = new Set(storybookImages(storybook).map((image) => image.id));
      const pendingImages: Array<Pick<RpStorybookCharacterImage, 'id'>> = [...images];
      const attachments = await Promise.all(
        result.images.map((image) => normalizeImageAttachment(image, () => {
          const id = nextStorybookCharacterImageId(ownerBase, pendingImages, reservedImageIds);
          reservedImageIds.add(id);
          pendingImages.push({ id });
          return id;
        })),
      );
      const nextImages = [
        ...images,
        ...attachments.map(storybookCharacterImageFromAttachment),
      ];
      onUpdateStorybook(
        withStorybookImageOwnerImages(storybook, owner, nextImages),
        `Added ${attachments.length} image${attachments.length === 1 ? '' : 's'} for ${characterName}.`,
      );
      setStatus(`Added ${attachments.length} image${attachments.length === 1 ? '' : 's'}.`);
    } catch (error) {
      setStatus(`Image load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function removeImage(imageId: string) {
    if (usedImageIds.has(imageId)) {
      setStatus('Cannot delete: image is used in chat history.');
      return;
    }
    const nextImages = images.filter((image) => image.id !== imageId);
    if (selectedImageId === imageId) {
      setSelectedImageId(null);
    }
    onUpdateStorybook(
      withStorybookImageOwnerImages(storybook, owner, nextImages),
      `Removed image from ${characterName}.`,
    );
  }

  function draftDescription(imageId: string, description: string) {
    setDescriptionDrafts((current) => ({ ...current, [imageId]: description }));
  }

  function commitDescription(imageId: string) {
    const currentImage = images.find((image) => image.id === imageId);
    const nextDescription = (descriptionDrafts[imageId] ?? currentImage?.description ?? '').trim();
    const captionChange = lastItem(imageCaptionChangesById.get(imageId) ?? []);
    if (
      !currentImage ||
      (currentImage.description === nextDescription && captionChange?.afterCaption === nextDescription)
    ) {
      return;
    }
    if (captionChange) {
      onChangeImageCaptionUpdate(captionChange, nextDescription);
      return;
    }
    const nextImages = images.map((image) =>
      image.id === imageId ? { ...image, description: nextDescription } : image
    );
    onUpdateStorybook(
      withStorybookImageOwnerImages(storybook, owner, nextImages),
      `Updated image description for ${characterName}.`,
    );
  }

  function commitAllDescriptionDrafts(baseStorybook = storybook) {
    const nextImages = images.map((image) => ({
      ...image,
      description: descriptionDrafts[image.id] ?? image.description,
    }));
    const changed = nextImages.some((image, index) => image.description !== images[index]?.description);
    if (!changed) {
      return baseStorybook;
    }
    const nextStorybook = withStorybookImageOwnerImages(baseStorybook, owner, nextImages);
    onUpdateStorybook(nextStorybook, `Updated image descriptions for ${characterName}.`);
    return nextStorybook;
  }

  function closeDialog() {
    const activeStorybook = commitPromptDraft();
    commitAllDescriptionDrafts(activeStorybook);
    onClose();
  }

  function closeImageDetail() {
    if (selectedImageId) {
      commitDescription(selectedImageId);
    }
    setSelectedImageId(null);
  }

  function applyProfileImage(profileImageValue: RpStorybookCharacterProfileImage) {
    onUpdateStorybook(
      withStorybookCharacterProfileImage(storybook, owner, profileImageValue),
      `Updated profile pic for ${characterName}.`,
    );
    setProfilePickImageId(null);
    setStatus('Profile pic applied.');
  }

  async function describeImage(image: RpStorybookCharacterImage) {
    setDescribingIds((current) => new Set(current).add(image.id));
    try {
      setStatus(`Describing ${image.name} ...`);
      const activeStorybook = commitPromptDraft();
      const activePrompt = rpStorybookImageDescriptionPromptText(activeStorybook.imageDescriptionPrompt);
      const description = await onDescribeCharacterImage(characterContext, image, activePrompt);
      setDescriptionDrafts((current) => ({ ...current, [image.id]: description }));
      const nextImages = images.map((entry) =>
        entry.id === image.id ? { ...entry, description } : entry
      );
      const nextStorybook = withStorybookImageOwnerImages(activeStorybook, owner, nextImages);
      onUpdateStorybook(nextStorybook, `Described image for ${characterName}.`);
      setStatus(`Described ${image.name}.`);
      return nextStorybook;
    } catch (error) {
      setStatus(`Describe failed: ${error instanceof Error ? error.message : String(error)}`);
      return storybook;
    } finally {
      setDescribingIds((current) => {
        const next = new Set(current);
        next.delete(image.id);
        return next;
      });
    }
  }

  async function describeImages(targetImages = images) {
    if (targetImages.length === 0) {
      setStatus('No images to describe.');
      return;
    }
    const activeStorybook = commitPromptDraft();
    const activePrompt = rpStorybookImageDescriptionPromptText(activeStorybook.imageDescriptionPrompt);
    let nextImages = images.map((image) => ({
      ...image,
      description: descriptionDrafts[image.id] ?? image.description,
    }));
    let describedCount = 0;
    for (const image of targetImages) {
      setDescribingIds((current) => new Set(current).add(image.id));
      try {
        setStatus(`Describing ${image.name} ...`);
        const description = await onDescribeCharacterImage(characterContext, image, activePrompt);
        nextImages = nextImages.map((entry) =>
          entry.id === image.id ? { ...entry, description } : entry
        );
        describedCount += 1;
        setDescriptionDrafts((current) => ({ ...current, [image.id]: description }));
      } catch (error) {
        setStatus(`Describe failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setDescribingIds((current) => {
          const next = new Set(current);
          next.delete(image.id);
          return next;
        });
      }
    }
    if (describedCount === 0) {
      return;
    }
    onUpdateStorybook(
      withStorybookImageOwnerImages(activeStorybook, owner, nextImages),
      `Described ${describedCount} image${describedCount === 1 ? '' : 's'} for ${characterName}.`,
    );
    setStatus(`Described ${describedCount} image${describedCount === 1 ? '' : 's'}.`);
  }
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(closeDialog);
  const promptBackdropDismiss = useBackdropDismiss<HTMLDivElement>(() => setPromptOpen(false));
  const detailBackdropDismiss = useBackdropDismiss<HTMLDivElement>(closeImageDetail);

  return (
    <div
      className="storybook-image-dialog-backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <section className="storybook-image-dialog" role="dialog" aria-modal="true" aria-label={`${characterName} images`}>
        <div className="storybook-image-dialog-header">
          <div>
            <h3>{characterName}</h3>
            <p>{imageStatusText(images)}</p>
          </div>
          <div className="storybook-image-dialog-actions">
            <button
              type="button"
              className="node-info-button storybook-image-context-help nodrag"
              aria-label="Image List context help"
              data-tooltip="Add and describe character images here so prompts and phone actions can reference stored image IDs."
            >
              ?
            </button>
            <button className="inspect-button nodrag" type="button" onClick={() => void openImages()}>
              Open Images
            </button>
            <button
              className={`inspect-button nodrag${mode === 'profile' ? ' active' : ''}`}
              type="button"
              disabled={images.length === 0}
              onClick={() => setMode((current) => current === 'profile' ? 'images' : 'profile')}
            >
              Change Profile Pic
            </button>
            <button
              className="inspect-button nodrag"
              type="button"
              onClick={() => setPromptOpen((current) => !current)}
            >
              Prompt
            </button>
            <button
              className="inspect-button nodrag"
              type="button"
              disabled={undescribedImages.length === 0 || describingIds.size > 0}
              onClick={() => void describeImages(undescribedImages)}
            >
              Describe New Images
            </button>
            <button
              className="inspect-button nodrag"
              type="button"
              disabled={images.length === 0 || describingIds.size > 0}
              onClick={() => void describeImages(images)}
            >
              Describe All Images
            </button>
            <button type="button" className="close-button" onClick={closeDialog}>
              Close
            </button>
          </div>
        </div>
        {status && <span className="run-note storybook-image-status">{status}</span>}
        {promptOpen && (
          <div
            className="storybook-image-prompt-backdrop"
            role="presentation"
            {...promptBackdropDismiss}
          >
            <section
              className="storybook-image-prompt-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="Image Description Prompt"
            >
              <div className="storybook-image-prompt-header">
                <h4>Image Description Prompt</h4>
                <button
                  type="button"
                  className="inspect-button nodrag"
                  onClick={() => setPromptOpen(false)}
                >
                  Close
                </button>
              </div>
              <div className="storybook-image-prompt-body">
                <div className="event-manager-prompt-toolbar">
                  <div className="autoturn-instruction-mode" role="group" aria-label="Image Description Prompt mode">
                    <button
                      type="button"
                      className={imageDescriptionPromptSource === 'default' ? 'active' : ''}
                      onClick={() => updateImageDescriptionPromptForSource('default')}
                    >
                      Default
                    </button>
                    <button
                      type="button"
                      className={imageDescriptionPromptSource === 'custom' ? 'active' : ''}
                      onClick={() => updateImageDescriptionPromptForSource('custom')}
                    >
                      Custom
                    </button>
                    <button
                      type="button"
                      className={imageDescriptionPromptSource === 'workflow' ? 'active' : ''}
                      disabled={!effectiveWorkflowPromptText}
                      onClick={() => updateImageDescriptionPromptForSource('workflow')}
                    >
                      In Workflow
                    </button>
                  </div>
                </div>
                <label className="storybook-image-prompt-label">
                  PROMPT TEXT
                  <textarea
                    ref={promptTextareaRef}
                    value={promptDraft}
                    rows={14}
                    disabled={imageDescriptionPromptSource === 'default'}
                    onChange={(event) => {
                      const value = event.target.value;
                      setPromptDraft(value);
                      if (imageDescriptionPromptSource === 'custom') {
                        saveLocalImageDescriptionPrompt(value);
                      }
                    }}
                    onBlur={() => commitPromptDraft()}
                  />
                </label>
              </div>
              <div className="storybook-image-prompt-actions">
                <button
                  className="inspect-button nodrag"
                  type="button"
                  onClick={() => updateImageDescriptionPromptForSource('default')}
                >
                  Reset Prompt
                </button>
                <button
                  className="inspect-button nodrag"
                  type="button"
                  onClick={() => {
                    commitPromptDraft();
                    setPromptOpen(false);
                  }}
                >
                  Save Prompt
                </button>
              </div>
            </section>
          </div>
        )}
        {images.length > storybookImagePageSize && (
          <div className="storybook-image-pagination image-gallery-pagination">
            <button
              type="button"
              disabled={visiblePage === 0}
              onClick={() => setPage(Math.max(0, visiblePage - 1))}
            >
              Previous
            </button>
            <span>
              Page {visiblePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              disabled={visiblePage >= totalPages - 1}
              onClick={() => setPage(Math.min(totalPages - 1, visiblePage + 1))}
            >
              Next
            </button>
          </div>
        )}
        <div className="storybook-image-grid">
          {images.length ? (
            visibleImages.map((image) => {
              const description = descriptionDrafts[image.id] ?? image.description;
              const receivedLabel = imageProvenanceLabel(image);
              const usedInHistory = usedImageIds.has(image.id);
              const aspectRatio = image.width && image.height
                ? `${image.width} / ${image.height}`
                : undefined;
              return (
                <article className="storybook-image-item" key={image.id}>
                  <button
                    className={`storybook-image-remove${usedInHistory ? ' disabled' : ''}`}
                    type="button"
                    aria-disabled={usedInHistory}
                    title={usedInHistory ? 'Cannot delete: used in chat history' : `Remove ${image.name}`}
                    onClick={() => removeImage(image.id)}
                  >
                    x
                  </button>
                  <button
                    className={`storybook-image-tile${description.trim() ? ' has-description' : ''}${
                      profileImage?.imageId === image.id ? ' profile-selected' : ''
                    }`}
                    type="button"
                    title={[receivedLabel, description.trim() || image.name].filter(Boolean).join('\n')}
                    onClick={() => {
                      if (mode === 'profile') {
                        setProfilePickImageId(image.id);
                        return;
                      }
                      setSelectedImageId(image.id);
                    }}
                  >
                    <div className="storybook-image-preview" style={aspectRatio ? { aspectRatio } : undefined}>
                      <img src={image.dataUrl} alt={image.name} loading="lazy" decoding="async" />
                      {receivedLabel && (
                        <span className="storybook-image-received-badge" title={receivedLabel}>
                          {receivedLabel}
                        </span>
                      )}
                    </div>
                    {description.trim() && (
                      <span className="storybook-image-caption">{description}</span>
                    )}
                  </button>
                </article>
              );
            })
          ) : (
            <div className="storybook-image-empty">
              <p>No character images yet.</p>
            </div>
          )}
        </div>
        {selectedImage && (
          <div
            className="storybook-image-detail-backdrop"
            role="presentation"
            {...detailBackdropDismiss}
          >
            <section
              className="storybook-image-detail"
              role="dialog"
              aria-modal="true"
              aria-label={`${selectedImage.name} description`}
            >
              <div className="storybook-image-detail-header">
                <div>
                  <h4>{selectedImage.name}</h4>
                  <p>
                    {[selectedImage.width && selectedImage.height ? `${selectedImage.width} x ${selectedImage.height}` : '', `${(selectedImage.size / 1024).toFixed(1)} KB`]
                      .filter(Boolean)
                      .join(' / ')}
                  </p>
                  {imageProvenanceLabel(selectedImage) && (
                    <p className="storybook-image-received-detail">{imageProvenanceLabel(selectedImage)}</p>
                  )}
                </div>
                <button type="button" className="close-button" onClick={closeImageDetail}>
                  Close
                </button>
              </div>
              <div className="storybook-image-detail-body">
                <div className="storybook-image-detail-preview">
                  <img src={selectedImage.dataUrl} alt={selectedImage.name} />
                  {(descriptionDrafts[selectedImage.id] ?? selectedImage.description).trim() && (
                    <div className="image-preview-caption">
                      {descriptionDrafts[selectedImage.id] ?? selectedImage.description}
                    </div>
                  )}
                </div>
                <aside className="storybook-image-detail-side-panel">
                  <label className="storybook-image-description storybook-image-detail-description">
                    DESCRIPTION
                    <textarea
                      value={descriptionDrafts[selectedImage.id] ?? selectedImage.description}
                      rows={8}
                      onChange={(event) => draftDescription(selectedImage.id, event.target.value)}
                      placeholder="No description yet."
                    />
                  </label>
                  <div className="storybook-image-detail-actions">
                    <button
                      className="contextual-action-button nodrag"
                      type="button"
                      disabled={describingIds.has(selectedImage.id)}
                      onClick={() => void describeImage(selectedImage)}
                    >
                      {describingIds.has(selectedImage.id) ? 'Describing ...' : 'Describe'}
                    </button>
                    <button
                      className="inspect-button nodrag"
                      type="button"
                      onClick={() => commitDescription(selectedImage.id)}
                    >
                      {selectedImageLatestCaptionChange ? 'Change Update' : 'Save Caption'}
                    </button>
                    <button
                      className="inspect-button nodrag danger"
                      type="button"
                      onClick={() => removeImage(selectedImage.id)}
                    >
                      Remove Image
                    </button>
                  </div>
                  <CaptionHistoryList items={captionHistoryTimeline(selectedImageCaptionHistory)} />
                </aside>
              </div>
            </section>
          </div>
        )}
        {profilePickImage && (
          <ProfilePickDialog
            characterName={characterName}
            image={profilePickImage}
            currentProfileImage={profileImage}
            onApply={applyProfileImage}
            onClose={() => setProfilePickImageId(null)}
          />
        )}
      </section>
    </div>
  );
}

function CharacterSetupDialog({
  storybook,
  characterId,
  workflowNodes,
  connections,
  providerHealthById,
  onUpdateStorybook,
  onLoadCharacterComfyLoras,
  onGenerateCharacterComfyPreview,
  onGenerateCharacterVoicePreview,
  onUnloadCharacterComfyModels,
  onClose,
}: {
  storybook: RpStorybookV1;
  characterId: string;
  workflowNodes: WorkflowNode[];
  connections: ConnectionPreset[];
  providerHealthById: Record<string, ProviderConnectionHealth>;
  onUpdateStorybook: (storybook: RpStorybookV1, status?: string) => void;
  onLoadCharacterComfyLoras: StorybookCreatorDialogProps['onLoadCharacterComfyLoras'];
  onGenerateCharacterComfyPreview: StorybookCreatorDialogProps['onGenerateCharacterComfyPreview'];
  onGenerateCharacterVoicePreview: StorybookCreatorDialogProps['onGenerateCharacterVoicePreview'];
  onUnloadCharacterComfyModels: StorybookCreatorDialogProps['onUnloadCharacterComfyModels'];
  onClose: () => void;
}) {
  const character = storybook.characters.find((entry) => entry.id === characterId);
  const characterName = character?.name || character?.id || 'Character';
  const characterContext = character
    ? [
        character.name ? `Name: ${character.name}` : '',
        character.description ? `Description: ${character.description}` : '',
        character.role ? `Role: ${character.role}` : '',
      ].filter(Boolean).join('\n')
    : `Name: ${characterName}`;
  const comfyConnections = connections.filter(isComfyImageConnection);
  const voiceConnections = connections.filter(isComfyVoiceConnection);
  const [activeSetupTab, setActiveSetupTab] = useState<'image' | 'voice'>('image');
  const [providerId, setProviderId] = useState(comfyConnections[0]?.id ?? '');
  const [voiceProviderId, setVoiceProviderId] = useState(voiceConnections[0]?.id ?? '');
  const [loraOptions, setLoraOptions] = useState<string[]>([]);
  const [draft, setDraft] = useState(() => storybookCharacterComfyConfig(storybook, characterId));
  const [voiceDraft, setVoiceDraft] = useState(() => storybookCharacterVoiceConfig(storybook, characterId));
  const [voiceTestText, setVoiceTestText] = useState('');
  const [voiceGenerating, setVoiceGenerating] = useState(false);
  const [voiceClip, setVoiceClip] = useState<{ dataUrl: string; filename: string } | null>(null);
  const [previewScenarioId, setPreviewScenarioId] = useState<(typeof characterComfyPreviewScenarios)[number]['id']>('mirror-selfie');
  const [status, setStatus] = useState('');
  const [generating, setGenerating] = useState(false);
  const [unloading, setUnloading] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ dataUrl: string; filename: string } | null>(null);
  const loraOptionsCacheRef = useRef<Record<string, string[]>>({});
  const createImageActions = useMemo(() => usedCreateImagePromptActions(workflowNodes), [workflowNodes]);
  const comfyUsageStatus = storybookCharacterComfyStatus({
    character: { name: characterName, comfyConfig: draft },
    createImageActions,
    connections,
    providerHealthById,
  });

  useEffect(() => {
    let active = true;
    if (!providerId) {
      queueMicrotask(() => {
        if (active) {
          setLoraOptions([]);
        }
      });
      return () => {
        active = false;
      };
    }
    const cachedLoras = loraOptionsCacheRef.current[providerId];
    if (cachedLoras) {
      queueMicrotask(() => {
        if (!active) {
          return;
        }
        setLoraOptions(cachedLoras);
        setStatus(cachedLoras.length ? `Loaded ${cachedLoras.length} cached LoRA${cachedLoras.length === 1 ? '' : 's'}.` : 'No LoRAs found.');
      });
      return () => {
        active = false;
      };
    }
    queueMicrotask(() => {
      if (active) {
        setStatus('Loading LoRAs ...');
      }
    });
    onLoadCharacterComfyLoras(providerId)
      .then((loras) => {
        if (!active) {
          return;
        }
        loraOptionsCacheRef.current = {
          ...loraOptionsCacheRef.current,
          [providerId]: loras,
        };
        setLoraOptions(loras);
        setStatus(loras.length ? `Loaded ${loras.length} LoRA${loras.length === 1 ? '' : 's'}.` : 'No LoRAs found.');
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setLoraOptions([]);
        setStatus(`Could not load LoRAs: ${error instanceof Error ? error.message : String(error)}`);
      });
    return () => {
      active = false;
    };
  }, [onLoadCharacterComfyLoras, providerId]);

  function commitCharacterSetup() {
    onUpdateStorybook(
      withStorybookCharacterVoiceConfig(
        withStorybookCharacterComfyConfig(storybook, characterId, {
          loraName: draft.loraName.trim(),
          loraUrl: draft.loraUrl?.trim() ?? '',
          appearance: draft.appearance.trim(),
        }),
        characterId,
        voiceDraft.sampleDataUrl ? voiceDraft : defaultRpStorybookCharacterVoiceConfig(),
      ),
      `Character setup saved for ${characterName}.`,
    );
  }

  async function chooseVoiceSample() {
    try {
      const result = await window.rpgraph.selectAudio();
      if (result.canceled || !result.audio) {
        return;
      }
      setVoiceDraft({
        sampleName: result.audio.name,
        sampleMimeType: result.audio.mimeType,
        sampleDataUrl: result.audio.dataUrl,
      });
      setVoiceClip(null);
      setStatus(`Voice sample selected: ${result.audio.name}. Close to keep it in the storybook.`);
    } catch (error) {
      setStatus(`Voice sample selection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function removeVoiceSample() {
    setVoiceDraft(defaultRpStorybookCharacterVoiceConfig());
    setVoiceClip(null);
    setStatus('Voice sample removed. Close to apply.');
  }

  async function generateVoicePreview() {
    if (!voiceProviderId) {
      setStatus('Choose a ComfyUI voice provider first.');
      return;
    }
    if (!voiceDraft.sampleDataUrl) {
      setStatus('Upload a voice sample for this character first.');
      return;
    }
    if (!voiceTestText.trim()) {
      setStatus('Enter a text the character should say.');
      return;
    }
    setVoiceGenerating(true);
    setVoiceClip(null);
    setStatus('Unloading local LLM models and generating voice clip ...');
    try {
      const clips = await onGenerateCharacterVoicePreview({
        providerId: voiceProviderId,
        speechText: voiceTestText,
        sampleDataUrl: voiceDraft.sampleDataUrl,
      });
      setVoiceClip(clips[0] ?? null);
      setStatus(clips.length ? `Generated ${clips.length} voice clip${clips.length === 1 ? '' : 's'}.` : 'No voice clip returned.');
    } catch (error) {
      setStatus(`Voice generation failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setVoiceGenerating(false);
    }
  }

  async function copyLoraUrl() {
    const loraUrl = draft.loraUrl?.trim() ?? '';
    if (!loraUrl) {
      setStatus('Add a LoRA source URL first.');
      return;
    }
    await copyTextToClipboard(loraUrl);
    setStatus('LoRA source URL copied.');
  }

  async function generatePreview() {
    if (!providerId) {
      setStatus('Choose a ComfyUI provider first.');
      return;
    }
    const scenario =
      characterComfyPreviewScenarios.find((entry) => entry.id === previewScenarioId) ??
      characterComfyPreviewScenarios[0];
    setGenerating(true);
    setPreviewImage(null);
    setStatus('Unloading local LLM models and generating test image ...');
    try {
      const images = await onGenerateCharacterComfyPreview({
        providerId,
        characterName,
        characterContext,
        loraName: draft.loraName,
        appearance: draft.appearance,
        scenarioPrompt: scenario.prompt,
      });
      setPreviewImage(images[0] ?? null);
      setStatus(images.length ? `Generated ${images.length} image${images.length === 1 ? '' : 's'}.` : 'No image returned.');
    } catch (error) {
      setStatus(`Generation failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setGenerating(false);
    }
  }

  async function closeDialog() {
    commitCharacterSetup();
    if (!providerId) {
      onClose();
      return;
    }
    setStatus('Unloading ComfyUI models ...');
    try {
      await onUnloadCharacterComfyModels(providerId);
    } catch (error) {
      setStatus(`Unload failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      onClose();
    }
  }

  async function unloadModels() {
    if (!providerId) {
      setStatus('Choose a ComfyUI provider first.');
      return;
    }
    setUnloading(true);
    setStatus('Unloading ComfyUI models ...');
    try {
      await onUnloadCharacterComfyModels(providerId);
      setStatus('ComfyUI models unloaded.');
    } catch (error) {
      setStatus(`Unload failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setUnloading(false);
    }
  }

  async function unloadVoiceModels() {
    if (!voiceProviderId) {
      setStatus('Choose a ComfyUI voice provider first.');
      return;
    }
    setUnloading(true);
    setStatus('Unloading ComfyUI models ...');
    try {
      await onUnloadCharacterComfyModels(voiceProviderId);
      setStatus('ComfyUI models unloaded.');
    } catch (error) {
      setStatus(`Unload failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setUnloading(false);
    }
  }

  const loraPickerOptions = Array.from(
    new Set(
      [draft.loraName, ...loraOptions]
        .map((name) => name.trim())
        .filter((name) => name.length > 0 && name !== comfyCharacterLoraName),
    ),
  );
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(() => void closeDialog());

  return (
    <div className="storybook-image-dialog-backdrop" role="presentation" {...backdropDismiss}>
      <section
        className="storybook-image-dialog character-comfy-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${characterName} character setup`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="storybook-image-dialog-header">
          <div>
            <h3>Character Setup</h3>
            <p>{characterName}</p>
          </div>
          <div className="storybook-image-dialog-actions">
            <button type="button" className="close-button" onClick={() => void closeDialog()}>Close</button>
          </div>
        </div>
        {status && <span className="run-note storybook-image-status">{status}</span>}
        <div className="character-setup-layout">
          <div className="character-setup-tabs" role="tablist" aria-label="Character setup sections">
            <button
              type="button"
              role="tab"
              aria-selected={activeSetupTab === 'image'}
              className={activeSetupTab === 'image' ? 'active' : ''}
              onClick={() => setActiveSetupTab('image')}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span>Image Setup</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeSetupTab === 'voice'}
              className={activeSetupTab === 'voice' ? 'active' : ''}
              onClick={() => setActiveSetupTab('voice')}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
              <span>Voice Setup</span>
            </button>
          </div>
          {activeSetupTab === 'voice' ? (
            <div className="character-voice-body">
              <div className="character-voice-card">
                <label className="character-comfy-field">
                  <span>VOICE PROVIDER</span>
                  <NodeCustomSelect
                    value={voiceProviderId}
                    onChange={(value) => setVoiceProviderId(String(value))}
                    options={voiceConnections.length
                      ? voiceConnections.map((connection) => providerOption(connection, providerHealthById[connection.id]))
                      : [{ value: '', label: 'No ComfyUI voice provider', disabled: true }]}
                  />
                </label>
              </div>

              <div className="character-voice-card">
                <div className="character-voice-card-header">
                  <span className="character-voice-card-title">VOICE SAMPLE (MP3)</span>
                  <button type="button" className="contextual-action-button nodrag" onClick={() => void chooseVoiceSample()}>
                    {voiceDraft.sampleDataUrl ? 'Replace MP3 Sample' : 'Choose MP3 Sample'}
                  </button>
                </div>
                <p className="character-voice-hint">
                  Upload a short MP3 voice sample of this character — ideally 10 to 20 seconds of
                  clear speech without music or background noise. It is stored in the storybook and
                  used as the reference voice for cloning.
                </p>
                {voiceDraft.sampleDataUrl ? (
                  <DarkAudioPlayer
                    src={voiceDraft.sampleDataUrl}
                    title={voiceDraft.sampleName || 'Voice sample'}
                    onRemove={removeVoiceSample}
                    className="voice-sample-player"
                  />
                ) : (
                  <div className="character-voice-empty-sample">
                    <span>No voice sample uploaded yet</span>
                  </div>
                )}
              </div>

              <div className="character-voice-card">
                <span className="character-voice-card-title">VOICE GENERATION &amp; TESTING</span>
                <label className="character-comfy-field">
                  <span>TEST TEXT</span>
                  <textarea
                    className="node-textarea nodrag nowheel"
                    rows={3}
                    value={voiceTestText}
                    placeholder="Write a sentence the character should say ..."
                    onChange={(event) => setVoiceTestText(event.currentTarget.value)}
                  />
                </label>
                <div className="character-comfy-actions">
                  <button
                    type="button"
                    className="contextual-action-button nodrag"
                    disabled={voiceGenerating}
                    onClick={() => void generateVoicePreview()}
                  >
                    {voiceGenerating ? 'Generating ...' : 'Generate Voice'}
                  </button>
                  <button type="button" className="contextual-action-button nodrag" disabled={unloading} onClick={() => void unloadVoiceModels()}>
                    {unloading ? 'Unloading ...' : 'Unload Models'}
                  </button>
                </div>

                {voiceGenerating ? (
                  <div className="character-voice-generating-box">
                    <div className="character-voice-spinner" />
                    <span>Generating voice clip ...</span>
                  </div>
                ) : voiceClip ? (
                  <div className="character-voice-result-box">
                    <span className="character-voice-result-label">GENERATED VOICE CLIP</span>
                    <DarkAudioPlayer
                      src={voiceClip.dataUrl}
                      title={voiceClip.filename || 'Generated voice clip'}
                      className="voice-generated-player"
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
        <div className="character-comfy-body">
          <div className="character-comfy-form">
            <label className="character-comfy-field">
              <span>COMFYUI PROVIDER</span>
              <NodeCustomSelect
                value={providerId}
                onChange={(value) => setProviderId(String(value))}
                options={comfyConnections.length
                  ? comfyConnections.map((connection) => providerOption(connection, providerHealthById[connection.id]))
                  : [{ value: '', label: 'No ComfyUI provider', disabled: true }]}
              />
            </label>
            <label className="character-comfy-field">
              <span>CHARACTER LORA</span>
              <ModelIdPicker
                id={`character-comfy-lora-${characterId}`}
                value={draft.loraName}
                onChange={(value) => setDraft((current) => ({ ...current, loraName: value }))}
                options={loraPickerOptions}
                onOpenOptions={() => undefined}
                placeholder="Type or select a character LoRA"
                favoritesStorageKey={characterLoraFavoritesStorageKey}
              />
            </label>
            <label className="character-comfy-field">
              <span>LORA SOURCE URL</span>
              <div className="character-comfy-url-row">
                <input
                  className="node-text-input nodrag"
                  type="url"
                  value={draft.loraUrl ?? ''}
                  placeholder="https://..."
                  onChange={(event) => {
                    const loraUrl = event.currentTarget.value;
                    setDraft((current) => ({ ...current, loraUrl }));
                  }}
                />
                <button type="button" className="contextual-action-button nodrag" onClick={() => void copyLoraUrl()}>
                  Copy Link
                </button>
              </div>
            </label>
            <label className="character-comfy-field">
              <span>CHARACTER APPEARANCE</span>
              <textarea
                className="node-textarea nodrag nowheel"
                rows={7}
                value={draft.appearance}
                placeholder="Hair, face, body type, glasses, clothing style, notable features..."
                onChange={(event) => {
                  const appearance = event.currentTarget.value;
                  setDraft((current) => ({ ...current, appearance }));
                }}
              />
            </label>
            <label className="character-comfy-field">
              <span>GENERATION IMAGE</span>
              <NodeCustomSelect
                value={previewScenarioId}
                onChange={(value) => setPreviewScenarioId(value)}
                options={characterComfyPreviewScenarios.map((scenario) => ({
                  value: scenario.id,
                  label: scenario.label,
                }))}
              />
            </label>
            <div className="character-comfy-actions">
              <button type="button" className="contextual-action-button nodrag" disabled={generating} onClick={() => void generatePreview()}>
                {generating ? 'Generating ...' : 'Generate Image'}
              </button>
              <button type="button" className="contextual-action-button nodrag" disabled={unloading} onClick={() => void unloadModels()}>
                {unloading ? 'Unloading ...' : 'Unload Models'}
              </button>
            </div>
          </div>
          <div className="character-comfy-preview">
            {generating ? (
              <div className="character-image-generating-box">
                <div className="character-voice-spinner" />
                <span>Generating test image ...</span>
              </div>
            ) : previewImage ? (
              <>
                <img src={previewImage.dataUrl} alt={previewImage.filename || `${characterName} generated preview`} />
                <span>{previewImage.filename || 'Generated preview'}</span>
              </>
            ) : (
              <p>Generate a test image to preview this character LoRA and appearance.</p>
            )}
          </div>
        </div>
          )}
        </div>
        {activeSetupTab === 'image' ? (
          <p className={`character-comfy-usage-status${comfyUsageStatus.active ? ' active' : ''}`}>
            {comfyUsageStatus.text}
          </p>
        ) : null}
      </section>
    </div>
  );
}

export function StorybookCreatorDialog({
  node,
  workflowNodes,
  messages,
  isSubmitting,
  connections,
  providerHealthById,
  onSubmit,
  onLoad,
  onSaveStorybook,
  promptTextCustomPresets,
  setPromptTextCustomPresets,
  usedImageIds,
  imageCaptionChangesById,
  onUpdateStorybook,
  onChangeImageCaptionUpdate,
  onUpdateFormattedTextSettings,
  onDescribeCharacterImage,
  onLoadCharacterComfyLoras,
  onGenerateCharacterComfyPreview,
  onGenerateCharacterVoicePreview,
  onUnloadCharacterComfyModels,
  onImportOpeningHistory,
  onClearOpeningHistory,
  onResetStorybook,
  onImportSillyTavernCharacter,
  onClose,
}: StorybookCreatorDialogProps) {
  const [draft, setDraft] = useState('');
  const [viewMode, setViewMode] = useState<'ui' | 'json' | 'text'>('ui');
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [fileActionStatus, setFileActionStatus] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [outputSettingsOpen, setOutputSettingsOpen] = useState(false);
  const outputSettingsMenuRef = useRef<HTMLDivElement | null>(null);
  const [imageOwner, setImageOwner] = useState<StorybookImageOwner | null>(null);
  const [imageDialogMode, setImageDialogMode] = useState<CharacterImagesDialogMode>('images');
  const [comfyConfigCharacterId, setComfyConfigCharacterId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    | {
        title: string;
        message: string;
        confirmLabel: string;
        danger?: boolean;
        action: () => void;
      }
    | null
  >(null);
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onClose);
  const storybook = useMemo(() => {
    try {
      return node.data.storybookJson ? parseRpStorybookJson(node.data.storybookJson) : emptyRpStorybookV1;
    } catch {
      return emptyRpStorybookV1;
    }
  }, [node.data.storybookJson]);
  const formattedTextSettings = rpStorybookFormattedTextSettings(node.data.storybookFormattedTextSettings);
  const phoneContactCharacters = useMemo(() => rpStorybookPhoneContactCharacters(storybook), [storybook]);
  const createImageActions = useMemo(() => usedCreateImagePromptActions(workflowNodes), [workflowNodes]);
  const openingHistoryMessages = useMemo(
    () => storybook.openingHistory.turns.flatMap((turn) => [
      ...turn.input.messages.map((message) => ({ message, turnNumber: turn.number })),
      ...turn.output.messages.map((message) => ({ message, turnNumber: turn.number })),
    ]),
    [storybook],
  );

  useEffect(() => {
    if (!outputSettingsOpen) {
      return;
    }
    const closeOutputSettingsOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !outputSettingsMenuRef.current?.contains(event.target)) {
        setOutputSettingsOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOutputSettingsOutside);
    return () => document.removeEventListener('pointerdown', closeOutputSettingsOutside);
  }, [outputSettingsOpen]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || isSubmitting) {
      return;
    }
    setDraft('');
    void onSubmit(message);
  }

  function submitDraft() {
    const message = draft.trim();
    if (!message || isSubmitting) {
      return;
    }
    setDraft('');
    void onSubmit(message);
  }

  async function loadStorybook() {
    try {
      setFileActionStatus('Loading storybook ...');
      const loaded = await onLoad();
      if (loaded) {
        setFileActionStatus('Loaded.');
      } else {
        setFileActionStatus('');
      }
    } catch (error) {
      setFileActionStatus(`Load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function runMoreAction(action: () => void | Promise<void>) {
    setMoreOpen(false);
    void action();
  }

  function changeFormattedTextSetting(key: keyof RpStorybookFormattedTextSettings, enabled: boolean) {
    onUpdateFormattedTextSettings({
      ...formattedTextSettings,
      [key]: enabled,
    });
  }

  function askConfirm(action: NonNullable<typeof confirmAction>) {
    setMoreOpen(false);
    setConfirmAction(action);
  }

  function confirmPendingAction() {
    const pending = confirmAction;
    if (!pending) {
      return;
    }
    setConfirmAction(null);
    pending.action();
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <section className="storybook-creator-dialog" role="dialog" aria-modal="true" aria-label="RP Storybook Creator">
        <div className="dialog-header storybook-creator-header">
          <div className="storybook-title-row">
            <h2>{node.data.label}</h2>
            <p>{node.data.storybookStatus ?? 'Ready'}</p>
          </div>
          <div className="storybook-header-actions">
            <div className="storybook-more-menu" ref={outputSettingsMenuRef}>
              <button
                className="inspect-button storybook-output-button nodrag"
                type="button"
                aria-expanded={outputSettingsOpen}
                aria-haspopup="menu"
                onClick={() => {
                  setOutputSettingsOpen((current) => !current);
                  setMoreOpen(false);
                }}
              >
                Output
              </button>
              {outputSettingsOpen && (
                <div className="storybook-output-popover" role="menu">
                  <span className="node-field-label">FORMATTED TEXT OUTPUT</span>
                  <div className="storybook-output-setting-grid">
                    {storybookFormattedTextSettingControls.map((control) => (
                      <label className="option-toggle compact-toggle nodrag" key={control.key}>
                        <input
                          type="checkbox"
                          checked={formattedTextSettings[control.key]}
                          onChange={(event) =>
                            changeFormattedTextSetting(control.key, event.currentTarget.checked)
                          }
                        />
                        <span>{control.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button className="inspect-button nodrag" type="button" onClick={onSaveStorybook}>
              Save
            </button>
            <button className="inspect-button nodrag" type="button" onClick={() => void loadStorybook()}>
              Load
            </button>
            <div className="storybook-more-menu">
              <button
                className="inspect-button storybook-more-button nodrag"
                type="button"
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                onClick={() => {
                  setMoreOpen((current) => !current);
                  setOutputSettingsOpen(false);
                }}
              >
                More
              </button>
              {moreOpen && (
                <div className="storybook-more-popover" role="menu">
                  <button type="button" role="menuitem" onClick={() => runMoreAction(onImportOpeningHistory)}>
                    Import Current Chat as Opening History
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => askConfirm({
                      title: 'Reset Opening History',
                      message: 'This clears only the imported Opening History turns from this Storybook.',
                      confirmLabel: 'Reset',
                      danger: true,
                      action: onClearOpeningHistory,
                    })}
                  >
                    Reset Opening History
                  </button>
                  <button
                    className="danger"
                    type="button"
                    role="menuitem"
                    onClick={() => askConfirm({
                      title: 'Reset Storybook',
                      message: 'This clears scenario, characters, and Opening History.',
                      confirmLabel: 'Reset Storybook',
                      danger: true,
                      action: onResetStorybook,
                    })}
                  >
                    Reset Storybook
                  </button>
                  <button type="button" role="menuitem" onClick={() => runMoreAction(onImportSillyTavernCharacter)}>
                    Import SillyTavern Character
                  </button>
                </div>
              )}
            </div>
            <button type="button" className="close-button danger" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="storybook-creator-body">
          {fileActionStatus && <span className="run-note storybook-file-status">{fileActionStatus}</span>}

          <div className="storybook-main-workspace">
            {/* Left Column: Document Panel */}
            <div className="storybook-document-panel">
              <div className="storybook-panel-header">
                <span className="panel-title">Storybook Document</span>
                <div className="storybook-tabs">
                  <button
                    type="button"
                    className={`tab-button ${viewMode === 'ui' ? 'active' : ''}`}
                    onClick={() => setViewMode('ui')}
                  >
                    UI Preview
                  </button>
                  <button
                    type="button"
                    className={`tab-button ${viewMode === 'text' ? 'active' : ''}`}
                    onClick={() => setViewMode('text')}
                  >
                    Formatted Text
                  </button>
                  <button
                    type="button"
                    className={`tab-button ${viewMode === 'json' ? 'active' : ''}`}
                    onClick={() => setViewMode('json')}
                  >
                    Raw JSON
                  </button>
                </div>
              </div>

              <div className="storybook-panel-content">
                {viewMode === 'json' && (
                  <div className="storybook-json-panel">
                    <JsonSyntaxTextarea
                      id="storybook-json-view"
                      readOnly
                      value={JSON.stringify(sanitizeDataUrls(storybook), null, 2)}
                    />
                  </div>
                )}

                {viewMode === 'text' && (
                  <div className="storybook-text-panel">
                    <textarea
                      id="storybook-formatted-text-view"
                      readOnly
                      spellCheck={false}
                      value={rpStorybookFormattedText(storybook, node.data.storybookFormattedTextSettings)}
                    />
                  </div>
                )}

                {viewMode === 'ui' && (
                  <div className="storybook-ui-view">
                    {/* Header: Title and Introduction */}
                    <div className="storybook-ui-header">
                      <div className="storybook-ui-cover-art">
                        <div className="book-spine"></div>
                        <div className="book-details">
                          <h3>{storybook.title || 'Untitled RP Storybook'}</h3>
                          <p className="storybook-intro">
                            {storybook.introduction || 'No introduction defined.'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Section: Scenario */}
                    <section className="storybook-section scenario-section">
                      <div className="section-header">
                        <h4>Scenario</h4>
                      </div>
                      <div className="section-content">
                        <div className="scenario-field">
                          <span className="field-label">Summary</span>
                          <p>{storybook.scenario.summary || 'No scenario summary defined.'}</p>
                        </div>
                        <div className="scenario-grid">
                          <div className="scenario-field">
                            <span className="field-label">Opening Situation</span>
                            <p>{storybook.scenario.openingSituation || 'No opening situation defined.'}</p>
                          </div>
                          <div className="scenario-field">
                            <span className="field-label">Current Situation</span>
                            <p>{storybook.scenario.currentSituation || 'No current situation defined.'}</p>
                          </div>
                        </div>
                      </div>
                    </section>

                    {/* Section: Characters */}
                    <section className="storybook-section actors-section">
                      <div className="section-header">
                        <h4>Charakter</h4>
                        <button
                          type="button"
                          className="contextual-action-button nodrag"
                          onClick={onImportSillyTavernCharacter}
                          title="Import SillyTavern Character Card"
                        >
                          <span className="button-icon">+</span> SillyTavern Import
                        </button>
                      </div>
                       {storybook.characters.length ? (
                        <div className="storybook-actor-grid">
                          {storybook.characters.map((character) => {
                            const comfyStatus = storybookCharacterComfyStatus({
                              character,
                              createImageActions,
                              connections,
                              providerHealthById,
                            });
                            return (
                            <article className="storybook-actor-card" key={character.id}>
                              <div className="character-card-header">
                                <button
                                  type="button"
                                  className="character-avatar-button nodrag"
                                  title={`Change profile pic for ${character.name || character.id}`}
                                  onClick={() => {
                                    setImageDialogMode('profile');
                                    setImageOwner({ kind: 'character', characterId: character.id });
                                  }}
                                >
                                  <CharacterAvatar
                                    className="avatar-circle actor-avatar"
                                    name={character.name || character.id}
                                    fallback={
                                      character.name
                                        ? character.name.substring(0, 2).toUpperCase()
                                        : character.id.substring(0, 2).toUpperCase()
                                    }
                                    profileImageDataUrl={character.profileImage?.dataUrl}
                                  />
                                </button>
                                <div className="character-card-title-side">
                                  <h5 className="character-name">{character.name || character.id}</h5>
                                  {character.role && <p className="character-subrole">{character.role}</p>}
                                </div>
                              </div>
                              
                              <div className="character-fields">
                                {character.description && (
                                  <div className="character-field">
                                    <span className="field-label">Description</span>
                                    <p>{character.description}</p>
                                  </div>
                                )}
                                {character.personality && (
                                  <div className="character-field">
                                    <span className="field-label">Personality</span>
                                    <p>{character.personality}</p>
                                  </div>
                                )}
                                {character.speechStyle && (
                                  <div className="character-field">
                                    <span className="field-label">Speech Style</span>
                                    <p>{character.speechStyle}</p>
                                  </div>
                                )}
                              </div>

                              <div className="character-card-footer">
                                <button
                                  type="button"
                                  className={`character-images-button character-comfy-config-button nodrag${comfyStatus.active ? ' configured' : ''}`}
                                  onClick={() => setComfyConfigCharacterId(character.id)}
                                >
                                  <span>Character Setup</span>
                                  {comfyStatus.active ? <span aria-hidden="true">✓</span> : null}
                                </button>
                                <button
                                  type="button"
                                  className="character-images-button nodrag"
                                  onClick={() => {
                                    setImageDialogMode('images');
                                    setImageOwner({ kind: 'character', characterId: character.id });
                                  }}
                                >
                                  Character Images
                                </button>
                                <span className="character-image-summary">{imageStatusText(character.images)}</span>
                              </div>
                            </article>
                          );
                          })}
                        </div>
                      ) : (
                        <p className="no-data-msg">No characters defined yet. Click SillyTavern Import above or ask the assistant to add characters.</p>
                      )}
                    </section>

                    <section className="storybook-section phone-contacts-section">
                      <div className="section-header">
                        <div className="section-title-with-help">
                          <h4>Phone Contacts</h4>
                          <button
                            type="button"
                            className="node-info-button storybook-section-help"
                            aria-label="Phone Contacts visibility help"
                            data-tooltip="Only controls Phone UI visibility, so each character does not have to see every Storybook contact. If roleplay creates a message to a hidden contact, that conversation automatically appears for both characters again."
                          >
                            ?
                          </button>
                        </div>
                      </div>
                      {phoneContactCharacters.length >= 2 ? (
                        <div className="phone-contact-matrix-wrap">
                          <table className="phone-contact-matrix">
                            <thead>
                              <tr>
                                <th scope="col">Owner</th>
                                {phoneContactCharacters.map((contact) => (
                                  <th scope="col" key={contact.ref}>
                                    <span title={contact.name}>{contact.name}</span>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {phoneContactCharacters.map((owner) => (
                                <tr key={owner.ref}>
                                  <th scope="row">
                                    <span title={owner.name}>{owner.name}</span>
                                  </th>
                                  {phoneContactCharacters.map((contact) => {
                                    const sameCharacter = owner.ref === contact.ref;
                                    const allowed = rpStorybookPhoneContactAllowed(
                                      storybook,
                                      owner.ref,
                                      contact.ref,
                                    );
                                    return (
                                      <td key={contact.ref}>
                                        {sameCharacter ? (
                                          <span className="phone-contact-self">-</span>
                                        ) : (
                                          <button
                                            type="button"
                                            className={`phone-contact-cell${allowed ? ' allowed' : ' blocked'}`}
                                            aria-pressed={allowed}
                                            title={`${owner.name} ${allowed ? 'can see' : 'cannot see'} ${contact.name}`}
                                            onClick={() => {
                                              onUpdateStorybook(
                                                withRpStorybookPhoneContactPairBlocked(
                                                  storybook,
                                                  owner.ref,
                                                  contact.ref,
                                                  allowed,
                                                ),
                                                allowed
                                                  ? `Blocked ${owner.name} <-> ${contact.name}.`
                                                  : `Allowed ${owner.name} <-> ${contact.name}.`,
                                              );
                                            }}
                                          >
                                            {allowed ? '✓' : '×'}
                                          </button>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="no-data-msg">Add at least two characters to configure phone contacts.</p>
                      )}
                    </section>

                    {/* Section: Opening History */}
                    <section className="storybook-section history-section">
                      <div className="section-header">
                        <h4>Opening History</h4>
                        <div className="header-actions">
                          <button
                            type="button"
                            className="contextual-action-button nodrag"
                            onClick={onImportOpeningHistory}
                            title="Import Current Conversation Messages as Opening History"
                          >
                            Import Current Chat
                          </button>
                          {storybook.openingHistory.turns.length > 0 && (
                            <button
                              type="button"
                              className="contextual-action-button danger nodrag"
                              onClick={() => askConfirm({
                                title: 'Reset Opening History',
                                message: 'This clears only the imported Opening History turns from this Storybook.',
                                confirmLabel: 'Reset',
                                danger: true,
                                action: onClearOpeningHistory,
                              })}
                              title="Clear all Opening History turns"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="history-summary-box">
                        <p className="history-summary-text">
                          {storybook.openingHistory.summary || 'No opening history summary defined.'}
                        </p>
                        <div className="history-status-row">
                          <span className="message-count-badge">
                            {storybook.openingHistory.turns.length} turns / {openingHistoryMessages.length} messages imported
                          </span>
                          {storybook.openingHistory.turns.length > 0 && (
                            <button
                              type="button"
                              className="toggle-messages-button nodrag"
                              onClick={() => setHistoryExpanded(!historyExpanded)}
                            >
                              {historyExpanded ? 'Hide Messages ▲' : 'Show Messages ▼'}
                            </button>
                          )}
                        </div>
                      </div>

                      {historyExpanded && openingHistoryMessages.length > 0 && (
                        <div className="history-timeline">
                          {openingHistoryMessages.map(({ message: msg, turnNumber }, idx) => {
                            const isUser = msg.role === 'user';
                            return (
                              <div key={`${turnNumber}-${msg.id}-${idx}`} className={`timeline-entry ${msg.channel ?? 'rp'} ${msg.role}`}>
                                <div className="entry-header">
                                  <span className="entry-channel-badge">{(msg.channel ?? 'rp').toUpperCase()}</span>
                                  <span className="entry-speaker">
                                    {msg.speakerName || (isUser ? 'User' : 'RP Output')}
                                  </span>
                                  {msg.rpDateTime && <span className="entry-time">{msg.rpDateTime}</span>}
                                  <span className="entry-turn">Turn {turnNumber}</span>
                                </div>
                                <div className="entry-body">
                                  {!!msg.imageAttachments?.length && (
                                    <div className="opening-history-images">
                                      {msg.imageAttachments.map((image) => (
                                        <img key={image.id} src={image.dataUrl} alt={image.name} />
                                      ))}
                                    </div>
                                  )}
                                  <p className="entry-text">{msg.originalText}</p>
                                  {(msg.phoneImageDescription || msg.rpImageDescription) && (
                                    <div className="entry-image-desc">
                                      <strong>Image Attachment Description:</strong>{' '}
                                      {msg.phoneImageDescription ?? msg.rpImageDescription}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Chat Panel */}
            <div className="storybook-chat-panel">
              <div className="storybook-chat-header">
                <span className="panel-title">AI Storybook Assistant</span>
                <span className="panel-subtitle">Ask the assistant to draft, expand, or refine any part of your storybook.</span>
              </div>
              
              <div className="storybook-chat-log">
                {messages.length === 0 ? (
                  <div className="chat-empty-state">
                    <div className="assistant-avatar-large">AI</div>
                    <p className="empty-title">Welcome to Storybook Creator</p>
                    <p className="empty-description">
                      You can instruct the AI to build your roleplay settings. Try prompts like:
                    </p>
                    <ul className="prompt-suggestions">
                      <li onClick={() => setDraft("Create a dark fantasy storybook set in a cursed tower")}>
                        "Create a dark fantasy storybook set in a cursed tower"
                      </li>
                      <li onClick={() => setDraft("Add a character named Julian, a rogue prince")}>
                        "Add a character named Julian, a rogue prince"
                      </li>
                      <li onClick={() => setDraft("Add an npc named Lilith who is a mysterious merchant")}>
                        "Add an npc named Lilith who is a mysterious merchant"
                      </li>
                    </ul>
                  </div>
                ) : (
                  messages.map((message, index) => (
                    <div className={`chat-message-row ${message.role}`} key={`${message.role}-${index}`}>
                      <div className="message-sender-avatar">
                        {message.role === 'user' ? 'U' : message.role === 'assistant' ? 'AI' : '!'}
                      </div>
                      <div className="chat-message-bubble">
                        <p>{message.text}</p>
                      </div>
                    </div>
                  ))
                )}
                {isSubmitting && (
                  <div className="chat-message-row assistant thinking">
                    <div className="message-sender-avatar">AI</div>
                    <div className="chat-message-bubble typing-bubble">
                      <div className="typing-indicator">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <form className="storybook-chat-form" onSubmit={submit}>
                <textarea
                  className="nodrag nowheel"
                  rows={4}
                  value={draft}
                  placeholder="Ask the assistant to change details or add characters..."
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      submitDraft();
                    }
                  }}
                />
                <button type="submit" className="send-message-button" disabled={isSubmitting || !draft.trim()}>
                  {isSubmitting ? 'Sending...' : 'Send'}
                </button>
              </form>
            </div>
          </div>
        </div>
        {imageOwner && (
          <CharacterImagesDialog
            key={storybookImageOwnerKey(imageOwner)}
            storybook={storybook}
            owner={imageOwner}
            initialMode={imageDialogMode}
            usedImageIds={usedImageIds}
            imageCaptionChangesById={imageCaptionChangesById}
            promptTextCustomPresets={promptTextCustomPresets}
            setPromptTextCustomPresets={setPromptTextCustomPresets}
            onUpdateStorybook={onUpdateStorybook}
            onChangeImageCaptionUpdate={onChangeImageCaptionUpdate}
            onDescribeCharacterImage={onDescribeCharacterImage}
            onClose={() => setImageOwner(null)}
          />
        )}
        {comfyConfigCharacterId && (
          <CharacterSetupDialog
            storybook={storybook}
            characterId={comfyConfigCharacterId}
            workflowNodes={workflowNodes}
            connections={connections}
            providerHealthById={providerHealthById}
            onUpdateStorybook={onUpdateStorybook}
            onLoadCharacterComfyLoras={onLoadCharacterComfyLoras}
            onGenerateCharacterComfyPreview={onGenerateCharacterComfyPreview}
            onGenerateCharacterVoicePreview={onGenerateCharacterVoicePreview}
            onUnloadCharacterComfyModels={onUnloadCharacterComfyModels}
            onClose={() => setComfyConfigCharacterId(null)}
          />
        )}
        {confirmAction && (
          <div className="storybook-confirm-backdrop" role="presentation" onClick={() => setConfirmAction(null)}>
            <section
              className="storybook-confirm-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="storybook-confirm-title"
              aria-describedby="storybook-confirm-message"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 id="storybook-confirm-title">{confirmAction.title}</h3>
              <p id="storybook-confirm-message">{confirmAction.message}</p>
              <div className="storybook-confirm-actions">
                <button className="inspect-button nodrag" type="button" onClick={() => setConfirmAction(null)}>
                  Cancel
                </button>
                <button
                  className={`inspect-button nodrag${confirmAction.danger ? ' danger' : ''}`}
                  type="button"
                  onClick={confirmPendingAction}
                >
                  {confirmAction.confirmLabel}
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

type OutputFormatHelpDialogProps = {
  kind: OutputFormatHelpKind;
  onClose: () => void;
};

export function OutputFormatHelpDialog({
  kind,
  onClose,
}: OutputFormatHelpDialogProps) {
  const help = outputFormatHelp[kind];
  const isPromptHelp = kind === 'output-actions';
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onClose);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <section
        className="output-format-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={help.title}
      >
        <div className="dialog-header">
          <div>
            <h2>{help.title}</h2>
            <p>{help.description}</p>
          </div>
          <button type="button" className="close-button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="output-format-dialog-body">
          <label className="node-field-label" htmlFor="output-format-prompt">
            {isPromptHelp ? 'SIMPLE PROMPT' : 'OVERVIEW'}
          </label>
          <JsonSyntaxTextarea
            id="output-format-prompt"
            rows={kind === 'phone' ? 19 : 17}
            readOnly
            value={help.prompt}
          />
        </div>
      </section>
    </div>
  );
}

type SystemLogDialogProps = {
  entries: SystemLogEntry[];
  counts: Record<SystemLogLevel, number>;
  turnTraces: TurnTrace[];
  estimatedTokenBytesPerToken: number;
  onClear: () => void;
  onClose: () => void;
  onCreateDebugSnapshot?: () => DebugSnapshot;
};

type DebugSnapshot = {
  schema: 'rpgraph-debug-snapshot';
  version: number;
  createdAt: string;
  compression?: {
    mode: 'compact-debug-copy';
    textPreviewCharacters: number;
  };
  selectedSections: string[];
  appState: Record<string, unknown>;
  lastRun: Record<string, unknown>;
  recentTurns: unknown[];
  promptSwitch: Record<string, unknown>;
  eventManager: Record<string, unknown>;
  nodes: unknown[];
  edges: unknown[];
  systemLog: unknown[];
};

type DebugSnapshotSection = {
  id: string;
  label: string;
  snapshotKey: keyof Pick<
    DebugSnapshot,
    | 'appState'
    | 'lastRun'
    | 'recentTurns'
    | 'promptSwitch'
    | 'eventManager'
    | 'nodes'
    | 'edges'
    | 'systemLog'
  >;
  tokenEstimate: number;
  defaultSelected: boolean;
};

const compactSnapshotTextPreviewCharacters = 360;

function compactSnapshotText(
  text: string,
  textMetrics: TextMetricsApi,
  previewLength = compactSnapshotTextPreviewCharacters,
) {
  return {
    characters: text.length,
    estimatedTokens: textMetrics.measure(text).tokens,
    preview: text.length > previewLength ? `${text.slice(0, previewLength)}...` : text,
  };
}

function compactSnapshotCopyValue(value: unknown, textMetrics: TextMetricsApi, key = ''): unknown {
  if (typeof value === 'string') {
    const sanitized = sanitizeDataUrlsInText(value);
    const alwaysSummarize = new Set([
      'combinedPrompt',
      'eventLastPrompt',
      'eventLastResponse',
      'fullText',
      'generatedText',
      'graphText',
      'inputValue',
      'lastRpOutput',
      'originalHistory',
      'promptAfter',
      'translatedHistory',
    ]);
    return sanitized.length > 700 || alwaysSummarize.has(key)
      ? compactSnapshotText(sanitized, textMetrics)
      : sanitized;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => compactSnapshotCopyValue(entry, textMetrics));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([entryKey]) => entryKey !== 'dataUrl')
        .map(([entryKey, entryValue]) => [entryKey, compactSnapshotCopyValue(entryValue, textMetrics, entryKey)]),
    );
  }
  return value;
}

export function SystemLogDialog({
  entries,
  counts,
  turnTraces,
  estimatedTokenBytesPerToken,
  onClear,
  onClose,
  onCreateDebugSnapshot,
}: SystemLogDialogProps) {
  const [debugSnapshot, setDebugSnapshot] = useState<DebugSnapshot | null>(null);
  const [selectedDebugSections, setSelectedDebugSections] = useState<Record<string, boolean>>({});
  const [debugSnapshotToonEnabled, setDebugSnapshotToonEnabled] = useState(false);
  const [debugSnapshotCompressed, setDebugSnapshotCompressed] = useState(false);
  const [debugSnapshotPreviewOpen, setDebugSnapshotPreviewOpen] = useState(false);
  const [turnTraceOpen, setTurnTraceOpen] = useState(false);
  const [snapshotCopied, setSnapshotCopied] = useState(false);
  const [snapshotCopyError, setSnapshotCopyError] = useState('');
  const textMetrics = useMemo(
    () => new TextMetricsApi(estimatedTokenBytesPerToken),
    [estimatedTokenBytesPerToken],
  );
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onClose);
  const debugSections = debugSnapshot ? debugSnapshotSections(debugSnapshot, textMetrics) : [];
  const snapshotSectionCopyValue = (section: DebugSnapshotSection) =>
    debugSnapshotCompressed && debugSnapshot
      ? compactSnapshotCopyValue(debugSnapshot[section.snapshotKey], textMetrics)
      : debugSnapshot?.[section.snapshotKey];
  const selectedTokenTotal = debugSections.reduce(
    (total, section) =>
      total + (
        selectedDebugSections[section.id]
          ? estimateSnapshotTokens(snapshotSectionCopyValue(section), debugSnapshotToonEnabled, textMetrics)
          : 0
      ),
    0,
  );
  const selectedSnapshotSections = () =>
    debugSections.filter((section) => selectedDebugSections[section.id]);
  const selectedSnapshotPayload = (selectedSections = selectedSnapshotSections()): DebugSnapshot => {
    if (!debugSnapshot) {
      throw new Error('No debug snapshot is open.');
    }
    const selectedSectionIds = selectedSections.map((section) => section.id);
    const payload: DebugSnapshot = {
      schema: debugSnapshot.schema,
      version: debugSnapshot.version,
      createdAt: new Date().toISOString(),
      compression: debugSnapshotCompressed
        ? {
            mode: 'compact-debug-copy',
            textPreviewCharacters: compactSnapshotTextPreviewCharacters,
          }
        : undefined,
      selectedSections: selectedSectionIds,
      appState: {},
      lastRun: {},
      recentTurns: [],
      promptSwitch: {},
      eventManager: {},
      nodes: [],
      edges: [],
      systemLog: [],
    };
    selectedSections.forEach((section) => {
      (payload as Record<string, unknown>)[section.snapshotKey] = snapshotSectionCopyValue(section);
    });
    return payload;
  };
  const selectedSnapshotPreviewSections = () =>
    selectedSnapshotSections().map((section) => {
      const value = snapshotSectionCopyValue(section);
      return {
        id: section.id,
        label: section.label,
        tokenEstimate: estimateSnapshotTokens(value, debugSnapshotToonEnabled, textMetrics),
        text: debugSnapshotToonEnabled
          ? formatContextValue(value, 'toon')
          : JSON.stringify(value ?? null, null, 2),
      };
    });

  const openDebugSnapshot = () => {
    if (!onCreateDebugSnapshot) {
      return;
    }
    const snapshot = onCreateDebugSnapshot();
    const sections = debugSnapshotSections(snapshot, textMetrics);
    setDebugSnapshot(snapshot);
    setSelectedDebugSections(Object.fromEntries(sections.map((section) => [section.id, section.defaultSelected])));
    setDebugSnapshotPreviewOpen(false);
    setSnapshotCopied(false);
    setSnapshotCopyError('');
  };

  const closeDebugSnapshot = () => {
    setDebugSnapshot(null);
    setDebugSnapshotPreviewOpen(false);
    setSnapshotCopied(false);
    setSnapshotCopyError('');
  };
  const debugSnapshotBackdropDismiss = useBackdropDismiss<HTMLDivElement>(closeDebugSnapshot);

  const copySelectedSnapshot = () => {
    if (!debugSnapshot) {
      return;
    }
    const payload = selectedSnapshotPayload();
    const encodedPayload = debugSnapshotToonEnabled
      ? formatContextValue(payload, 'toon')
      : JSON.stringify(payload, null, 2);
    void copyTextToClipboard(encodedPayload)
      .then(() => {
        setSnapshotCopied(true);
        setSnapshotCopyError('');
      })
      .catch((error) => {
        setSnapshotCopied(false);
        setSnapshotCopyError(error instanceof Error ? error.message : String(error));
      });
  };

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (turnTraceOpen) {
          setTurnTraceOpen(false);
          return;
        }
        if (debugSnapshotPreviewOpen) {
          setDebugSnapshotPreviewOpen(false);
          return;
        }
        if (debugSnapshot) {
          closeDebugSnapshot();
          return;
        }
        onClose();
      }
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, turnTraceOpen, debugSnapshotPreviewOpen, debugSnapshot]);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <section className="system-log-dialog" role="dialog" aria-modal="true" aria-label="System Log">
        <div className="dialog-header">
          <div>
            <h2>System Log</h2>
            <p>
              {entries.length} entries / {counts.error} errors / {counts.warning} warnings /{' '}
              {counts.info} notes
            </p>
          </div>
        </div>
        <div className="system-log-list">
          {entries.length === 0 ? (
            <p className="empty-log">No warnings, errors, or notes yet.</p>
          ) : (
            [...entries].reverse().map((entry) => (
              <article className={`system-log-entry ${entry.level}`} key={entry.id}>
                <div>
                  <strong>{entry.level}</strong>
                  <time>{formatLogTimestamp(entry.createdAt)}</time>
                </div>
                <p>{entry.text}</p>
              </article>
            ))
          )}
        </div>
        <footer className="system-log-actions">
          <button className="close-button" type="button" onClick={() => setTurnTraceOpen(true)}>
            Turn Trace
          </button>
          {onCreateDebugSnapshot && (
            <button className="close-button" type="button" onClick={openDebugSnapshot}>
              Debug Snapshot
            </button>
          )}
          <button className="close-button" type="button" onClick={onClose}>
            Close
          </button>
          {entries.length > 0 && (
            <button
              className="close-button primary"
              type="button"
              onClick={() => {
                onClear();
                onClose();
              }}
            >
              Clear Log
            </button>
          )}
        </footer>
        {debugSnapshot && (
          <div
            className="debug-snapshot-popover-backdrop"
            role="presentation"
            {...debugSnapshotBackdropDismiss}
          >
            <section className="debug-snapshot-popover" role="dialog" aria-modal="true" aria-label="Debug Snapshot">
              <div className="debug-snapshot-header">
                <div>
                  <h3>Debug Snapshot</h3>
                  <p>Selected total ~{selectedTokenTotal.toLocaleString()} tokens</p>
                </div>
                <div className="debug-snapshot-options">
                  <div className="debug-format-tabs" role="tablist" aria-label="Debug Snapshot encoding">
                    <button
                      className={!debugSnapshotToonEnabled ? 'active' : ''}
                      type="button"
                      role="tab"
                      aria-selected={!debugSnapshotToonEnabled}
                      onClick={() => {
                        setSnapshotCopied(false);
                        setDebugSnapshotToonEnabled(false);
                      }}
                    >
                      JSON
                    </button>
                    <button
                      className={debugSnapshotToonEnabled ? 'active' : ''}
                      type="button"
                      role="tab"
                      aria-selected={debugSnapshotToonEnabled}
                      onClick={() => {
                        setSnapshotCopied(false);
                        setDebugSnapshotToonEnabled(true);
                      }}
                    >
                      TOON
                    </button>
                  </div>
                  <label className="debug-compression-toggle">
                    <input
                      type="checkbox"
                      checked={debugSnapshotCompressed}
                      onChange={(event) => {
                        setSnapshotCopied(false);
                        setDebugSnapshotCompressed(event.target.checked);
                      }}
                    />
                    <span>Compressed</span>
                  </label>
                </div>
              </div>
              <div className="debug-snapshot-sections">
                {debugSections.map((section) => (
                  <label className="debug-snapshot-section" key={section.id}>
                    <input
                      type="checkbox"
                      checked={!!selectedDebugSections[section.id]}
                      onChange={(event) => {
                        setSnapshotCopied(false);
                        setSelectedDebugSections((current) => ({
                          ...current,
                          [section.id]: event.target.checked,
                        }));
                      }}
                    />
                    <span>{section.label}</span>
                    <em>~{estimateSnapshotTokens(snapshotSectionCopyValue(section), debugSnapshotToonEnabled, textMetrics).toLocaleString()} tokens</em>
                  </label>
                ))}
              </div>
              {snapshotCopyError && <p className="debug-snapshot-error">{snapshotCopyError}</p>}
              <div className="debug-snapshot-actions">
                <button className="close-button" type="button" onClick={closeDebugSnapshot}>
                  Cancel
                </button>
                <button
                  className="close-button debug-snapshot-view-button"
                  type="button"
                  onClick={() => setDebugSnapshotPreviewOpen(true)}
                  disabled={selectedSnapshotSections().length === 0}
                >
                  View Selected
                </button>
                <button className="close-button primary" type="button" onClick={copySelectedSnapshot}>
                  {snapshotCopied ? 'Copied' : 'Copy Selected'}
                </button>
              </div>
            </section>
            {debugSnapshotPreviewOpen && (
              <section className="debug-snapshot-viewer" role="dialog" aria-modal="true" aria-label="Selected Debug Snapshot View">
                <div className="debug-snapshot-viewer-header">
                  <div>
                    <h3>Selected Debug Snapshot</h3>
                    <p>
                      {selectedSnapshotSections().length} sections / ~{selectedTokenTotal.toLocaleString()} tokens /{' '}
                      {debugSnapshotToonEnabled ? 'TOON' : 'JSON'}
                      {debugSnapshotCompressed ? ' / Compressed' : ''}
                    </p>
                  </div>
                  <button
                    className="close-button"
                    type="button"
                    onClick={() => setDebugSnapshotPreviewOpen(false)}
                  >
                    Close
                  </button>
                </div>
                <div className="debug-snapshot-viewer-body">
                  {selectedSnapshotPreviewSections().length === 0 ? (
                    <p className="debug-snapshot-viewer-empty">No debug sections selected.</p>
                  ) : (
                    selectedSnapshotPreviewSections().map((section) => (
                      <article className="debug-snapshot-view-section" key={section.id}>
                        <header>
                          <strong>{section.label}</strong>
                          <span>~{section.tokenEstimate.toLocaleString()} tokens</span>
                        </header>
                        <pre>{section.text}</pre>
                      </article>
                    ))
                  )}
                </div>
              </section>
            )}
          </div>
        )}
        {turnTraceOpen && (
          <TurnTraceDialog
            traces={turnTraces}
            estimatedTokenBytesPerToken={estimatedTokenBytesPerToken}
            onClose={() => setTurnTraceOpen(false)}
          />
        )}
      </section>
    </div>
  );
}

function debugSnapshotSections(snapshot: DebugSnapshot, textMetrics: TextMetricsApi): DebugSnapshotSection[] {
  return [
    { id: 'app-state', label: 'App State', snapshotKey: 'appState', tokenEstimate: estimateSnapshotTokens(snapshot.appState, false, textMetrics), defaultSelected: true },
    { id: 'workflow-nodes', label: 'Workflow Nodes (Compact Runtime, includes RP Time prompt/response)', snapshotKey: 'nodes', tokenEstimate: estimateSnapshotTokens(snapshot.nodes, false, textMetrics), defaultSelected: false },
    { id: 'workflow-edges', label: 'Workflow Connections', snapshotKey: 'edges', tokenEstimate: estimateSnapshotTokens(snapshot.edges, false, textMetrics), defaultSelected: false },
    { id: 'last-run-debug', label: 'Last Run Debug', snapshotKey: 'lastRun', tokenEstimate: estimateSnapshotTokens(snapshot.lastRun, false, textMetrics), defaultSelected: true },
    { id: 'recent-turns', label: 'Recent Turns (last two turns)', snapshotKey: 'recentTurns', tokenEstimate: estimateSnapshotTokens(snapshot.recentTurns, false, textMetrics), defaultSelected: true },
    { id: 'prompt-switch-debug', label: 'Prompt Switch Debug', snapshotKey: 'promptSwitch', tokenEstimate: estimateSnapshotTokens(snapshot.promptSwitch, false, textMetrics), defaultSelected: true },
    { id: 'event-manager-debug', label: 'Event Manager Debug', snapshotKey: 'eventManager', tokenEstimate: estimateSnapshotTokens(snapshot.eventManager, false, textMetrics), defaultSelected: true },
    { id: 'system-log', label: 'System Log', snapshotKey: 'systemLog', tokenEstimate: estimateSnapshotTokens(snapshot.systemLog, false, textMetrics), defaultSelected: true },
  ];
}

function estimateSnapshotTokens(value: unknown, useToon: boolean, textMetrics: TextMetricsApi) {
  const text = useToon ? formatContextValue(value, 'toon') : JSON.stringify(value ?? null, null, 2);
  return textMetrics.measure(text).tokens;
}

type ImagePreviewDialogProps = {
  image: ChatImageAttachment;
  caption?: string;
  captionHistory?: ImageCaptionChange[];
  onClose: () => void;
};

type CaptionHistoryTimelineItem =
  | {
      kind: 'original';
      label: string;
      caption: string;
    }
  | {
      kind: 'update';
      label: string;
      beforeCaption?: string;
      afterCaption: string;
    };

function captionHistoryTimeline(captionHistory: ImageCaptionChange[]): CaptionHistoryTimelineItem[] {
  const visibleChanges = captionHistory.filter(
    (change) => change.beforeCaption?.trim() || change.afterCaption.trim(),
  );
  const firstOriginalCaption = visibleChanges[0]?.beforeCaption?.trim();
  const timeline: CaptionHistoryTimelineItem[] = firstOriginalCaption
    ? [{ kind: 'original', label: 'Original Caption', caption: firstOriginalCaption }]
    : [];
  visibleChanges.forEach((change, index) => {
    if (!change.afterCaption.trim()) {
      return;
    }
    timeline.push({
      kind: 'update',
      label: `Update ${index + 1}`,
      beforeCaption: change.beforeCaption?.trim(),
      afterCaption: change.afterCaption.trim(),
    });
  });
  return timeline;
}

function CaptionHistoryList({ items }: { items: CaptionHistoryTimelineItem[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="caption-change-list">
      <strong>Caption History</strong>
      {items.map((item, index) => (
        <div className={`caption-change-list-item ${item.kind}`} key={`${item.kind}-${index}`}>
          <span>{item.label}</span>
          {item.kind === 'original' ? (
            <p>{item.caption}</p>
          ) : (
            <div className="caption-change-history-update">
              {item.beforeCaption && (
                <small>Before: {item.beforeCaption}</small>
              )}
              <p>{item.afterCaption}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ImagePreviewDialog({
  image,
  caption,
  captionHistory = [],
  onClose,
}: ImagePreviewDialogProps) {
  const visibleCaption = caption?.trim();
  const historyTimeline = captionHistoryTimeline(captionHistory);
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onClose);
  return (
    <div
      className="image-preview-backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <section className="image-preview-dialog" role="dialog" aria-modal="true" aria-label={image.name}>
        <div className="image-preview-header">
          <span>{image.name}</span>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className={`image-preview-body${historyTimeline.length > 0 ? ' has-side-panel' : ''}`}>
          <div className="image-preview-stage">
            <img src={image.dataUrl} alt={image.name} />
            {visibleCaption && (
              <div className="image-preview-caption">
                {visibleCaption}
              </div>
            )}
          </div>
          {historyTimeline.length > 0 && (
            <aside className="image-preview-side-panel">
              <CaptionHistoryList items={historyTimeline} />
            </aside>
          )}
        </div>
      </section>
    </div>
  );
}
