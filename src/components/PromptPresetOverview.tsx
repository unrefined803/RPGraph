import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  autoTurnInstructionDefinitions,
  autoTurnInstructionSettings,
} from '../chat/instructions';
import {
  defaultEventManagerPromptText,
  eventManagerPromptSettings,
} from '../nodes/event-manager/prompt';
import {
  defaultHistoryRpTimePromptText,
  historyRpTimePromptSettings,
} from '../nodes/history/rpTimePrompt';
import {
  defaultOutputSpeakerPromptText,
  outputSpeakerPromptSettings,
} from '../nodes/output/speakerPrompt';
import {
  defaultRpStorybookImageDescriptionPrompt,
  parseNodeStorybookJson,
  rpStorybookImageDescriptionPromptSettings,
  rpStorybookJsonText,
  type RpStorybook,
} from '../nodes/rp-storybook/model';
import {
  configForPromptActionToken,
  countPromptActionUses,
  defaultPromptActionConfig,
  isDefaultPromptActionConfig,
  parsePromptActionTokens,
  promptActionConfigs,
  promptActionConfigsEqual,
  promptActionKey,
  promptActionPromptTitle,
  promptActionTemplateConfig,
  replacePromptActionTitle,
  withPromptActionRuntimeSettings,
  withPromptActionRuntimeSettingsList,
  type PromptActionConfig,
  type PromptActionId,
  type PromptActionRuntimeSettings,
} from '../nodes/shared/promptActions';
import { PromptActionModal } from '../nodes/shared/PromptTools';
import {
  promptPresetDisplayText,
  promptSettingForSource,
  type PromptPresetSource,
  type PromptTextSetting,
} from '../nodes/shared/promptPresets';
import {
  llmPromptSwitchPromptAftersByOutput,
  llmPromptSwitchPromptBeforesByOutput,
} from '../workflow';
import { useBackdropDismiss } from './useBackdropDismiss';
import type {
  AutoTurnInstructionKey,
  ConnectionPreset,
  ProviderConnectionHealth,
  WorkflowNode,
  WorkflowNodeData,
} from '../types';

type PromptPresetOverviewProps = {
  nodes: WorkflowNode[];
  connections: ConnectionPreset[];
  providerHealthById: Record<string, ProviderConnectionHealth>;
  onCheckProviderConnection?: (connectionId: string) => void;
  promptActionCustomPresets: PromptActionConfig[];
  setPromptActionCustomPresets: (updater: (current: PromptActionConfig[]) => PromptActionConfig[]) => void;
  promptActionSettings: PromptActionRuntimeSettings;
  setPromptActionSettings: (updater: (current: PromptActionRuntimeSettings) => PromptActionRuntimeSettings) => void;
  promptTextCustomPresets: Record<string, string>;
  setPromptTextCustomPresets: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  updateNodeData: (nodeId: string, patch: Partial<WorkflowNodeData>) => void;
};

type PromptEntry = {
  id: string;
  nodeId: string;
  nodeLabel: string;
  label: string;
  presetKey: string;
  setting: PromptTextSetting;
  defaultText: string;
  update: (setting: PromptTextSetting) => void;
};

type PromptActionEntry = {
  id: string;
  nodeId: string;
  nodeLabel: string;
  label: string;
  config: PromptActionConfig;
  usageCount: number;
  visionEnabled: boolean;
  originalTitle: string;
  originalHasTitle: boolean;
  update: (config: PromptActionConfig) => void;
};

type OverviewGroup = {
  nodeId: string;
  nodeLabel: string;
  prompts: PromptEntry[];
  actions: PromptActionEntry[];
};

type PromptPresetActiveSources = Record<PromptPresetSource, boolean>;

const sourceLabels: Record<PromptPresetSource, string> = {
  default: 'Default',
  custom: 'Custom',
  workflow: 'In Workflow',
};

function uniqueUsedActionTokens(values: string[]) {
  const byKey = new Map<string, { title: string; hasTitle: boolean }>();
  values.forEach((value) => {
    parsePromptActionTokens(value).forEach((token) => {
      const key = promptActionKey(token.title);
      if (!byKey.has(key)) {
        byKey.set(key, { title: token.title, hasTitle: token.hasTitle });
      }
    });
  });
  return [...byKey.values()];
}

function sourceClassName(source: PromptPresetSource) {
  return source === 'workflow' ? 'workflow' : source;
}

function promptCurrentText(
  setting: PromptTextSetting,
  defaultText: string,
) {
  return setting.mode === 'custom' ? setting.customText ?? '' : defaultText;
}

function promptActiveSources(
  setting: PromptTextSetting,
  defaultText: string,
  localCustomText: string | undefined,
): PromptPresetActiveSources {
  const currentText = promptCurrentText(setting, defaultText);
  return {
    default: currentText === defaultText,
    custom: localCustomText !== undefined && currentText === localCustomText,
    workflow: setting.mode === 'custom',
  };
}

function primaryPromptSource(activeSources: PromptPresetActiveSources): PromptPresetSource {
  if (activeSources.custom) {
    return 'custom';
  }
  if (activeSources.workflow) {
    return 'workflow';
  }
  return 'default';
}

function withWorkflowSuppressed(
  activeSources: PromptPresetActiveSources,
  suppressWorkflow: boolean,
): PromptPresetActiveSources {
  return suppressWorkflow ? { ...activeSources, workflow: false } : activeSources;
}

function storybookPromptEntry(
  node: WorkflowNode,
  updateNodeData: PromptPresetOverviewProps['updateNodeData'],
): PromptEntry | undefined {
  if (node.data.kind !== undefined || node.data.nodeType !== 'rp-storybook') {
    return undefined;
  }
  const storybook = parseNodeStorybookJson(node.data.storybookJson);
  if (!storybook) {
    return undefined;
  }
  return {
    id: `${node.id}:storybook-image-description-prompt`,
    nodeId: node.id,
    nodeLabel: node.data.label,
    label: 'Image Description Prompt',
    presetKey: 'storybook.image-description-prompt',
    setting: rpStorybookImageDescriptionPromptSettings(storybook.imageDescriptionPrompt),
    defaultText: defaultRpStorybookImageDescriptionPrompt,
    update: (setting) => {
      const nextStorybook: RpStorybook = {
        ...storybook,
        imageDescriptionPrompt: setting,
      };
      updateNodeData(node.id, { storybookJson: rpStorybookJsonText(nextStorybook) });
    },
  };
}

function promptEntries(
  nodes: WorkflowNode[],
  connections: ConnectionPreset[],
  promptActionSettings: PromptActionRuntimeSettings,
  updateNodeData: PromptPresetOverviewProps['updateNodeData'],
): OverviewGroup[] {
  const groups: OverviewGroup[] = [];
  const groupForNode = (node: WorkflowNode) => {
    let group = groups.find((entry) => entry.nodeId === node.id);
    if (!group) {
      group = {
        nodeId: node.id,
        nodeLabel: node.data.label,
        prompts: [],
        actions: [],
      };
      groups.push(group);
    }
    return group;
  };

  nodes.forEach((node) => {
    if (node.data.kind !== undefined) {
      return;
    }
    if (node.data.nodeType === 'input') {
      const settings = autoTurnInstructionSettings(node.data.autoTurnInstructions);
      const group = groupForNode(node);
      autoTurnInstructionDefinitions.forEach((definition) => {
        const key = definition.key as AutoTurnInstructionKey;
        const setting = settings[key] ?? { mode: 'default', customText: '' };
        group.prompts.push({
          id: `${node.id}:autoturn:${key}`,
          nodeId: node.id,
          nodeLabel: node.data.label,
          label: definition.title,
          presetKey: `input.autoturn.${key}`,
          setting,
          defaultText: definition.defaultText,
          update: (setting) => {
            updateNodeData(node.id, {
              autoTurnInstructions: {
                ...settings,
                [key]: setting,
              },
            });
          },
        });
      });
      return;
    }
    if (node.data.nodeType === 'history') {
      groupForNode(node).prompts.push({
        id: `${node.id}:history-rp-time-prompt`,
        nodeId: node.id,
        nodeLabel: node.data.label,
        label: 'RP Time Prompt',
        presetKey: 'history.rp-time-prompt',
        setting: historyRpTimePromptSettings(node.data.historyRpTimePrompt),
        defaultText: defaultHistoryRpTimePromptText,
        update: (setting) => updateNodeData(node.id, { historyRpTimePrompt: setting }),
      });
      return;
    }
    const storybookEntry = storybookPromptEntry(node, updateNodeData);
    if (storybookEntry) {
      groupForNode(node).prompts.push(storybookEntry);
      return;
    }
    if (node.data.nodeType === 'event-manager') {
      groupForNode(node).prompts.push({
        id: `${node.id}:event-manager-prompt`,
        nodeId: node.id,
        nodeLabel: node.data.label,
        label: 'Event Manager Prompt',
        presetKey: 'event-manager.prompt',
        setting: eventManagerPromptSettings(node.data.eventManagerPrompt),
        defaultText: defaultEventManagerPromptText,
        update: (setting) => updateNodeData(node.id, { eventManagerPrompt: setting }),
      });
      return;
    }
    if (node.data.nodeType === 'output') {
      groupForNode(node).prompts.push({
        id: `${node.id}:speaker-prompt`,
        nodeId: node.id,
        nodeLabel: node.data.label,
        label: 'Speaker Prompt',
        presetKey: 'output.speaker-prompt',
        setting: outputSpeakerPromptSettings(node.data.outputSpeakerPrompt),
        defaultText: defaultOutputSpeakerPromptText,
        update: (setting) => updateNodeData(node.id, { outputSpeakerPrompt: setting }),
      });
    }
    if (node.data.nodeType === 'llm-prompt' || node.data.nodeType === 'llm-prompt-switch') {
      const storedActions = promptActionConfigs(node.data.llmPromptActions);
      const actions = withPromptActionRuntimeSettingsList(storedActions, promptActionSettings);
      const promptValues = node.data.nodeType === 'llm-prompt'
        ? [node.data.llmPromptBefore ?? '', node.data.llmPromptAfter ?? '']
        : [
            ...llmPromptSwitchPromptBeforesByOutput(node.data).flat(),
            ...llmPromptSwitchPromptAftersByOutput(node.data).flat(),
          ];
      const usedActionTokens = uniqueUsedActionTokens(promptValues);
      if (!usedActionTokens.length) {
        return;
      }
      const group = groupForNode(node);
      const selectedConnection = connections.find((connection) => connection.id === node.data.connectionId)
        ?? connections[0];
      usedActionTokens.forEach((token) => {
        const config = configForPromptActionToken(actions, token.title);
        group.actions.push({
          id: `${node.id}:action:${promptActionKey(token.title)}`,
          nodeId: node.id,
          nodeLabel: node.data.label,
          label: config.title,
          config,
          usageCount: countPromptActionUses(promptValues, token.title),
          visionEnabled: !!selectedConnection?.vision,
          originalTitle: token.title,
          originalHasTitle: token.hasTitle,
          update: (nextConfig) => {
            const title = nextConfig.title;
            const promptTitle = promptActionPromptTitle(nextConfig.actionId);
            const currentActions = promptActionConfigs(node.data.llmPromptActions);
            const nextActions = currentActions
              .filter((action) =>
                promptActionKey(action.title) !== promptActionKey(token.title) &&
                promptActionKey(action.title) !== promptActionKey(title)
              )
              .concat(promptActionTemplateConfig(nextConfig));
            const patch: Partial<WorkflowNodeData> = { llmPromptActions: nextActions };
            if (!token.hasTitle || promptTitle !== token.title) {
              if (node.data.nodeType === 'llm-prompt') {
                patch.llmPromptBefore = replacePromptActionTitle(
                  node.data.llmPromptBefore ?? '',
                  token.title,
                  promptTitle,
                  token.hasTitle,
                );
                patch.llmPromptAfter = replacePromptActionTitle(
                  node.data.llmPromptAfter ?? '',
                  token.title,
                  promptTitle,
                  token.hasTitle,
                );
              } else {
                patch.llmPromptSwitchPromptBeforesByOutput = llmPromptSwitchPromptBeforesByOutput(node.data)
                  .map((row) => row.map((value) => replacePromptActionTitle(value ?? '', token.title, promptTitle, token.hasTitle)));
                patch.llmPromptSwitchPromptAftersByOutput = llmPromptSwitchPromptAftersByOutput(node.data)
                  .map((row) => row.map((value) => replacePromptActionTitle(value ?? '', token.title, promptTitle, token.hasTitle)));
              }
            }
            updateNodeData(node.id, patch);
          },
        });
      });
    }
  });
  return groups.filter((group) => group.prompts.length || group.actions.length);
}

export function PromptPresetOverview({
  nodes,
  connections,
  providerHealthById,
  onCheckProviderConnection,
  promptActionCustomPresets,
  setPromptActionCustomPresets,
  promptActionSettings,
  setPromptActionSettings,
  promptTextCustomPresets,
  setPromptTextCustomPresets,
  updateNodeData,
}: PromptPresetOverviewProps) {
  const [open, setOpen] = useState(false);
  const [shouldBlink, setShouldBlink] = useState(false);
  const [workflowPromptTexts, setWorkflowPromptTexts] = useState<Record<string, string>>({});
  const [workflowActionConfigs, setWorkflowActionConfigs] = useState<Record<string, PromptActionConfig>>({});
  const [localOnlyPromptIds, setLocalOnlyPromptIds] = useState<Set<string>>(() => new Set());
  const [localOnlyActionIds, setLocalOnlyActionIds] = useState<Set<string>>(() => new Set());
  const [editingPrompt, setEditingPrompt] = useState<PromptEntry | null>(null);
  const [editingAction, setEditingAction] = useState<PromptActionEntry | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const groups = useMemo(
    () => promptEntries(nodes, connections, promptActionSettings, updateNodeData),
    [connections, nodes, promptActionSettings, updateNodeData],
  );
  const changedCount = groups.reduce((count, group) => {
    const changedPrompts = group.prompts.filter((entry) => {
      const activeSources = promptEntryActiveSources(entry);
      return activeSources.workflow || !activeSources.default;
    }).length;
    const changedActions = group.actions.filter((entry) => {
      const activeSources = actionEntryActiveSources(entry);
      return activeSources.workflow || !activeSources.default;
    }).length;
    return count + changedPrompts + changedActions;
  }, 0);

  function promptEntryActiveSources(entry: PromptEntry) {
    return withWorkflowSuppressed(
      promptActiveSources(
        entry.setting,
        entry.defaultText,
        promptTextCustomPresets[entry.presetKey],
      ),
      localOnlyPromptIds.has(entry.id),
    );
  }

  function actionEntryActiveSources(entry: PromptActionEntry) {
    return withWorkflowSuppressed(
      promptActionActiveSources(entry.config, promptActionCustomPresets),
      localOnlyActionIds.has(entry.id),
    );
  }

  function setPromptLocalOnly(entryId: string, enabled: boolean) {
    setLocalOnlyPromptIds((current) => {
      const next = new Set(current);
      if (enabled) {
        next.add(entryId);
      } else {
        next.delete(entryId);
      }
      return next;
    });
  }

  function setActionLocalOnly(entryId: string, enabled: boolean) {
    setLocalOnlyActionIds((current) => {
      const next = new Set(current);
      if (enabled) {
        next.add(entryId);
      } else {
        next.delete(entryId);
      }
      return next;
    });
  }

  const hasChangedEntries = changedCount > 0;

  useEffect(() => {
    if (hasChangedEntries) {
      const startTimer = setTimeout(() => {
        setShouldBlink(true);
      }, 0);
      const stopTimer = setTimeout(() => {
        setShouldBlink(false);
      }, 1000);
      return () => {
        clearTimeout(startTimer);
        clearTimeout(stopTimer);
      };
    }
  }, [hasChangedEntries]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function switchSource(entry: PromptEntry, source: PromptPresetSource) {
    const localCustomText = promptTextCustomPresets[entry.presetKey];
    const activeSources = promptEntryActiveSources(entry);
    const currentText = promptCurrentText(entry.setting, entry.defaultText);
    const currentWorkflowText = workflowPromptTexts[entry.id] ?? (
      activeSources.workflow ? entry.setting.customText : undefined
    );
    if (activeSources.workflow && entry.setting.customText) {
      setWorkflowPromptTexts((current) => ({
        ...current,
        [entry.id]: entry.setting.customText ?? '',
      }));
    }
    const nextSetting = promptSettingForSource(
      source,
      currentText,
      entry.defaultText,
      localCustomText,
      currentWorkflowText,
    );
    if (source === 'custom' && localCustomText === undefined) {
      return;
    }
    setPromptLocalOnly(
      entry.id,
      source === 'custom' &&
        !(currentWorkflowText !== undefined && nextSetting.customText === currentWorkflowText),
    );
    entry.update(nextSetting);
  }

  function switchActionSource(entry: PromptActionEntry, source: PromptPresetSource) {
    const activeSources = actionEntryActiveSources(entry);
    if (activeSources.workflow) {
      setWorkflowActionConfigs((current) => ({
        ...current,
        [entry.id]: entry.config,
      }));
    }
    const nextConfig = promptActionConfigForSource(
      source,
      entry.config,
      promptActionCustomPresets,
      workflowActionConfigs[entry.id],
      promptActionSettings,
    );
    if (source === 'custom' && !customPromptActionPreset(entry.config, promptActionCustomPresets)) {
      return;
    }
    const workflowConfig = workflowActionConfigs[entry.id] ?? (activeSources.workflow ? entry.config : undefined);
    setActionLocalOnly(
      entry.id,
      source === 'custom' &&
        !(workflowConfig && promptActionConfigsEqual(nextConfig, workflowConfig)),
    );
    entry.update(nextConfig);
  }

  return (
    <div className="prompt-preset-overview" ref={rootRef}>
      <button
        className={`graph-node-count-button${open ? ' open' : ''}${shouldBlink ? ' blink' : ''}`}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Show workflow prompt preset sources"
      >
        <span>{nodes.length} Nodes</span>
      </button>
      {open && (
        <div className="prompt-preset-menu" role="menu">
          <div className="prompt-preset-menu-header">
            <span>Prompt Presets</span>
            <small>{changedCount} changed</small>
          </div>
          <div className="prompt-preset-list">
            {groups.map((group) => {
              return (
                <div className="prompt-preset-group" key={group.nodeId}>
                  <div className="prompt-preset-group-title">{group.nodeLabel}</div>
                  {group.prompts.map((entry) => {
                    const localCustomText = promptTextCustomPresets[entry.presetKey];
                    const activeSources = promptEntryActiveSources(entry);
                    const workflowText = workflowPromptTexts[entry.id] ?? (
                      activeSources.workflow ? entry.setting.customText : undefined
                    );
                    return (
                      <div className="prompt-preset-row" key={entry.id}>
                        <div className="prompt-preset-row-label">
                          <strong>{entry.label}</strong>
                          <EditButton label={entry.label} onClick={() => setEditingPrompt(entry)} />
                        </div>
                        <PresetSwitch
                          label={entry.label}
                          activeSources={activeSources}
                          customAvailable={localCustomText !== undefined}
                          workflowAvailable={!!workflowText || activeSources.workflow}
                          onSwitch={(nextSource) => switchSource(entry, nextSource)}
                        />
                      </div>
                    );
                  })}
                  {group.actions.length > 0 && (
                    <div className="prompt-preset-section-title">Actions</div>
                  )}
                  {group.actions.map((entry) => {
                    const activeSources = actionEntryActiveSources(entry);
                    return (
                      <div className="prompt-preset-row action-row" key={entry.id}>
                        <div className="prompt-preset-row-label">
                          <strong>{entry.label}</strong>
                          <EditButton label={entry.label} onClick={() => setEditingAction(entry)} />
                        </div>
                        <PresetSwitch
                          label={entry.label}
                          activeSources={activeSources}
                          customAvailable={!!customPromptActionPreset(entry.config, promptActionCustomPresets)}
                          workflowAvailable={!!workflowActionConfigs[entry.id] || activeSources.workflow}
                          onSwitch={(nextSource) => switchActionSource(entry, nextSource)}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {groups.length === 0 && (
              <div className="prompt-preset-empty">No prompt presets in this workflow.</div>
            )}
          </div>
        </div>
      )}
      {editingPrompt && (
        <PromptTextEditorDialog
          entry={editingPrompt}
          localCustomText={promptTextCustomPresets[editingPrompt.presetKey]}
          workflowText={workflowPromptTexts[editingPrompt.id] ?? (
            !localOnlyPromptIds.has(editingPrompt.id) && editingPrompt.setting.mode === 'custom'
              ? editingPrompt.setting.customText
              : undefined
          )}
          onSaveCustom={(value) => setPromptTextCustomPresets((current) => ({
            ...current,
            [editingPrompt.presetKey]: value,
          }))}
          onSave={(setting) => {
            const workflowText = workflowPromptTexts[editingPrompt.id] ?? (
              editingPrompt.setting.mode === 'custom' ? editingPrompt.setting.customText : undefined
            );
            if (
              setting.mode === 'custom' &&
              workflowText !== undefined &&
              setting.customText !== workflowText
            ) {
              setWorkflowPromptTexts((current) => ({
                ...current,
                [editingPrompt.id]: workflowText,
              }));
            }
            setPromptLocalOnly(
              editingPrompt.id,
              setting.mode === 'custom' &&
                !(workflowText !== undefined && setting.customText === workflowText),
            );
            editingPrompt.update(setting);
            setEditingPrompt(null);
          }}
          onClose={() => setEditingPrompt(null)}
        />
      )}
      {editingAction && (
        <PromptActionModal
          id={`prompt-overview-${editingAction.nodeId}`}
          initialConfig={editingAction.config}
          initialWorkflowConfig={workflowActionConfigs[editingAction.id] ?? (
            !localOnlyActionIds.has(editingAction.id) &&
              promptActionActiveSources(editingAction.config, promptActionCustomPresets).workflow
              ? editingAction.config
              : undefined
          )}
          initialActionSelected={true}
          usageCount={editingAction.usageCount}
          customActionPresets={promptActionCustomPresets}
          promptActionSettings={promptActionSettings}
          setPromptActionSettings={setPromptActionSettings}
          visionEnabled={editingAction.visionEnabled}
          connections={connections}
          nodes={nodes}
          providerHealthById={providerHealthById}
          onCheckProviderConnection={onCheckProviderConnection}
          onReplace={(config, _scope, options = {}) => {
            const workflowConfig = workflowActionConfigs[editingAction.id] ?? (
              promptActionActiveSources(editingAction.config, promptActionCustomPresets).workflow
                ? editingAction.config
                : undefined
            );
            if (
              options.presetSource === 'custom' &&
              workflowConfig &&
              !promptActionConfigsEqual(config, workflowConfig)
            ) {
              setWorkflowActionConfigs((current) => ({
                ...current,
                [editingAction.id]: workflowConfig,
              }));
            }
            setActionLocalOnly(
              editingAction.id,
              options.presetSource === 'custom' &&
                !(workflowConfig && promptActionConfigsEqual(config, workflowConfig)),
            );
            editingAction.update(config);
            if (options.close !== false) {
              setEditingAction(null);
            }
          }}
          onSaveCustomPreset={(config) => {
            setPromptActionCustomPresets((current) => [
              ...current.filter((preset) =>
                !samePromptActionIdentity(preset, config) &&
                !samePromptActionIdentity(preset, editingAction.config)
              ),
              promptActionTemplateConfig(config),
            ]);
          }}
          onClose={() => setEditingAction(null)}
        />
      )}
    </div>
  );
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="prompt-preset-edit-button"
      type="button"
      aria-label={`Edit ${label}`}
      title="Edit"
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 20h4l11-11-4-4L4 16v4Z" />
        <path d="m14 6 4 4" />
      </svg>
    </button>
  );
}

function PromptTextEditorDialog({
  entry,
  localCustomText,
  workflowText,
  onSaveCustom,
  onSave,
  onClose,
}: {
  entry: PromptEntry;
  localCustomText: string | undefined;
  workflowText: string | undefined;
  onSaveCustom: (value: string) => void;
  onSave: (setting: PromptTextSetting) => void;
  onClose: () => void;
}) {
  const currentText = promptCurrentText(entry.setting, entry.defaultText);
  const initialActiveSources = {
    default: currentText === entry.defaultText,
    custom: localCustomText !== undefined && currentText === localCustomText,
    workflow: workflowText !== undefined && currentText === workflowText,
  };
  const initialSource = primaryPromptSource(initialActiveSources);
  const initialText = promptPresetDisplayText(initialSource, entry.setting, entry.defaultText, localCustomText);
  const [source, setSource] = useState<PromptPresetSource>(initialSource);
  const [text, setText] = useState(initialText);
  const [rememberedWorkflowText] = useState(workflowText);
  const workflowAvailable = rememberedWorkflowText !== undefined || source === 'workflow';
  const activeSources = {
    default: text === entry.defaultText,
    custom: localCustomText !== undefined && text === localCustomText,
    workflow: rememberedWorkflowText !== undefined && text === rememberedWorkflowText,
  };
  const backdropDismiss = useBackdropDismiss<HTMLDivElement>(onClose);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function switchEditorSource(nextSource: PromptPresetSource) {
    setSource(nextSource);
    if (nextSource === 'default') {
      setText(entry.defaultText);
      return;
    }
    if (nextSource === 'custom') {
      setText(localCustomText ?? (text || entry.defaultText));
      return;
    }
    setText(rememberedWorkflowText ?? (text || entry.defaultText));
  }

  function save() {
    const nextSetting = promptSettingForSource(
      source,
      text,
      entry.defaultText,
      localCustomText,
      rememberedWorkflowText,
    );
    const savedSetting = source === 'default'
      ? nextSetting
      : { mode: 'custom' as const, customText: text };
    if (source === 'custom') {
      onSaveCustom(text);
    }
    onSave(savedSetting);
  }

  return createPortal(
    <div className="dialog-backdrop nodrag nowheel" role="dialog" aria-modal="true" {...backdropDismiss}>
      <section className="prompt-overview-editor" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <h2>{entry.label}</h2>
            <p>{entry.nodeLabel}</p>
          </div>
          <div className="prompt-action-header-actions">
            <button className="close-button prompt-action-save-button" type="button" onClick={save}>Save</button>
            <button className="close-button" type="button" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="prompt-overview-editor-body">
          <label className="node-field-label">PROMPT PRESET</label>
          <PresetSwitch
            label={entry.label}
            activeSources={activeSources}
            customAvailable={true}
            workflowAvailable={workflowAvailable}
            onSwitch={switchEditorSource}
          />
          <textarea
            className="prompt-overview-editor-textarea nodrag nowheel"
            value={text}
            spellCheck={false}
            disabled={source !== 'custom'}
            onChange={(event) => setText(event.currentTarget.value)}
          />
        </div>
      </section>
    </div>,
    document.body,
  );
}

function PresetSwitch({
  label,
  activeSources,
  customAvailable,
  workflowAvailable,
  onSwitch,
}: {
  label: string;
  activeSources: PromptPresetActiveSources;
  customAvailable: boolean;
  workflowAvailable: boolean;
  onSwitch: (source: PromptPresetSource) => void;
}) {
  return (
    <div className="prompt-preset-switch" aria-label={`${label} preset source`}>
      {(['default', 'custom', 'workflow'] as PromptPresetSource[]).map((option) => (
        <button
          key={option}
          className={activeSources[option] ? `active ${sourceClassName(option)}` : ''}
          type="button"
          disabled={
            (option === 'workflow' && !workflowAvailable) ||
            (option === 'custom' && !customAvailable)
          }
          onClick={() => onSwitch(option)}
          title={sourceLabels[option]}
        >
          {sourceLabels[option]}
        </button>
      ))}
    </div>
  );
}

function samePromptActionIdentity(first: Pick<PromptActionConfig, 'actionId'>, second: Pick<PromptActionConfig, 'actionId'>) {
  return first.actionId === second.actionId;
}

function customPromptActionPreset(config: PromptActionConfig, presets: PromptActionConfig[]) {
  return presets.find((preset) => samePromptActionIdentity(preset, config));
}

function promptActionActiveSources(config: PromptActionConfig, customPresets: PromptActionConfig[]): PromptPresetActiveSources {
  const customPreset = customPromptActionPreset(config, customPresets);
  return {
    default: isDefaultPromptActionConfig(config),
    custom: !!customPreset && promptActionConfigsEqual(config, customPreset),
    workflow: !isDefaultPromptActionConfig(config),
  };
}

function promptActionConfigForSource(
  source: PromptPresetSource,
  currentConfig: PromptActionConfig,
  customPresets: PromptActionConfig[],
  workflowConfig: PromptActionConfig | undefined,
  promptActionSettings: PromptActionRuntimeSettings,
) {
  if (source === 'default') {
    return withPromptActionRuntimeSettings(
      defaultPromptActionConfig(currentConfig.title, currentConfig.actionId as PromptActionId),
      promptActionSettings,
    );
  }
  if (source === 'custom') {
    return withPromptActionRuntimeSettings(
      customPromptActionPreset(currentConfig, customPresets) ?? currentConfig,
      promptActionSettings,
    );
  }
  return withPromptActionRuntimeSettings(workflowConfig ?? currentConfig, promptActionSettings);
}
