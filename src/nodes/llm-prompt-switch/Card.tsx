import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Handle, NodeResizeControl, Position, ResizeControlVariant, type NodeProps } from '@xyflow/react';
import type { WorkflowNode } from '../../types';
import {
  llmPromptSwitchOutputHandle,
  llmPromptSwitchOutputTitles,
  llmPromptSwitchPromptAfters,
  llmPromptSwitchPromptAftersByOutput,
  llmPromptSwitchPromptBefores,
  llmPromptSwitchPromptBeforesByOutput,
  llmPromptSwitchPromptTitles,
  llmPromptSwitchPromptTitlesByOutput,
  llmPromptSwitchSelectedOutputChannel,
  llmPromptSwitchSelectedPromptSlot,
  maximumLlmPromptSwitchEntries,
} from '../../workflow';
import { useNodeActions } from '../NodeActionsContext';
import { ConnectionSelect } from '../shared/ConnectionSelect';
import { LlmCallMetrics, runStateClassName, useNodeLayoutSync } from '../shared/CardView';
import { NodeCustomSelect } from '../shared/NodeCustomSelect';
import { PortLabel } from '../shared/PortValue';
import { PostOutputToggle } from '../shared/PostOutputToggle';
import { imageInputHandle } from '../shared/imageInputs';
import { JsonSyntaxTextarea, formatJsonTextSegments } from '../shared/JsonSyntaxTextarea';
import { PromptActionModal, PromptCommandModal, PromptPreviewTools } from '../shared/PromptTools';
import {
  configForPromptCommandToken,
  countPromptCommandUses,
  formatPromptCommandTokens,
  knownPromptCommandId,
  parsePromptCommandTokens,
  promptCommandConfigs,
  type PromptCommandConfig,
} from '../shared/promptCommands';
import {
  countPromptActionUses,
  configForPromptActionToken,
  promptActionConfigs,
  promptActionKey,
  promptActionPromptTitle,
  promptActionStatus,
  promptActionTemplateConfig,
  replacePromptActionAtIndex,
  replacePromptActionTitle,
  withPromptActionRuntimeSettingsList,
  type PromptActionConfig,
} from '../shared/promptActions';
import { storybookCreateImageCharactersFromNodes } from '../../storybook/runtime';
import {
  promptSwitchOutputChannelHandle,
  promptSwitchPromptSlotHandle,
  promptSwitchTextHandle,
} from './execute';
import { useNodeView } from '../NodeViewContext';

const minPromptTextareaHeight = 64;
function distributePromptTextareaHeights(availableHeight: number, requiredHeights: [number, number]): [number, number] {
  const heights: [number, number] = [minPromptTextareaHeight, minPromptTextareaHeight];
  let remainingHeight = Math.max(0, availableHeight - minPromptTextareaHeight * 2);

  while (remainingHeight > 0.5) {
    const growableIndexes = heights
      .map((height, index) => ({ height, index }))
      .filter(({ height, index }) => height < requiredHeights[index] - 0.5);

    if (!growableIndexes.length) {
      const largerPromptIndex = requiredHeights[0] >= requiredHeights[1] ? 0 : 1;
      heights[largerPromptIndex] += remainingHeight;
      break;
    }

    const share = remainingHeight / growableIndexes.length;
    let consumedHeight = 0;
    growableIndexes.forEach(({ height, index }) => {
      const increase = Math.min(share, requiredHeights[index] - height);
      heights[index] += increase;
      consumedHeight += increase;
    });

    if (consumedHeight <= 0.5) {
      break;
    }
    remainingHeight -= consumedHeight;
  }

  return heights;
}

function clampIndex(value: number, count: number) {
  return Math.min(Math.max(0, count - 1), Math.max(0, value));
}

function optionLabel(index: number, title: string, fallback: string) {
  return `${index}: ${title.trim() || (index === 0 && fallback === 'Prompt' ? 'Default Prompt' : `${fallback} ${index}`)}`;
}

export function LlmPromptSwitchNodeCard({ id, data }: NodeProps<WorkflowNode>) {
  const actions = useNodeActions();
  const view = useNodeView();
  const nodeBodyRef = useNodeLayoutSync(id);
  const [renameTarget, setRenameTarget] = useState<'output' | 'prompt' | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [actionDialog, setActionDialog] = useState<{
    originalTitle: string;
    originalHasTitle: boolean;
    originalIndex: number;
    source: 'before' | 'after';
    outputIndex: number;
    promptIndex: number;
    draft: PromptActionConfig;
    actionSelected: boolean;
    usageCount: number;
  } | null>(null);
  const [commandDialog, setCommandDialog] = useState<{
    name: string;
    config?: PromptCommandConfig;
    usageCount: number;
  } | null>(null);
  const promptFieldsRef = useRef<HTMLDivElement>(null);
  const promptBeforeLabelRef = useRef<HTMLLabelElement>(null);
  const promptAfterLabelRef = useRef<HTMLLabelElement>(null);
  const promptBeforeRef = useRef<HTMLTextAreaElement>(null);
  const promptAfterRef = useRef<HTMLTextAreaElement>(null);
  const outputTitles = llmPromptSwitchOutputTitles(data);
  const selectedOutputChannel = llmPromptSwitchSelectedOutputChannel(data);
  const promptTitleRows = llmPromptSwitchPromptTitlesByOutput(data);
  const promptBeforeRows = llmPromptSwitchPromptBeforesByOutput(data);
  const promptAfterRows = llmPromptSwitchPromptAftersByOutput(data);
  const promptTitles = llmPromptSwitchPromptTitles(data, selectedOutputChannel);
  const promptBefores = llmPromptSwitchPromptBefores(data, selectedOutputChannel);
  const promptAfters = llmPromptSwitchPromptAfters(data, selectedOutputChannel);
  const selectedPromptSlot = llmPromptSwitchSelectedPromptSlot(data);
  const autoFormatJson = data.llmPromptSwitchAutoFormatJson ?? true;
  const storedActionConfigs = promptActionConfigs(data.llmPromptActions);
  const actionConfigs = withPromptActionRuntimeSettingsList(storedActionConfigs, view.promptActionSettings);
  const selectedConnection = view.connections.find((connection) => connection.id === data.connectionId)
    ?? view.connections[0];
  const visionEnabled = !!selectedConnection?.vision;
  const comfyProviderIds = view.connections
    .filter((connection) => connection.kind === 'comfyui')
    .map((connection) => connection.id);
  const createImageCharacters = storybookCreateImageCharactersFromNodes(view.nodes);
  const commandConfigs = promptCommandConfigs(data.llmPromptCommands);
  const promptCommandStatuses = Object.fromEntries(
    [...promptBeforeRows.flat(), ...promptAfterRows.flat()]
      .flatMap((text) => parsePromptCommandTokens(text ?? ''))
      .filter((token) => !knownPromptCommandId(token.name))
      .map((token) => [token.name, { tone: 'error' as const, label: 'unknown command', disabled: true }]),
  );
  const openPromptCommandConfig = (command: { name: string }) => {
    const commandId = knownPromptCommandId(command.name);
    setCommandDialog({
      name: command.name,
      config: commandId ? configForPromptCommandToken(commandConfigs, commandId) : undefined,
      usageCount: countPromptCommandUses(
        [...promptBeforeRows.flat(), ...promptAfterRows.flat()],
        command.name,
      ),
    });
  };
  const savePromptCommandConfig = (config: PromptCommandConfig) => {
    actions.updateData(id, {
      llmPromptCommands: commandConfigs
        .filter((command) => command.commandId !== config.commandId)
        .concat(config),
    });
    setCommandDialog(null);
  };
  const promptActionStatuses = Object.fromEntries(
    actionConfigs.flatMap((action) => {
      const status = promptActionStatus(action, {
        visionEnabled,
        comfyProviderIds,
        providerHealthById: view.providerHealthById,
        createImageCharacters,
      });
      return status
        ? [[promptActionKey(action.title), {
            tone: status.tone,
            label: status.label,
            disabled: !status.available,
          }]]
        : [];
    }),
  );


  const syncPromptTextareaHeights = useCallback(() => {
    const fields = promptFieldsRef.current;
    const beforeLabel = promptBeforeLabelRef.current;
    const afterLabel = promptAfterLabelRef.current;
    const beforeTextarea = promptBeforeRef.current;
    const afterTextarea = promptAfterRef.current;
    if (!fields || !beforeLabel || !afterLabel || !beforeTextarea || !afterTextarea) {
      return;
    }

    beforeTextarea.style.height = `${minPromptTextareaHeight}px`;
    afterTextarea.style.height = `${minPromptTextareaHeight}px`;

    const styles = window.getComputedStyle(fields);
    const fieldGap = Number.parseFloat(styles.rowGap || styles.gap || '0') || 0;
    const fixedHeight = Array.from(fields.children)
      .filter((child) => child !== beforeTextarea.closest('.llm-prompt-field') && child !== afterTextarea.closest('.llm-prompt-field'))
      .reduce((sum, child) => sum + (child as HTMLElement).offsetHeight, 0);
    const promptLabelGap = 12;
    const availableTextareaHeight =
      fields.clientHeight -
      fixedHeight -
      fieldGap * Math.max(0, fields.children.length - 1) -
      beforeLabel.offsetHeight -
      afterLabel.offsetHeight -
      promptLabelGap;

    const requiredHeights: [number, number] = [
      Math.max(minPromptTextareaHeight, beforeTextarea.scrollHeight + 2),
      Math.max(minPromptTextareaHeight, afterTextarea.scrollHeight + 2),
    ];
    const [beforeHeight, afterHeight] = distributePromptTextareaHeights(availableTextareaHeight, requiredHeights);

    beforeTextarea.style.height = `${beforeHeight}px`;
    afterTextarea.style.height = `${afterHeight}px`;
  }, []);

  useLayoutEffect(() => {
    syncPromptTextareaHeights();
  }, [promptAfters, promptBefores, selectedPromptSlot, syncPromptTextareaHeights]);

  useLayoutEffect(() => {
    const fields = promptFieldsRef.current;
    if (!fields || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    let animationFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(syncPromptTextareaHeights);
    });
    observer.observe(fields);
    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [syncPromptTextareaHeights]);

  const updateSelectedOutputChannel = (nextSelected: number) => {
    const outputChannel = clampIndex(nextSelected, outputTitles.length);
    const nextPromptCount = promptTitleRows[outputChannel]?.length ?? 1;
    actions.updateData(id, {
      llmPromptSwitchSelectedOutputChannel: outputChannel,
      llmPromptSwitchSelectedPromptSlot: clampIndex(selectedPromptSlot, nextPromptCount),
    });
  };

  const updateSelectedPromptSlot = (nextSelected: number) => {
    actions.updateData(id, { llmPromptSwitchSelectedPromptSlot: clampIndex(nextSelected, promptTitles.length) });
  };

  const renameOutputChannel = () => {
    setRenameTarget('output');
    setRenameValue(outputTitles[selectedOutputChannel] ?? `Output ${selectedOutputChannel}`);
  };

  const renamePromptSlot = () => {
    setRenameTarget('prompt');
    setRenameValue(promptTitles[selectedPromptSlot] ?? (selectedPromptSlot === 0 ? 'Default Prompt' : `Prompt ${selectedPromptSlot}`));
  };

  const applyRename = () => {
    const value = renameValue.trim();
    if (!renameTarget || !value) {
      setRenameTarget(null);
      return;
    }
    if (renameTarget === 'output') {
      const nextTitles = [...outputTitles];
      nextTitles[selectedOutputChannel] = value;
      actions.updateData(id, { llmPromptSwitchOutputTitles: nextTitles });
    } else {
      const nextRows = promptTitleRows.map((row) => [...row]);
      nextRows[selectedOutputChannel][selectedPromptSlot] = value;
      actions.updateData(id, { llmPromptSwitchPromptTitlesByOutput: nextRows });
    }
    setRenameTarget(null);
  };

  const addOutputChannel = () => {
    if (outputTitles.length >= maximumLlmPromptSwitchEntries) {
      return;
    }
    const title = `Output ${outputTitles.length}`;
    actions.updateData(id, {
      llmPromptSwitchOutputTitles: [...outputTitles, title],
      llmPromptSwitchPromptTitlesByOutput: [...promptTitleRows, ['Default Prompt']],
      llmPromptSwitchPromptBeforesByOutput: [...promptBeforeRows, ['']],
      llmPromptSwitchPromptAftersByOutput: [...promptAfterRows, ['']],
      llmPromptSwitchSelectedOutputChannel: outputTitles.length,
      llmPromptSwitchSelectedPromptSlot: 0,
    });
    setRenameTarget('output');
    setRenameValue(title);
  };

  const removeOutputChannel = () => {
    if (outputTitles.length <= 1) {
      return;
    }
    actions.removeLlmPromptSwitchOutputChannel(id, selectedOutputChannel);
    const nextPromptTitleRows = promptTitleRows.filter((_, index) => index !== selectedOutputChannel);
    const nextSelectedOutputChannel = clampIndex(selectedOutputChannel, outputTitles.length - 1);
    actions.updateData(id, {
      llmPromptSwitchOutputTitles: outputTitles.filter((_, index) => index !== selectedOutputChannel),
      llmPromptSwitchPromptTitlesByOutput: nextPromptTitleRows,
      llmPromptSwitchPromptBeforesByOutput: promptBeforeRows.filter((_, index) => index !== selectedOutputChannel),
      llmPromptSwitchPromptAftersByOutput: promptAfterRows.filter((_, index) => index !== selectedOutputChannel),
      llmPromptSwitchSelectedOutputChannel: nextSelectedOutputChannel,
      llmPromptSwitchSelectedPromptSlot: clampIndex(selectedPromptSlot, nextPromptTitleRows[nextSelectedOutputChannel]?.length ?? 1),
    });
  };

  const addPromptSlot = () => {
    if (promptTitles.length >= maximumLlmPromptSwitchEntries) {
      return;
    }
    const title = `Prompt ${promptTitles.length}`;
    const nextTitleRows = promptTitleRows.map((row, index) =>
      index === selectedOutputChannel ? [...row, title] : [...row],
    );
    const nextBeforeRows = promptBeforeRows.map((row, index) =>
      index === selectedOutputChannel ? [...row, ''] : [...row],
    );
    const nextAfterRows = promptAfterRows.map((row, index) =>
      index === selectedOutputChannel ? [...row, ''] : [...row],
    );
    actions.updateData(id, {
      llmPromptSwitchPromptTitlesByOutput: nextTitleRows,
      llmPromptSwitchPromptBeforesByOutput: nextBeforeRows,
      llmPromptSwitchPromptAftersByOutput: nextAfterRows,
      llmPromptSwitchSelectedPromptSlot: promptTitles.length,
    });
    setRenameTarget('prompt');
    setRenameValue(title);
  };

  const removePromptSlot = () => {
    if (promptTitles.length <= 1) {
      return;
    }
    const nextTitleRows = promptTitleRows.map((row, index) =>
      index === selectedOutputChannel ? row.filter((_, promptIndex) => promptIndex !== selectedPromptSlot) : [...row],
    );
    const nextBeforeRows = promptBeforeRows.map((row, index) =>
      index === selectedOutputChannel ? row.filter((_, promptIndex) => promptIndex !== selectedPromptSlot) : [...row],
    );
    const nextAfterRows = promptAfterRows.map((row, index) =>
      index === selectedOutputChannel ? row.filter((_, promptIndex) => promptIndex !== selectedPromptSlot) : [...row],
    );
    actions.updateData(id, {
      llmPromptSwitchPromptTitlesByOutput: nextTitleRows,
      llmPromptSwitchPromptBeforesByOutput: nextBeforeRows,
      llmPromptSwitchPromptAftersByOutput: nextAfterRows,
      llmPromptSwitchSelectedPromptSlot: clampIndex(selectedPromptSlot, promptTitles.length - 1),
    });
  };

  const formatJsonValue = (value: string) => {
    try {
      return formatJsonTextSegments(value);
    } catch {
      return value;
    }
  };

  const maybeFormatJson = (value: string) => (autoFormatJson ? formatJsonValue(value) : value);

  const updatePromptBefore = (value: string) => {
    const nextRows = promptBeforeRows.map((row) => [...row]);
    nextRows[selectedOutputChannel][selectedPromptSlot] = maybeFormatJson(value);
    actions.updateData(id, { llmPromptSwitchPromptBeforesByOutput: nextRows });
  };

  const updatePromptAfter = (value: string) => {
    const nextRows = promptAfterRows.map((row) => [...row]);
    nextRows[selectedOutputChannel][selectedPromptSlot] = maybeFormatJson(value);
    actions.updateData(id, { llmPromptSwitchPromptAftersByOutput: nextRows });
  };

  const promptActionConfigForTitle = (title: string) => {
    const normalizedTitle = promptActionKey(title);
    const configuredAction = actionConfigs.find(
      (action) => promptActionKey(action.title) === normalizedTitle,
    );
    return configuredAction ?? configForPromptActionToken(actionConfigs, title);
  };

  const openPromptActionConfig = (
    action: { title: string; index: number; hasTitle: boolean },
    source: 'before' | 'after',
  ) => {
    const { title, hasTitle, index } = action;
    const normalizedTitle = promptActionKey(title);
    const configuredAction = actionConfigs.find(
      (action) => promptActionKey(action.title) === normalizedTitle,
    );
    const config = configuredAction ?? promptActionConfigForTitle(title);
    setActionDialog({
      originalTitle: title,
      originalHasTitle: hasTitle,
      originalIndex: index,
      source,
      outputIndex: selectedOutputChannel,
      promptIndex: selectedPromptSlot,
      draft: { ...config },
      actionSelected: hasTitle && (
        !!configuredAction || promptActionKey(config.title) === normalizedTitle
      ),
      usageCount: countPromptActionUses(
        [...promptBeforeRows.flat(), ...promptAfterRows.flat()],
        title,
      ),
    });
  };

  const applyPromptActionDialog = (
    config: PromptActionConfig,
    scope: 'single' | 'linked',
    options: { close?: boolean } = {},
  ) => {
    if (!actionDialog) {
      return;
    }
    const title = config.title;
    const promptTitle = promptActionPromptTitle(config.actionId);
    const nextActions = storedActionConfigs
      .filter((action) =>
        (scope === 'single' || promptActionKey(action.title) !== promptActionKey(actionDialog.originalTitle)) &&
        promptActionKey(action.title) !== promptActionKey(title),
      )
      .concat(promptActionTemplateConfig(config));
    const patch: Record<string, unknown> = {
      llmPromptActions: nextActions,
    };
    if (scope === 'single') {
      const nextBeforeRows = promptBeforeRows.map((row) => [...row]);
      const nextAfterRows = promptAfterRows.map((row) => [...row]);
      const rows = actionDialog.source === 'before' ? nextBeforeRows : nextAfterRows;
      rows[actionDialog.outputIndex][actionDialog.promptIndex] = replacePromptActionAtIndex(
        rows[actionDialog.outputIndex][actionDialog.promptIndex] ?? '',
        actionDialog.originalIndex,
        promptTitle,
      );
      patch.llmPromptSwitchPromptBeforesByOutput = nextBeforeRows;
      patch.llmPromptSwitchPromptAftersByOutput = nextAfterRows;
    } else if (!actionDialog.originalHasTitle || promptTitle !== actionDialog.originalTitle) {
      const nextBeforeRows = promptBeforeRows.map((row) => [...row]);
      const nextAfterRows = promptAfterRows.map((row) => [...row]);
      nextBeforeRows.forEach((row, outputIndex) => {
        row.forEach((value, promptIndex) => {
          nextBeforeRows[outputIndex][promptIndex] = replacePromptActionTitle(
            value ?? '', actionDialog.originalTitle, promptTitle, actionDialog.originalHasTitle,
          );
        });
      });
      nextAfterRows.forEach((row, outputIndex) => {
        row.forEach((value, promptIndex) => {
          nextAfterRows[outputIndex][promptIndex] = replacePromptActionTitle(
            value ?? '', actionDialog.originalTitle, promptTitle, actionDialog.originalHasTitle,
          );
        });
      });
      patch.llmPromptSwitchPromptBeforesByOutput = nextBeforeRows;
      patch.llmPromptSwitchPromptAftersByOutput = nextAfterRows;
    }
    actions.updateData(id, patch);
    if (options.close === false) {
      setActionDialog({
        ...actionDialog,
        draft: config,
      });
    } else {
      setActionDialog(null);
    }
  };

  const saveCustomPromptActionPreset = (config: PromptActionConfig) => {
    view.setPromptActionCustomPresets((current) => current
      .filter((action) => action.actionId !== config.actionId)
      .concat(promptActionTemplateConfig(config)));
  };

  const formatCurrentPrompts = () => {
    const currentBefore = promptBefores[selectedPromptSlot] ?? '';
    const currentAfter = promptAfters[selectedPromptSlot] ?? '';
    const formattedBefore = formatPromptCommandTokens(maybeFormatJson(currentBefore));
    const formattedAfter = formatPromptCommandTokens(maybeFormatJson(currentAfter));
    if (formattedBefore === currentBefore && formattedAfter === currentAfter) {
      return;
    }

    const nextBeforeRows = promptBeforeRows.map((row) => [...row]);
    const nextAfterRows = promptAfterRows.map((row) => [...row]);
    nextBeforeRows[selectedOutputChannel][selectedPromptSlot] = formattedBefore;
    nextAfterRows[selectedOutputChannel][selectedPromptSlot] = formattedAfter;
    actions.updateData(id, {
      llmPromptSwitchPromptBeforesByOutput: nextBeforeRows,
      llmPromptSwitchPromptAftersByOutput: nextAfterRows,
    });
  };

  const updateAutoFormatJson = (enabled: boolean) => {
    const update = { llmPromptSwitchAutoFormatJson: enabled };
    if (!enabled) {
      actions.updateData(id, update);
      return;
    }

    const nextBeforeRows = promptBeforeRows.map((row, outputIndex) =>
      row.map((value, promptIndex) =>
        outputIndex === selectedOutputChannel && promptIndex === selectedPromptSlot ? formatJsonValue(value) : value,
      ),
    );
    const nextAfterRows = promptAfterRows.map((row, outputIndex) =>
      row.map((value, promptIndex) =>
        outputIndex === selectedOutputChannel && promptIndex === selectedPromptSlot ? formatJsonValue(value) : value,
      ),
    );
    actions.updateData(id, {
      ...update,
      llmPromptSwitchPromptBeforesByOutput: nextBeforeRows,
      llmPromptSwitchPromptAftersByOutput: nextAfterRows,
    });
  };

  const outputPortsHeight = outputTitles.length * 38 + 11;
  return (
    <>
    <div className={`workflow-node llm-prompt-switch-node${runStateClassName(data)}`} ref={nodeBodyRef} style={{ paddingBottom: 16 + outputPortsHeight }}>
      <NodeResizeControl
        className="llm-prompt-resize-control"
        position="bottom"
        variant={ResizeControlVariant.Line}
        resizeDirection="vertical"
        minHeight={1140}
        minWidth={548}
        maxWidth={548}
      />
      <div className="node-title-row">
        <span className="node-dot" />
        <strong>{data.label}</strong>
      </div>
      <LlmCallMetrics data={data} />
      <span className="node-description">{data.description}</span>
      <div className="llm-prompt-fields llm-prompt-switch-fields" ref={promptFieldsRef}>
        <div className="llm-prompt-field">
          <label className="node-field-label" htmlFor={`${id}-output-channel`}>
            OUTPUT CHANNEL
          </label>
          <div className="prompt-switch-select-row">
            <NodeCustomSelect
              id={`${id}-output-channel`}
              value={selectedOutputChannel}
              onChange={(val) => updateSelectedOutputChannel(Number(val))}
              options={outputTitles.map((title, index) => ({
                value: index,
                label: optionLabel(index, title, 'Output'),
              }))}
            />
            <button className="combiner-count-button prompt-switch-control-button nodrag" type="button" onClick={addOutputChannel} disabled={outputTitles.length >= maximumLlmPromptSwitchEntries}>
              +
            </button>
            <button className="combiner-count-button prompt-switch-control-button nodrag" type="button" onClick={removeOutputChannel} disabled={outputTitles.length <= 1}>
              -
            </button>
            <button className="inspect-button prompt-switch-name-button nodrag" type="button" onClick={renameOutputChannel}>
              Name
            </button>
          </div>
        </div>
        <div className="llm-prompt-field">
          <label className="node-field-label" htmlFor={`${id}-prompt-slot`}>
            PROMPT SLOT
          </label>
          <div className="prompt-switch-select-row">
            <NodeCustomSelect
              id={`${id}-prompt-slot`}
              value={selectedPromptSlot}
              onChange={(val) => updateSelectedPromptSlot(Number(val))}
              options={promptTitles.map((title, index) => ({
                value: index,
                label: optionLabel(index, title, 'Prompt'),
              }))}
            />
            <button className="combiner-count-button prompt-switch-control-button nodrag" type="button" onClick={addPromptSlot} disabled={promptTitles.length >= maximumLlmPromptSwitchEntries}>
              +
            </button>
            <button className="combiner-count-button prompt-switch-control-button nodrag" type="button" onClick={removePromptSlot} disabled={promptTitles.length <= 1}>
              -
            </button>
            <button className="inspect-button prompt-switch-name-button nodrag" type="button" onClick={renamePromptSlot}>
              Name
            </button>
          </div>
        </div>
        {renameTarget && (
          <div className="prompt-switch-rename-row">
            <input
              className="node-text-input nodrag nowheel"
              type="text"
              value={renameValue}
              autoFocus
              onChange={(event) => setRenameValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  applyRename();
                }
                if (event.key === 'Escape') {
                  setRenameTarget(null);
                }
              }}
            />
            <button className="inspect-button prompt-switch-name-button nodrag" type="button" onClick={applyRename}>
              OK
            </button>
            <button className="inspect-button prompt-switch-name-button nodrag" type="button" onClick={() => setRenameTarget(null)}>
              Cancel
            </button>
          </div>
        )}
        <div className="llm-prompt-field">
          <label className="node-field-label" htmlFor={`${id}-before`} ref={promptBeforeLabelRef}>
            PROMPT BEFORE INPUT
          </label>
          <JsonSyntaxTextarea
            className="node-textarea nodrag nowheel"
            id={`${id}-before`}
            ref={promptBeforeRef}
            rows={3}
            value={promptBefores[selectedPromptSlot] ?? ''}
            highlightPlainText
            onChange={(value) => updatePromptBefore(value)}
            onFocus={formatCurrentPrompts}
            onBlur={formatCurrentPrompts}
            workflowVariableDefinitions={view.settingsValueDefinitions}
            workflowVariableValues={view.settingsValues}
            protectedPromptActionTitles={actionConfigs.map((action) => action.title)}
            promptActionStatuses={promptActionStatuses}
            onPromptActionClick={(action) => openPromptActionConfig(action, 'before')}
            promptCommandStatuses={promptCommandStatuses}
            onPromptCommandClick={openPromptCommandConfig}
          />
        </div>
        <div className="llm-prompt-field">
          <label className="node-field-label" htmlFor={`${id}-after`} ref={promptAfterLabelRef}>
            PROMPT AFTER INPUT
          </label>
          <JsonSyntaxTextarea
            className="node-textarea nodrag nowheel"
            id={`${id}-after`}
            ref={promptAfterRef}
            rows={3}
            value={promptAfters[selectedPromptSlot] ?? ''}
            highlightPlainText
            onChange={(value) => updatePromptAfter(value)}
            onFocus={formatCurrentPrompts}
            onBlur={formatCurrentPrompts}
            workflowVariableDefinitions={view.settingsValueDefinitions}
            workflowVariableValues={view.settingsValues}
            protectedPromptActionTitles={actionConfigs.map((action) => action.title)}
            promptActionStatuses={promptActionStatuses}
            onPromptActionClick={(action) => openPromptActionConfig(action, 'after')}
            promptCommandStatuses={promptCommandStatuses}
            onPromptCommandClick={openPromptCommandConfig}
          />
        </div>
      </div>
      <ConnectionSelect
        id={id}
        label="LLM CONNECTION"
        connectionId={data.connectionId}
      />
      <PostOutputToggle id={id} enabled={data.runAfterRpOutput} />
      <label className="node-toggle post-output-toggle nodrag">
        <input
          className="nodrag nowheel"
          type="checkbox"
          checked={data.llmPromptSwitchAutoShowPrompt ?? true}
          onChange={(event) => actions.updateData(id, { llmPromptSwitchAutoShowPrompt: event.target.checked })}
        />
        Automatically show prompt
      </label>
      <label className="node-toggle post-output-toggle nodrag">
        <input
          className="nodrag nowheel"
          type="checkbox"
          checked={autoFormatJson}
          onChange={(event) => updateAutoFormatJson(event.target.checked)}
        />
        Automatically format JSON
      </label>
      <div className="workflow-ports">
        <div className="workflow-port workflow-port-input">
          <Handle id={promptSwitchTextHandle} type="target" position={Position.Left} />
          <PortLabel data={data} direction="input" handle={promptSwitchTextHandle} label="Text Input" valueType="text" />
        </div>
        <div className="workflow-port workflow-port-input">
          <Handle id={imageInputHandle} type="target" position={Position.Left} />
          <PortLabel data={data} direction="input" handle={imageInputHandle} label="Image Input" valueType="image" />
        </div>
        <div className="workflow-port workflow-port-input">
          <Handle id={promptSwitchOutputChannelHandle} type="target" position={Position.Left} />
          <PortLabel data={data} direction="input" handle={promptSwitchOutputChannelHandle} label="Output Channel" valueSuffix={outputTitles[selectedOutputChannel] ?? ''} valueType="number" />
        </div>
        <div className="workflow-port workflow-port-input">
          <Handle id={promptSwitchPromptSlotHandle} type="target" position={Position.Left} />
          <PortLabel data={data} direction="input" handle={promptSwitchPromptSlotHandle} label="Prompt Slot" valueSuffix={promptTitles[selectedPromptSlot] ?? ''} valueType="number" />
        </div>
      </div>
      <PromptPreviewTools
        id={id}
        debug={data.llmPromptSwitchDebug}
        generatedText={data.generatedText}
        runLabel="Prompt Switch"
      />
      <div className="workflow-ports llm-prompt-switch-outputs">
        {outputTitles.map((title, index) => (
          <div className="workflow-port workflow-port-output" key={index}>
            <PortLabel data={data} direction="output" handle={llmPromptSwitchOutputHandle(index)} label={title.trim() || `Output ${index}`} valueType="mixed" />
            <Handle id={llmPromptSwitchOutputHandle(index)} type="source" position={Position.Right} />
          </div>
        ))}
      </div>
    </div>
    {actionDialog ? (
      <PromptActionModal
        key={`${actionDialog.originalTitle}-${actionDialog.originalHasTitle}`}
        id={id}
        initialConfig={actionDialog.draft}
        initialActionSelected={actionDialog.actionSelected}
        usageCount={actionDialog.usageCount}
        customActionPresets={view.promptActionCustomPresets}
        promptActionSettings={view.promptActionSettings}
        setPromptActionSettings={view.setPromptActionSettings}
        visionEnabled={visionEnabled}
        connections={view.connections}
        nodes={view.nodes}
        providerHealthById={view.providerHealthById}
        onCheckProviderConnection={view.onCheckProviderConnection}
        onReplace={applyPromptActionDialog}
        onSaveCustomPreset={saveCustomPromptActionPreset}
        onClose={() => setActionDialog(null)}
      />
    ) : null}
    {commandDialog ? (
      <PromptCommandModal
        key={commandDialog.name}
        id={id}
        initialName={commandDialog.name}
        initialConfig={commandDialog.config}
        usageCount={commandDialog.usageCount}
        onSave={savePromptCommandConfig}
        onClose={() => setCommandDialog(null)}
      />
    ) : null}
    </>
  );
}
