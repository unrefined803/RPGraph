import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { StatLine } from '../../components/StatLine';
import { useBackdropDismiss } from '../../components/useBackdropDismiss';
import type { WorkflowNode } from '../../types';
import {
  defaultOutputSpeakerPromptText,
  outputSpeakerPromptSettings,
  outputSpeakerPromptVariables,
  outputSpeakerResponseFormat,
} from './speakerPrompt';
import { useNodeActions } from '../NodeActionsContext';
import { useNodeView } from '../NodeViewContext';
import { ConnectionSelect } from '../shared/ConnectionSelect';
import { LlmCallMetrics, runStateClassName, useNodeLayoutSync } from '../shared/CardView';
import { NodeCustomSelect } from '../shared/NodeCustomSelect';
import { PortLabel } from '../shared/PortValue';
import {
  promptPresetDisplayText,
  promptPresetSource,
  promptSettingForSource,
  type PromptPresetSource,
} from '../shared/promptPresets';

function SpeakerPromptTextarea({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 20;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight + lineHeight}px`;
  }, [value, disabled]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      disabled={disabled}
      spellCheck={false}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

export function OutputNodeCard({ id, data }: NodeProps<WorkflowNode>) {
  const nodeBodyRef = useNodeLayoutSync(id);
  const {
    changeOutputOption,
    showOutputFormatHelp,
    showOutputHighlighting,
    textPreview,
    updateData,
  } = useNodeActions();
  const view = useNodeView();
  const { estimatedTokenBytesPerToken } = view;
  const [showSpeakerPrompt, setShowSpeakerPrompt] = useState(false);
  const speakerPromptBackdropDismiss = useBackdropDismiss<HTMLDivElement>(() => setShowSpeakerPrompt(false));
  const [workflowPromptText, setWorkflowPromptText] = useState<string | undefined>();
  const speakerPrompt = outputSpeakerPromptSettings(data.outputSpeakerPrompt);
  const speakerPromptPresetKey = 'output.speaker-prompt';
  const localSpeakerPromptText = view.promptTextCustomPresets[speakerPromptPresetKey];
  const speakerPromptSource = promptPresetSource(
    speakerPrompt,
    defaultOutputSpeakerPromptText,
    localSpeakerPromptText,
  );
  const speakerPromptText = promptPresetDisplayText(
    speakerPromptSource,
    speakerPrompt,
    defaultOutputSpeakerPromptText,
    localSpeakerPromptText,
  );
  const effectiveWorkflowPromptText = workflowPromptText ?? (
    speakerPromptSource === 'workflow' ? speakerPrompt.customText : undefined
  );
  const speakerFormat = outputSpeakerResponseFormat(data.outputSpeakerResponseFormat);
  const updateSpeakerPrompt = (patch: Partial<typeof speakerPrompt>) => {
    updateData(id, {
      outputSpeakerPrompt: {
        ...speakerPrompt,
        ...patch,
      },
    });
  };
  const saveLocalSpeakerPrompt = (value: string) => {
    view.setPromptTextCustomPresets((current) => ({
      ...current,
      [speakerPromptPresetKey]: value,
    }));
  };
  const switchSpeakerPromptSource = (source: PromptPresetSource) => {
    if (speakerPromptSource === 'workflow' && speakerPrompt.customText) {
      setWorkflowPromptText(speakerPrompt.customText);
    }
    const next = promptSettingForSource(
      source,
      speakerPromptText,
      defaultOutputSpeakerPromptText,
      localSpeakerPromptText,
      effectiveWorkflowPromptText,
    );
    if (source === 'custom') {
      saveLocalSpeakerPrompt(next.customText ?? defaultOutputSpeakerPromptText);
    }
    updateSpeakerPrompt(next);
  };
  return (
    <div className={`workflow-node translator-node output-node${runStateClassName(data)}`} ref={nodeBodyRef}>
      <div className="node-title-row">
        <span className="node-dot" />
        <strong>{data.label}</strong>
      </div>
      <LlmCallMetrics data={data} />
      <span className="node-description">{data.description}</span>
      <ConnectionSelect id={id} label="OUTPUT TRANSLATOR / ANALYSIS LLM" connectionId={data.connectionId} />
      <div className="output-options">
        <label className="node-toggle nodrag">
          <input
            type="checkbox"
            checked={data.streamOutputEnabled ?? false}
            onChange={(event) => changeOutputOption(id, 'streamOutputEnabled', event.target.checked)}
          />
          Stream response live
        </label>
        <label className="node-toggle nodrag">
          <input
            type="checkbox"
            checked={data.speakerAnalysisEnabled ?? false}
            onChange={(event) => changeOutputOption(id, 'speakerAnalysisEnabled', event.target.checked)}
          />
          Detect speakers with LLM
        </label>
        <label className="node-toggle nodrag">
          <input
            type="checkbox"
            disabled={!(data.speakerAnalysisEnabled ?? false)}
            checked={data.dialogueHighlightEnabled ?? false}
            onChange={(event) => changeOutputOption(id, 'dialogueHighlightEnabled', event.target.checked)}
          />
          Highlight spoken text with LLM
        </label>
        <label className="node-field-label" htmlFor={`${id}-speaker-format`}>
          Speaker Format
        </label>
        <NodeCustomSelect
          id={`${id}-speaker-format`}
          value={speakerFormat}
          disabled={!(data.speakerAnalysisEnabled ?? false)}
          onChange={(value) => updateData(id, { outputSpeakerResponseFormat: value })}
          options={[
            { value: 'toon', label: 'TOON (faster)' },
            { value: 'json', label: 'JSON' },
          ]}
        />
      </div>
      <span className="node-field-label metric-label">TOKEN STATS</span>
      <div className="node-metrics">
        <StatLine text={data.preview} bytesPerEstimatedToken={estimatedTokenBytesPerToken} />
      </div>
      <div className="node-actions">
        <button className="inspect-button nodrag" type="button" onClick={() => textPreview(id)}>
          Text Preview
        </button>
        <button
          className="inspect-button nodrag"
          type="button"
          disabled={!data.outputHighlightingResponseToon && !data.outputHighlightingResultToon}
          onClick={() => showOutputHighlighting(id)}
        >
          Highlighting
        </button>
        <button
          className="inspect-button nodrag"
          type="button"
          disabled={!(data.speakerAnalysisEnabled ?? false)}
          onClick={() => setShowSpeakerPrompt(true)}
        >
          Speaker Prompt
        </button>
      </div>
      <div className="workflow-ports">
        <div className="workflow-port workflow-port-input output-format-port">
          <Handle type="target" position={Position.Left} />
          <PortLabel data={data} direction="input" label="Normal RP" valueType="text" />
          <button
            className="node-info-button output-phone-info output-format-help-button nodrag"
            type="button"
            aria-label="Show RP text input format"
            onClick={() => showOutputFormatHelp('rp-output')}
          >
            ?
          </button>
        </div>
        <div className="workflow-port workflow-port-input output-format-port">
          <Handle id="phone-message" type="target" position={Position.Left} />
          <PortLabel data={data} direction="input" handle="phone-message" label="Messenger Apps" valueType="text" />
          <button
            className="node-info-button output-phone-info output-format-help-button nodrag"
            type="button"
            aria-label="Show phone message format"
            onClick={() => showOutputFormatHelp('rp-output')}
          >
            ?
          </button>
        </div>
        <div className="workflow-port workflow-port-input output-format-port">
          <Handle id="social-media" type="target" position={Position.Left} />
          <PortLabel data={data} direction="input" handle="social-media" label="Social Media" valueType="mixed" />
          <button
            className="node-info-button output-phone-info output-format-help-button nodrag"
            type="button"
            aria-label="Show social media format"
            onClick={() => showOutputFormatHelp('rp-output')}
          >
            ?
          </button>
        </div>
        <div className="workflow-port workflow-port-input output-format-port">
          <Handle id="autoplay" type="target" position={Position.Left} />
          <PortLabel data={data} direction="input" handle="autoplay" label="Autoplay" valueType="text" />
          <button
            className="node-info-button output-phone-info output-format-help-button nodrag"
            type="button"
            aria-label="Show Autoplay input format"
            onClick={() => showOutputFormatHelp('rp-output')}
          >
            ?
          </button>
        </div>
        <div className="workflow-port workflow-port-input output-format-port">
          <Handle id="output-actions" type="target" position={Position.Left} />
          <PortLabel data={data} direction="input" handle="output-actions" label="Output Actions" valueType="mixed" />
          <button
            className="node-info-button output-phone-info output-format-help-button nodrag"
            type="button"
            aria-label="Show output actions format"
            onClick={() => showOutputFormatHelp('rp-output')}
          >
            ?
          </button>
        </div>
        <div className="workflow-port workflow-port-input">
          <Handle id="highlighting-context" type="target" position={Position.Left} />
          <PortLabel data={data} direction="input" handle="highlighting-context" label="Highlighting Context" valueType="text" />
          <button
            className="node-info-button output-phone-info output-format-help-button nodrag"
            type="button"
            aria-label="Show RP Output guide"
            onClick={() => showOutputFormatHelp('rp-output')}
          >
            ?
          </button>
        </div>
        <div className="workflow-port workflow-port-input output-format-port">
          <Handle id="direct-actions" type="target" position={Position.Left} />
          <PortLabel data={data} direction="input" handle="direct-actions" label="Direct Actions" valueType="mixed" />
          <button
            className="node-info-button output-phone-info output-format-help-button nodrag"
            type="button"
            aria-label="Show direct actions format"
            onClick={() => showOutputFormatHelp('rp-output')}
          >
            ?
          </button>
        </div>
      </div>
      {showSpeakerPrompt && typeof document !== 'undefined' && createPortal(
        <div className="dialog-backdrop" {...speakerPromptBackdropDismiss}>
          <section
            className="autoturn-instructions-dialog nodrag"
            role="dialog"
            aria-modal="true"
            aria-label="Speaker Prompt"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="dialog-title-row">
              <div>
                <span className="eyebrow">RP OUTPUT</span>
                <h2>Speaker Prompt</h2>
              </div>
              <button type="button" onClick={() => setShowSpeakerPrompt(false)}>
                Close
              </button>
            </div>
            <div className="event-manager-prompt-body">
              <section className="event-manager-prompt-editor">
                <div className="event-manager-prompt-toolbar">
                  <div className="autoturn-instruction-mode" role="group" aria-label="Speaker Prompt mode">
                    <button
                      type="button"
                      className={speakerPromptSource === 'default' ? 'active' : ''}
                      onClick={() => switchSpeakerPromptSource('default')}
                    >
                      Default
                    </button>
                    <button
                      type="button"
                      className={speakerPromptSource === 'custom' ? 'active' : ''}
                      onClick={() => switchSpeakerPromptSource('custom')}
                    >
                      Custom
                    </button>
                    <button
                      type="button"
                      className={speakerPromptSource === 'workflow' ? 'active' : ''}
                      disabled={!effectiveWorkflowPromptText}
                      onClick={() => switchSpeakerPromptSource('workflow')}
                    >
                      In Workflow
                    </button>
                  </div>
                  <div className="event-manager-prompt-heading">
                    <h3>Speaker Prompt</h3>
                  </div>
                </div>
                <div className="event-manager-prompt-variables" aria-label="Speaker Prompt variables">
                  {outputSpeakerPromptVariables.map((variable) => (
                    <span key={variable}>{variable}</span>
                  ))}
                </div>
                <SpeakerPromptTextarea
                  value={speakerPromptText}
                  disabled={speakerPromptSource === 'default'}
                  onChange={(value) => {
                    if (speakerPromptSource === 'custom') {
                      saveLocalSpeakerPrompt(value);
                    }
                    updateSpeakerPrompt({
                      mode: 'custom',
                      customText: value,
                    });
                  }}
                />
              </section>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}
