import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  defaultPromptActionConfig,
  defaultPromptActionRunAfterReply,
  isDefaultPromptActionConfig,
  promptActionConditions,
  promptActionConfigsEqual,
  promptActionHintText,
  promptActionPromptTitle,
  promptActionTitle,
  promptActionRuntimeConfigFromConfig,
  promptActionTemplateConfig,
  promptActionIds,
  withPromptActionRuntimeSettings,
  type PromptActionConfig,
  type PromptActionCondition,
  type PromptActionId,
  type PromptActionRuntimeSettings,
} from './promptActions';
import {
  defaultPromptCommandInstructionTemplate,
  isDefaultPromptCommandConfig,
  promptCommandHintText,
  promptCommandIds,
  promptCommandTokenText,
  type PromptCommandConfig,
} from './promptCommands';
import type { ConnectionPreset, ProviderConnectionHealth, WorkflowNode } from '../../types';
import type { PromptPreviewPart, PromptRunDebug } from './promptRun';
import { JsonSyntaxTextarea } from './JsonSyntaxTextarea';
import { HighlightedPreviewText } from './HighlightedPreviewText';
import { NodeCustomSelect } from './NodeCustomSelect';
import { providerOption } from './providerHealthLabels';
import { storybookCreateImageCharactersFromNodes, type StorybookCreateImageCharacter } from '../../storybook/runtime';
import { isComfyImageConnection } from '../../comfy/connectionRole';
import { useBackdropDismiss } from '../../components/useBackdropDismiss';

const promptActionResultLineHeight = 19;
const promptActionResultChromeHeight = 57;
const promptActionResultBreathingRows = 2;
const promptActionResultMinRows = 2;
const promptActionResultMaxRows = 14;
const promptActionResultApproxCharsPerRow = 90;

function countPromptActionResultLines(value: string): number {
  const lines = value.trimEnd().split(/\r?\n/);
  if (!lines.length || (lines.length === 1 && !lines[0].trim())) {
    return 0;
  }
  return lines.reduce(
    (sum, line) => sum + Math.max(1, Math.ceil(Math.max(1, line.length) / promptActionResultApproxCharsPerRow)),
    0,
  );
}

type TemplateVariableStatus = 'active' | 'inactive';
type PromptActionPresetSource = 'default' | 'custom' | 'workflow';
type PromptActionReplaceOptions = {
  close?: boolean;
  presetSource?: PromptActionPresetSource;
};

const createImageMemoryTooltip =
  'Before Create character phone image runs, RPGraph unloads local LM Studio, Ollama, and llama.cpp models so ComfyUI can load its image model. After generation, it frees ComfyUI model memory. API-based LLM providers are ignored. With enough cached RAM for both models, switching is usually quick, often within about two seconds.';

function promptActionTemplateVariableStatuses(
  config: PromptActionConfig,
  visionEnabled = true,
): Record<string, TemplateVariableStatus> {
  if (config.actionId === 'updatePhoneImageCaption') {
    return {
      actionId: 'active',
      imageActionJson: 'active',
      imageId: 'active',
      imageAction: 'active',
      caption: 'active',
    };
  }
  if (config.actionId === 'describeInputImage') {
    return {
      actionId: 'active',
      imageJson: 'active',
      caption: 'active',
    };
  }
  if (config.actionId === 'createImage') {
    return {
      actionId: 'active',
      character: 'active',
      characters: 'active',
      imageId: 'active',
      description: 'active',
      prompt: 'active',
    };
  }
  const effectiveSendImagesToLlm = visionEnabled && config.sendImagesToLlm;
  const imageReferenceStatus: TemplateVariableStatus = effectiveSendImagesToLlm ? 'active' : 'inactive';
  const imageTextStatus: TemplateVariableStatus = effectiveSendImagesToLlm && config.hideImageTextWhenSendingToLlm
    ? 'inactive'
    : 'active';
  return {
    actionId: 'active',
    characters: 'active',
    tags: 'active',
    images: 'active',
    imageId: 'active',
    imageReference: imageReferenceStatus,
    imageReferences: imageReferenceStatus,
    imageText: imageTextStatus,
    imageShownTo: 'active',
    imageIdTag: imageTextStatus,
    imageId_tag: imageTextStatus,
    imageTag: imageTextStatus,
    imageTags: imageTextStatus,
    caption: imageTextStatus,
  };
}

function promptActionInstructionVariableStatuses(
  config: PromptActionConfig,
): Record<string, TemplateVariableStatus> | undefined {
  const statuses: Record<string, TemplateVariableStatus> = {};
  if (!config.runAfterReply && (config.actionId === 'getImageId' || config.actionId === 'createImage')) {
    statuses.plan = 'active';
  }
  if (config.actionId === 'createImage') {
    statuses.availableCharacters = 'active';
  }
  if (config.runAfterReply) {
    statuses.reply = 'active';
    statuses.response = 'active';
  }
  return Object.keys(statuses).length ? statuses : undefined;
}

function promptActionConditionMet(
  condition: PromptActionCondition,
  options: {
    visionEnabled: boolean;
    hasImageInput?: boolean;
    comfyProviderIds: string[];
    selectedComfyProviderId: string;
    providerHealthById: Record<string, ProviderConnectionHealth>;
    createImageCharacters: StorybookCreateImageCharacter[];
  },
) {
  switch (condition.id) {
    case 'vision':
      return options.visionEnabled;
    case 'imageInput':
      return options.hasImageInput === true;
    case 'comfyProvider':
      return options.selectedComfyProviderId
        ? options.comfyProviderIds.includes(options.selectedComfyProviderId)
          && options.providerHealthById[options.selectedComfyProviderId]?.status === 'online'
        : false;
    case 'createImageCharacters':
      return options.createImageCharacters.length > 0;
    default:
      return false;
  }
}

function CreateImageCharacterBadge({
  label,
  active,
}: {
  label: string;
  active: boolean;
}) {
  return (
    <span className={`prompt-action-character-badge${active ? ' active' : ''}`}>
      {label}
    </span>
  );
}

function CreateImageCharacterList({
  characters,
}: {
  characters: StorybookCreateImageCharacter[];
}) {
  return (
    <div className="prompt-action-character-list">
      <div className="prompt-action-character-list-header">
        <span>AVAILABLE CHARACTERS</span>
        <span>{characters.length}</span>
      </div>
      {characters.length ? (
        <div className="prompt-action-character-rows">
          {characters.map((character) => (
            <div
              className="prompt-action-character-row"
              key={character.id}
            >
              <span className="prompt-action-character-name">{character.name}</span>
              <span className="prompt-action-character-badges">
                <CreateImageCharacterBadge label="Appearance" active={character.createImage.hasAppearance} />
                <CreateImageCharacterBadge label="LoRA" active={character.createImage.hasLora} />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <span className="prompt-action-character-empty">No Storybook characters found.</span>
      )}
    </div>
  );
}

export function PromptActionModal({
  id,
  initialConfig,
  initialWorkflowConfig,
  initialActionSelected,
  usageCount,
  customActionPresets,
  promptActionSettings,
  setPromptActionSettings,
  visionEnabled,
  connections,
  nodes,
  providerHealthById,
  onCheckProviderConnection,
  onReplace,
  onSaveCustomPreset,
  onClose,
}: {
  id: string;
  initialConfig: PromptActionConfig;
  initialWorkflowConfig?: PromptActionConfig;
  initialActionSelected: boolean;
  usageCount: number;
  customActionPresets: PromptActionConfig[];
  promptActionSettings: PromptActionRuntimeSettings;
  setPromptActionSettings: (updater: (current: PromptActionRuntimeSettings) => PromptActionRuntimeSettings) => void;
  visionEnabled: boolean;
  connections: ConnectionPreset[];
  nodes: WorkflowNode[];
  providerHealthById: Record<string, ProviderConnectionHealth>;
  onCheckProviderConnection?: (connectionId: string) => void;
  onReplace: (config: PromptActionConfig, scope: 'single' | 'linked', options?: PromptActionReplaceOptions) => void;
  onSaveCustomPreset: (config: PromptActionConfig) => void;
  onClose: () => void;
}) {
  const customPresetForConfig = customActionPresets.find((preset) => preset.actionId === initialConfig.actionId);
  const initialPresetSource: PromptActionPresetSource = isDefaultPromptActionConfig(initialConfig)
    ? 'default'
    : customPresetForConfig && promptActionConfigsEqual(initialConfig, customPresetForConfig)
      ? 'custom'
      : 'workflow';
  const [draft, setDraft] = useState(initialConfig);
  const [selectedActionId, setSelectedActionId] = useState<PromptActionId | ''>(
    initialActionSelected ? initialConfig.actionId : '',
  );
  const [presetSource, setPresetSource] = useState<PromptActionPresetSource>(initialPresetSource);
  const [rememberedWorkflowConfig] = useState<PromptActionConfig | undefined>(
    initialWorkflowConfig ?? (
      initialActionSelected && !isDefaultPromptActionConfig(initialConfig) ? initialConfig : undefined
    ),
  );
  const autoCheckedProviderIds = useRef(new Set<string>());
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onClose);

  const withCurrentRuntimeSettings = (config: PromptActionConfig): PromptActionConfig => ({
    ...config,
    ...promptActionRuntimeConfigFromConfig({
      ...config,
      ...draft,
      actionId: config.actionId,
    }),
  });

  const updateRuntimeConfig = (patch: Partial<PromptActionConfig>) => {
    if (!selectedActionId) {
      return;
    }
    const nextConfig: PromptActionConfig = {
      ...draft,
      ...patch,
      actionId: selectedActionId,
      title: promptActionTitle(selectedActionId),
    };
    setDraft(nextConfig);
    setPromptActionSettings((current) => ({
      ...current,
      [selectedActionId]: promptActionRuntimeConfigFromConfig(nextConfig),
    }));
  };

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const resultContentLines = countPromptActionResultLines(draft.resultTemplate || '');
  const resultVisibleRows = Math.min(
    promptActionResultMaxRows,
    Math.max(promptActionResultMinRows, resultContentLines + promptActionResultBreathingRows),
  );
  const resultPanelBasis = promptActionResultChromeHeight + resultVisibleRows * promptActionResultLineHeight;
  const templateVariableStatuses = promptActionTemplateVariableStatuses(draft, visionEnabled);
  const instructionVariableStatuses = promptActionInstructionVariableStatuses(draft);
  const comfyConnections = connections.filter(isComfyImageConnection);
  const comfyProviderIds = comfyConnections.map((connection) => connection.id);
  const createImageCharacters = storybookCreateImageCharactersFromNodes(nodes);
  const selectedComfyProviderId = comfyProviderIds.includes(draft.comfyProviderId ?? '')
    ? draft.comfyProviderId ?? ''
    : comfyProviderIds[0] ?? '';
  const nextTitle = selectedActionId ? promptActionTitle(selectedActionId) : '';
  const promptTitle = selectedActionId ? promptActionPromptTitle(selectedActionId) : '';
  const actionChanged = !!selectedActionId && initialActionSelected && selectedActionId !== initialConfig.actionId;
  const showSaveThisAction = !!selectedActionId && !initialActionSelected;
  const showReplaceThisAction = !!selectedActionId && actionChanged;
  const showReplaceLinkedActions = showReplaceThisAction && usageCount > 1;
  const selectedActionConditions = selectedActionId ? promptActionConditions(selectedActionId) : [];
  const usesAfterReply = selectedActionId ? defaultPromptActionRunAfterReply(selectedActionId) : false;

  useEffect(() => {
    if (selectedActionId !== 'createImage' || !selectedComfyProviderId) {
      return;
    }
    const status = providerHealthById[selectedComfyProviderId]?.status ?? 'unknown';
    if (
      (status === 'unknown' || status === 'offline') &&
      !autoCheckedProviderIds.current.has(selectedComfyProviderId)
    ) {
      autoCheckedProviderIds.current.add(selectedComfyProviderId);
      onCheckProviderConnection?.(selectedComfyProviderId);
    }
  }, [onCheckProviderConnection, providerHealthById, selectedActionId, selectedComfyProviderId]);

  if (typeof document === 'undefined') {
    return null;
  }

  const savedConfig = () => {
    if (!selectedActionId) {
      return undefined;
    }
    const title = promptActionTitle(selectedActionId);
    const defaults = defaultPromptActionConfig(title, selectedActionId);
    const runAfterReply = defaultPromptActionRunAfterReply(selectedActionId);
    return promptActionTemplateConfig({
      ...draft,
      actionId: selectedActionId,
      title,
      maxReturnedImages: Math.min(20, Math.max(1, Math.trunc(Number(draft.maxReturnedImages) || 1))),
      hideImageTextWhenSendingToLlm: draft.sendImagesToLlm && draft.hideImageTextWhenSendingToLlm,
      manageModelMemoryForComfy: selectedActionId === 'createImage' ? draft.manageModelMemoryForComfy : true,
      runAfterReply,
      comfyProviderId: selectedActionId === 'createImage' ? selectedComfyProviderId : '',
      instructionTemplate: draft.instructionTemplate.trim() || defaults.instructionTemplate,
      afterReplyTemplate: draft.afterReplyTemplate.trim() || defaults.afterReplyTemplate,
      resultTemplate: draft.resultTemplate.trim() || defaults.resultTemplate,
    });
  };

  const replace = (scope: 'single' | 'linked') => {
    const config = savedConfig();
    if (!config) {
      return;
    }
    onReplace(config, scope);
  };

  const applyPresetConfig = (source: PromptActionPresetSource, config: PromptActionConfig) => {
    if (!initialActionSelected) {
      return;
    }
    onReplace(config, 'linked', { close: false, presetSource: source });
  };

  const currentSavedConfig = savedConfig();
  const selectedCustomPreset = selectedActionId
    ? customActionPresets.find((preset) => preset.actionId === selectedActionId)
    : undefined;
  const selectedCustomPresetWithRuntime = selectedCustomPreset
    ? withCurrentRuntimeSettings(selectedCustomPreset)
    : undefined;
  const customPresetHasUnsavedChanges =
    !!currentSavedConfig &&
    presetSource === 'custom' &&
    (!selectedCustomPresetWithRuntime ||
      !promptActionConfigsEqual(currentSavedConfig, selectedCustomPresetWithRuntime));
  const selectedDefaultConfig = selectedActionId
    ? withCurrentRuntimeSettings(defaultPromptActionConfig(promptActionTitle(selectedActionId), selectedActionId))
    : undefined;
  const rememberedWorkflowConfigWithRuntime = rememberedWorkflowConfig
    ? withCurrentRuntimeSettings(rememberedWorkflowConfig)
    : undefined;
  const activePresetSources = {
    default: !!currentSavedConfig && !!selectedDefaultConfig &&
      promptActionConfigsEqual(currentSavedConfig, selectedDefaultConfig),
    custom: !!currentSavedConfig && !!selectedCustomPresetWithRuntime &&
      promptActionConfigsEqual(currentSavedConfig, selectedCustomPresetWithRuntime),
    workflow: !!currentSavedConfig && !!rememberedWorkflowConfigWithRuntime &&
      !isDefaultPromptActionConfig(rememberedWorkflowConfigWithRuntime) &&
      promptActionConfigsEqual(currentSavedConfig, rememberedWorkflowConfigWithRuntime),
  };
  const workflowPresetAvailable =
    !!rememberedWorkflowConfigWithRuntime && !isDefaultPromptActionConfig(rememberedWorkflowConfigWithRuntime);
  const templatesReadOnly = presetSource !== 'custom';

  const saveCustomPreset = () => {
    const config = savedConfig();
    if (!config || presetSource !== 'custom') {
      return;
    }
    onSaveCustomPreset(config);
    applyPresetConfig('custom', config);
  };

  const switchPresetSource = (source: PromptActionPresetSource) => {
    if (!selectedActionId) {
      setPresetSource(source);
      return;
    }
    const canonicalTitle = promptActionTitle(selectedActionId);
    setPresetSource(source);
    if (source === 'default') {
      const defaultConfig = withCurrentRuntimeSettings(defaultPromptActionConfig(canonicalTitle, selectedActionId));
      setDraft(defaultConfig);
      applyPresetConfig(source, defaultConfig);
      return;
    }
    if (source === 'custom') {
      const customPreset = customActionPresets.find((preset) =>
        preset.actionId === selectedActionId,
      );
      const customConfig = withCurrentRuntimeSettings(customPreset ?? {
        ...draft,
        title: canonicalTitle,
        actionId: selectedActionId,
      });
      setDraft(customConfig);
      if (customPreset) {
        applyPresetConfig(source, customConfig);
      }
      return;
    }
    const workflowConfig = withCurrentRuntimeSettings(rememberedWorkflowConfig ?? {
      ...initialConfig,
      title: canonicalTitle,
      actionId: selectedActionId,
    });
    setDraft(workflowConfig);
    applyPresetConfig(source, workflowConfig);
  };

  return createPortal(
    <div
      className="dialog-backdrop nodrag nowheel"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-action-dialog-title`}
      {...backdropDismiss}
    >
      <section className="prompt-action-modal" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <h2 id={`${id}-action-dialog-title`}>Prompt Action</h2>
            <p>Configure the first-pass request, follow-up instructions, and inserted action result.</p>
          </div>
          <div className="prompt-action-header-actions">
            <button className="close-button" type="button" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className={`prompt-action-modal-grid${selectedActionId ? '' : ' awaiting-action'}`}>
          <section className="prompt-action-modal-section settings-column">
            <div className="prompt-action-field">
              <label className="node-field-label" htmlFor={`${id}-action-id`}>INTERNAL ACTION</label>
              <div className="prompt-action-select-row">
                <NodeCustomSelect
                  id={`${id}-action-id`}
                  value={selectedActionId}
                  options={[
                    { value: '', label: 'Select action…' },
                    ...promptActionIds.map((actionId) => ({
                      value: actionId,
                      label: promptActionTitle(actionId),
                    })),
                  ]}
                  onChange={(value) => {
                    const actionId = value as PromptActionId | '';
                    setSelectedActionId(actionId);
                    if (!actionId) {
                      return;
                    }
                    setPresetSource('default');
                    const defaults = withPromptActionRuntimeSettings(
                      defaultPromptActionConfig(promptActionTitle(actionId), actionId),
                      promptActionSettings,
                    );
                    setDraft({
                      ...draft,
                      actionId,
                      title: defaults.title,
                      comfyProviderId: actionId === 'createImage' ? selectedComfyProviderId : '',
                      manageModelMemoryForComfy: defaults.manageModelMemoryForComfy,
                      runAfterReply: defaults.runAfterReply,
                      instructionTemplate: defaults.instructionTemplate,
                      afterReplyTemplate: defaults.afterReplyTemplate,
                      resultTemplate: defaults.resultTemplate,
                    });
                  }}
                />
              </div>
            </div>

            {selectedActionId ? <>
            <div className="prompt-action-field">
              <label className="node-field-label">ACTION PRESET</label>
              <div className="autoturn-instruction-mode prompt-action-preset-tabs" role="group" aria-label="Action preset source">
                <button
                  type="button"
                  className={activePresetSources.default ? 'active' : ''}
                  onClick={() => switchPresetSource('default')}
                >
                  Default
                </button>
                <button
                  type="button"
                  className={activePresetSources.custom ? 'active' : ''}
                  onClick={() => switchPresetSource('custom')}
                >
                  Custom
                </button>
                <button
                  type="button"
                  className={activePresetSources.workflow ? 'active' : ''}
                  disabled={!workflowPresetAvailable}
                  onClick={() => switchPresetSource('workflow')}
                >
                  In Workflow
                </button>
              </div>
              {customPresetHasUnsavedChanges ? (
                <button
                  className="close-button prompt-action-save-button"
                  type="button"
                  onClick={saveCustomPreset}
                >
                  Save Custom
                </button>
              ) : null}
            </div>
            {selectedActionConditions.length ? (
              <div className="prompt-action-field">
                <label className="node-field-label">CONDITIONS</label>
                <div className="prompt-action-condition-list" role="list">
                  {selectedActionConditions.map((condition) => {
                    const met = promptActionConditionMet(condition, {
                      visionEnabled,
                      comfyProviderIds,
                      selectedComfyProviderId,
                      providerHealthById,
                      createImageCharacters,
                    });
                    return (
                      <div
                        className={`prompt-action-condition ${met ? 'met' : 'missing'}`}
                        key={condition.id}
                        role="listitem"
                      >
                        <span className="prompt-action-condition-dot" aria-hidden="true" />
                        <span>{condition.label}</span>
                      </div>
                    );
                  })}
                </div>
                <span className="prompt-action-usage-info">
                  Required at run time. While a condition is not met, this action block is hidden from the prompt.
                </span>
              </div>
            ) : null}
            <div className="prompt-action-field">
              <label className="node-field-label">INTERNAL ACTION NAME</label>
              <span className="prompt-action-usage-info">
                {promptTitle || nextTitle}
              </span>
              <span className="prompt-action-usage-info">
                Globally linked in this node: {usageCount} {usageCount === 1 ? 'use' : 'uses'}.
              </span>
            </div>

            {draft.actionId === 'getImageId' ? (
              <div className="prompt-action-field">
                <label className="node-field-label" htmlFor={`${id}-action-max-images`}>MAX RETURNED IMAGES</label>
                <input
                  id={`${id}-action-max-images`}
                  className="node-text-input node-number-input nodrag nowheel"
                  type="number"
                  min={1}
                  max={20}
                  value={draft.maxReturnedImages}
                  onChange={(event) => updateRuntimeConfig({ maxReturnedImages: Number(event.currentTarget.value) })}
                  onBlur={() => updateRuntimeConfig({
                    maxReturnedImages: Math.min(20, Math.max(1, Math.trunc(Number(draft.maxReturnedImages) || 1))),
                  })}
                />
              </div>
            ) : null}

            {draft.actionId === 'createImage' ? (
              <>
                <div className="prompt-action-field">
                  <label className="node-field-label" htmlFor={`${id}-comfy-provider`}>COMFYUI PROVIDER</label>
                  <NodeCustomSelect
                    id={`${id}-comfy-provider`}
                    value={selectedComfyProviderId}
                    options={comfyConnections.length
                      ? comfyConnections.map((connection) => providerOption(connection, providerHealthById[connection.id]))
                      : [{ value: '', label: 'No ComfyUI provider', disabled: true }]}
                    onChange={(providerId) => updateRuntimeConfig({ comfyProviderId: String(providerId) })}
                  />
                </div>
                <CreateImageCharacterList characters={createImageCharacters} />
              </>
            ) : null}

            <div className="prompt-action-checkbox-group">
              {draft.actionId === 'getImageId' ? (
                <>
                  <label className="node-toggle post-output-toggle nodrag">
                    <input
                      className="nodrag nowheel"
                      type="checkbox"
                      checked={draft.sendImagesToLlm}
                      disabled={!visionEnabled}
                      title={!visionEnabled ? 'Requires Activate vision features on this node provider.' : undefined}
                      onChange={(event) => updateRuntimeConfig({
                        sendImagesToLlm: event.currentTarget.checked,
                        hideImageTextWhenSendingToLlm: event.currentTarget.checked
                          ? draft.hideImageTextWhenSendingToLlm
                          : false,
                      })}
                    />
                    Send the images to LLM
                  </label>
                  {draft.sendImagesToLlm ? (
                    <label className="node-toggle post-output-toggle nodrag nested-checkbox">
                      <input
                        className="nodrag nowheel"
                        type="checkbox"
                        checked={draft.hideImageTextWhenSendingToLlm}
                        disabled={!visionEnabled}
                        title={!visionEnabled ? 'Requires Activate vision features on this node provider.' : undefined}
                        onChange={(event) => updateRuntimeConfig({
                          hideImageTextWhenSendingToLlm: event.currentTarget.checked,
                        })}
                      />
                      Hide image captions/tags from LLM result
                    </label>
                  ) : null}
                </>
              ) : null}
              {draft.actionId === 'createImage' ? (
                <div className="prompt-action-toggle-row">
                  <label className="node-toggle post-output-toggle nodrag">
                    <input
                      className="nodrag nowheel"
                      type="checkbox"
                      checked={draft.manageModelMemoryForComfy}
                      onChange={(event) => updateRuntimeConfig({
                        manageModelMemoryForComfy: event.currentTarget.checked,
                      })}
                    />
                    Unload local LLMs, then unload ComfyUI
                  </label>
                  <button
                    className="node-info-button nodrag"
                    type="button"
                    aria-label={createImageMemoryTooltip}
                    data-tooltip={createImageMemoryTooltip}
                  >
                    ?
                  </button>
                </div>
              ) : null}
            </div>
            {(showSaveThisAction || showReplaceThisAction || showReplaceLinkedActions) ? (
              <div className="prompt-action-replace-actions">
                {showSaveThisAction ? (
                  <button
                    className="close-button prompt-action-save-button"
                    type="button"
                    onClick={() => replace('single')}
                  >
                    Save this Action
                  </button>
                ) : null}
                {showReplaceThisAction ? (
                  <button
                    className="close-button prompt-action-save-button"
                    type="button"
                    onClick={() => replace('single')}
                  >
                    Replace this Action
                  </button>
                ) : null}
                {showReplaceLinkedActions ? (
                  <button
                    className="close-button prompt-action-save-button"
                    type="button"
                    onClick={() => replace('linked')}
                  >
                    Replace all Linked Actions
                  </button>
                ) : null}
              </div>
            ) : null}
            </> : null}
          </section>

          {selectedActionId ? <section
            className="prompt-action-modal-section templates-column"
            style={{ '--prompt-action-result-basis': `${resultPanelBasis}px` } as CSSProperties}
          >
            {usesAfterReply ? (
            <div className="prompt-action-template-panel instruction-panel">
              <div className="prompt-action-template-header">
                <label htmlFor={`${id}-action-after-reply-template`}>AFTER-REPLY ACTION TEMPLATE</label>
              </div>
              <JsonSyntaxTextarea
                id={`${id}-action-after-reply-template`}
                className="node-textarea nodrag nowheel"
                value={draft.afterReplyTemplate}
                readOnly={templatesReadOnly}
                templateVariableStatuses={instructionVariableStatuses}
                onChange={(value) => setDraft({ ...draft, afterReplyTemplate: value })}
              />
            </div>
            ) : (
            <>
            <div className="prompt-action-template-panel hint-panel">
              <div className="prompt-action-template-header">
                <label htmlFor={`${id}-action-hint`}>PROMPT HINT (FIRST PASS, READ-ONLY)</label>
              </div>
              <JsonSyntaxTextarea
                id={`${id}-action-hint`}
                className="node-textarea nodrag nowheel"
                value={promptActionHintText(draft.actionId)}
                readOnly
              />
            </div>
            <div className="prompt-action-template-panel instruction-panel">
              <div className="prompt-action-template-header">
                <label htmlFor={`${id}-action-instruction-template`}>LLM-VISIBLE ACTION TEMPLATE (FOLLOW-UP PASS)</label>
              </div>
              <JsonSyntaxTextarea
                id={`${id}-action-instruction-template`}
                className="node-textarea nodrag nowheel"
                value={draft.instructionTemplate}
                readOnly={templatesReadOnly}
                templateVariableStatuses={instructionVariableStatuses}
                onChange={(value) => setDraft({ ...draft, instructionTemplate: value })}
              />
            </div>
            <div className="prompt-action-template-panel result-panel">
              <div className="prompt-action-template-header">
                <label htmlFor={`${id}-action-template`}>RESULT INSERTION TEMPLATE</label>
              </div>
              <JsonSyntaxTextarea
                id={`${id}-action-template`}
                className="node-textarea nodrag nowheel"
                value={draft.resultTemplate}
                readOnly={templatesReadOnly}
                templateVariableStatuses={templateVariableStatuses}
                onChange={(value) => setDraft({ ...draft, resultTemplate: value })}
              />
            </div>
            </>
            )}
          </section> : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function PromptCommandModal({
  id,
  initialName,
  initialConfig,
  usageCount,
  onSave,
  onClose,
}: {
  id: string;
  initialName: string;
  initialConfig?: PromptCommandConfig;
  usageCount: number;
  onSave: (config: PromptCommandConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<PromptCommandConfig | undefined>(initialConfig);
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onClose);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  if (typeof document === 'undefined') {
    return null;
  }

  const savedDraft = draft
    ? {
        ...draft,
        instructionTemplate: draft.instructionTemplate.trim()
          ? draft.instructionTemplate
          : defaultPromptCommandInstructionTemplate(draft.commandId),
      }
    : undefined;
  const draftIsDefault = !!savedDraft && isDefaultPromptCommandConfig(savedDraft);
  const draftChanged = !!savedDraft && !!initialConfig &&
    savedDraft.instructionTemplate.trim() !== initialConfig.instructionTemplate.trim();

  return createPortal(
    <div
      className="dialog-backdrop nodrag nowheel"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-command-dialog-title`}
      {...backdropDismiss}
    >
      <section className="prompt-action-modal prompt-command-modal" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <h2 id={`${id}-command-dialog-title`}>Prompt Command</h2>
            <p>Optional reply command. The prompt only lists it; the LLM requests it with a final [commands: ...] line, then receives these instructions in a follow-up pass.</p>
          </div>
          <div className="prompt-action-header-actions">
            <button className="close-button" type="button" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="prompt-action-modal-grid">
          <section className="prompt-action-modal-section settings-column">
            <div className="prompt-action-field">
              <label className="node-field-label">COMMAND NAME</label>
              <span className="prompt-action-usage-info">
                {draft
                  ? promptCommandTokenText(draft.commandId)
                  : `@command: ${initialName} (unknown command)`}
              </span>
              <span className="prompt-action-usage-info">
                Globally linked in this node: {usageCount} {usageCount === 1 ? 'use' : 'uses'}.
              </span>
            </div>
            {!draft ? (
              <div className="prompt-action-field">
                <label className="node-field-label">AVAILABLE COMMANDS</label>
                <span className="prompt-action-usage-info">
                  {promptCommandIds.map(promptCommandTokenText).join('\n')}
                </span>
              </div>
            ) : null}
            {draft ? (
              <div className="prompt-action-replace-actions">
                {draftChanged ? (
                  <button
                    className="close-button prompt-action-save-button"
                    type="button"
                    onClick={() => savedDraft && onSave(savedDraft)}
                  >
                    Save this Command
                  </button>
                ) : null}
                {!draftIsDefault ? (
                  <button
                    className="close-button prompt-action-save-button"
                    type="button"
                    onClick={() => setDraft({
                      ...draft,
                      instructionTemplate: defaultPromptCommandInstructionTemplate(draft.commandId),
                    })}
                  >
                    Reset to Default
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
          {draft ? (
            <section
              className="prompt-action-modal-section templates-column"
              style={{ '--prompt-action-result-basis': '92px' } as CSSProperties}
            >
              <div className="prompt-action-template-panel result-panel">
                <div className="prompt-action-template-header">
                  <label htmlFor={`${id}-command-hint`}>PROMPT HINT (FIRST PASS, READ-ONLY)</label>
                </div>
                <JsonSyntaxTextarea
                  id={`${id}-command-hint`}
                  className="node-textarea nodrag nowheel"
                  value={promptCommandHintText(draft.commandId)}
                  readOnly
                />
              </div>
              <div className="prompt-action-template-panel instruction-panel">
                <div className="prompt-action-template-header">
                  <label htmlFor={`${id}-command-instruction`}>COMMAND INSTRUCTIONS (FOLLOW-UP PASS)</label>
                </div>
                <JsonSyntaxTextarea
                  id={`${id}-command-instruction`}
                  className="node-textarea nodrag nowheel"
                  value={draft.instructionTemplate}
                  onChange={(value) => setDraft({ ...draft, instructionTemplate: value })}
                />
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function previewBlock(
  label: string,
  text: string,
  parts: PromptPreviewPart[] = [{ text }],
) {
  return (
    <details className="prompt-preview-section" key={label} open>
      <summary className="prompt-preview-section-label">{label}</summary>
      <div className="prompt-preview-section-text">
        {text
          ? parts.map((part, index) => (
            <HighlightedPreviewText
              chatHistory={label === 'Text Input' ? 'auto' : 'none'}
              className={`prompt-preview-text-part${part.actionInserted ? ' action-inserted' : ''}`}
              historySegments={part.historySegments}
              key={index}
              text={part.text}
            />
          ))
          : <span className="prompt-preview-empty">Empty</span>}
      </div>
    </details>
  );
}

function previewImagesText(images: Array<{ index: number; id: string; name: string }> | undefined) {
  if (!images?.length) return 'No images sent to the LLM for this pass.';
  return images
    .map((image) => `Image ${image.index} = ${image.id}${image.name && image.name !== image.id ? ` (${image.name})` : ''}`)
    .join('\n');
}

export function PromptPreviewTools({
  id,
  debug,
  generatedText,
  runLabel,
}: {
  id: string;
  debug?: PromptRunDebug;
  generatedText?: string;
  runLabel: string;
}) {
  const [promptRouteOpen, setPromptRouteOpen] = useState(false);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPromptRouteOpen(false);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const promptPasses = debug?.promptPasses?.length
    ? debug.promptPasses
    : debug?.combinedPrompt
      ? [{ label: 'Prompt', prompt: debug.combinedPrompt }]
      : [];
  const outputPasses = debug?.outputPasses?.length
    ? debug.outputPasses
    : generatedText
      ? [{ label: 'Output', text: generatedText }]
      : [];
  const routePassCount = Math.max(promptPasses.length, outputPasses.length);

  return (
    <>
      <div className="node-actions llm-prompt-actions">
        <button
          className="inspect-button nodrag"
          type="button"
          disabled={routePassCount === 0}
          onClick={() => setPromptRouteOpen(true)}
        >
          Prompt Route
        </button>
      </div>
      {promptRouteOpen && typeof document !== 'undefined' ? createPortal(
        <div className="prompt-preview-modal-backdrop nodrag nowheel" role="dialog" aria-modal="true" aria-labelledby={`${id}-prompt-route-title`}>
          <section className="prompt-preview-modal">
            <div className="prompt-preview-modal-header">
              <div>
                <strong id={`${id}-prompt-route-title`}>Prompt Route</strong>
                <span>Exact LLM input and raw output for each {runLabel} pass.</span>
              </div>
              <button className="inspect-button prompt-action-icon-button" type="button" onClick={() => setPromptRouteOpen(false)}>x</button>
            </div>
            <div className="prompt-preview-blocks">
              {Array.from({ length: routePassCount }, (_entry, index) => {
                const promptPass = promptPasses[index];
                const outputPass = outputPasses[index];
                return (
                  <article className="prompt-preview-route-pass" key={`${index}-${promptPass?.label ?? outputPass?.label ?? 'pass'}`}>
                    <header>
                      <strong>{index + 1}. {promptPass?.label ?? outputPass?.label ?? 'Pass'}</strong>
                      {outputPass?.label ? <span>{outputPass.label}</span> : null}
                    </header>
                    {promptPass?.images !== undefined
                      ? previewBlock('Images Sent To LLM', previewImagesText(promptPass.images))
                      : null}
                    {promptPass?.sections?.length
                      ? promptPass.sections.map((section) => previewBlock(section.label, section.text, section.parts))
                      : previewBlock('Prompt', promptPass?.prompt ?? '')}
                    {previewBlock(outputPass?.label ?? 'Output', outputPass?.text ?? '')}
                  </article>
                );
              })}
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
