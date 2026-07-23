import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Handle, NodeResizeControl, Position, ResizeControlVariant, type NodeProps } from '@xyflow/react';
import type { WorkflowNode } from '../../types';
import { useNodeActions } from '../NodeActionsContext';
import { useNodeView } from '../NodeViewContext';
import { ConnectionSelect } from '../shared/ConnectionSelect';
import { LlmCallMetrics, runStateClassName, useNodeLayoutSync } from '../shared/CardView';
import { PortLabel } from '../shared/PortValue';
import { PostOutputToggle } from '../shared/PostOutputToggle';
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

export function LlmPromptNodeCard({ id, data }: NodeProps<WorkflowNode>) {
  const actions = useNodeActions();
  const nodeBodyRef = useNodeLayoutSync(id);
  const promptFieldsRef = useRef<HTMLDivElement>(null);
  const promptBeforeLabelRef = useRef<HTMLLabelElement>(null);
  const promptAfterLabelRef = useRef<HTMLLabelElement>(null);
  const promptBeforeRef = useRef<HTMLTextAreaElement>(null);
  const promptAfterRef = useRef<HTMLTextAreaElement>(null);
  const view = useNodeView();
  const autoFormatJson = data.llmPromptAutoFormatJson ?? true;
  const beforeOverridden = view.edges.some(
    (edge) => edge.target === id && edge.targetHandle === 'prompt-before',
  );
  const afterOverridden = view.edges.some(
    (edge) => edge.target === id && edge.targetHandle === 'prompt-after',
  );
  const storedActionConfigs = promptActionConfigs(data.llmPromptActions);
  const actionConfigs = withPromptActionRuntimeSettingsList(storedActionConfigs, view.promptActionSettings);
  const [actionDialog, setActionDialog] = useState<{
    originalTitle: string;
    originalHasTitle: boolean;
    originalIndex: number;
    source: 'before' | 'after';
    config: PromptActionConfig;
    actionSelected: boolean;
    usageCount: number;
  } | null>(null);
  const selectedConnection = view.connections.find((connection) => connection.id === data.connectionId)
    ?? view.connections[0];
  const visionEnabled = !!selectedConnection?.vision;
  const comfyProviderIds = view.connections
    .filter((connection) => connection.kind === 'comfyui')
    .map((connection) => connection.id);
  const createImageCharacters = storybookCreateImageCharactersFromNodes(view.nodes);
  const [commandDialog, setCommandDialog] = useState<{
    name: string;
    config?: PromptCommandConfig;
    usageCount: number;
  } | null>(null);
  const commandConfigs = promptCommandConfigs(data.llmPromptCommands);
  const promptCommandStatuses = Object.fromEntries(
    [data.llmPromptBefore ?? '', data.llmPromptAfter ?? '']
      .flatMap((text) => parsePromptCommandTokens(text))
      .filter((token) => !knownPromptCommandId(token.name))
      .map((token) => [token.name, { tone: 'error' as const, label: 'unknown command', disabled: true }]),
  );
  const openPromptCommandConfig = (command: { name: string }) => {
    const commandId = knownPromptCommandId(command.name);
    setCommandDialog({
      name: command.name,
      config: commandId ? configForPromptCommandToken(commandConfigs, commandId) : undefined,
      usageCount: countPromptCommandUses(
        [data.llmPromptBefore ?? '', data.llmPromptAfter ?? ''],
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
    const promptLabelGap = 12;
    const availableTextareaHeight =
      fields.clientHeight -
      fieldGap -
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
  }, [data.llmPromptAfter, data.llmPromptBefore, beforeOverridden, afterOverridden, syncPromptTextareaHeights]);

  const formatJsonValue = (value: string) => {
    try {
      return formatJsonTextSegments(value);
    } catch {
      return value;
    }
  };

  const maybeFormatJson = (value: string) => (autoFormatJson ? formatJsonValue(value) : value);

  const updatePromptBefore = (value: string) => {
    actions.updateData(id, { llmPromptBefore: maybeFormatJson(value) });
  };

  const updatePromptAfter = (value: string) => {
    actions.updateData(id, { llmPromptAfter: maybeFormatJson(value) });
  };

  const formatCurrentPrompts = () => {
    const currentBefore = data.llmPromptBefore ?? '';
    const currentAfter = data.llmPromptAfter ?? '';
    const formattedBefore = formatPromptCommandTokens(maybeFormatJson(currentBefore));
    const formattedAfter = formatPromptCommandTokens(maybeFormatJson(currentAfter));
    if (formattedBefore === currentBefore && formattedAfter === currentAfter) {
      return;
    }
    actions.updateData(id, {
      llmPromptBefore: formattedBefore,
      llmPromptAfter: formattedAfter,
    });
  };

  const updateAutoFormatJson = (enabled: boolean) => {
    if (!enabled) {
      actions.updateData(id, { llmPromptAutoFormatJson: enabled });
      return;
    }
    actions.updateData(id, {
      llmPromptAutoFormatJson: enabled,
      llmPromptBefore: formatJsonValue(data.llmPromptBefore ?? ''),
      llmPromptAfter: formatJsonValue(data.llmPromptAfter ?? ''),
    });
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
    const config = configuredAction ?? configForPromptActionToken(actionConfigs, title);
    setActionDialog({
      originalTitle: title,
      originalHasTitle: hasTitle,
      originalIndex: index,
      source,
      config,
      actionSelected: hasTitle && (
        !!configuredAction || promptActionKey(config.title) === normalizedTitle
      ),
      usageCount: countPromptActionUses(
        [data.llmPromptBefore ?? '', data.llmPromptAfter ?? ''],
        title,
      ),
    });
  };

  const applyPromptActionConfig = (
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
    const patch: Record<string, unknown> = { llmPromptActions: nextActions };
    if (scope === 'single') {
      const key = actionDialog.source === 'before' ? 'llmPromptBefore' : 'llmPromptAfter';
      patch[key] = replacePromptActionAtIndex(
        String(data[key] ?? ''),
        actionDialog.originalIndex,
        promptTitle,
      );
    } else if (!actionDialog.originalHasTitle || promptTitle !== actionDialog.originalTitle) {
      patch.llmPromptBefore = replacePromptActionTitle(
        data.llmPromptBefore ?? '',
        actionDialog.originalTitle,
        promptTitle,
        actionDialog.originalHasTitle,
      );
      patch.llmPromptAfter = replacePromptActionTitle(
        data.llmPromptAfter ?? '',
        actionDialog.originalTitle,
        promptTitle,
        actionDialog.originalHasTitle,
      );
    }
    actions.updateData(id, patch);
    if (options.close === false) {
      setActionDialog({
        ...actionDialog,
        config,
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

  return (
    <>
    <div className={`workflow-node llm-prompt-node${runStateClassName(data)}`} ref={nodeBodyRef}>
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
      <div className="llm-prompt-fields" ref={promptFieldsRef}>
        <div className={`llm-prompt-field${beforeOverridden ? ' llm-prompt-field-overridden' : ''}`}>
          <label className="node-field-label" htmlFor={`${id}-before`} ref={promptBeforeLabelRef}>
            PROMPT BEFORE INPUT
            {beforeOverridden ? (
              <span className="llm-prompt-override-badge">Overridden by connection</span>
            ) : null}
          </label>
          <JsonSyntaxTextarea
            className="node-textarea nodrag nowheel"
            id={`${id}-before`}
            ref={promptBeforeRef}
            rows={3}
            value={data.llmPromptBefore ?? ''}
            onChange={updatePromptBefore}
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
        <div className={`llm-prompt-field${afterOverridden ? ' llm-prompt-field-overridden' : ''}`}>
          <label className="node-field-label" htmlFor={`${id}-after`} ref={promptAfterLabelRef}>
            PROMPT AFTER INPUT
            {afterOverridden ? (
              <span className="llm-prompt-override-badge">Overridden by connection</span>
            ) : null}
          </label>
          <JsonSyntaxTextarea
            className="node-textarea nodrag nowheel"
            id={`${id}-after`}
            ref={promptAfterRef}
            rows={3}
            value={data.llmPromptAfter ?? ''}
            onChange={updatePromptAfter}
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
          checked={autoFormatJson}
          onChange={(event) => updateAutoFormatJson(event.target.checked)}
        />
        Automatically format JSON
      </label>
      <div className="workflow-ports">
        <div className="workflow-port workflow-port-input">
          <Handle type="target" position={Position.Left} />
          <PortLabel data={data} direction="input" label="Text Input" valueType="text" />
        </div>
        <div className="workflow-port workflow-port-input">
          <Handle id="image" type="target" position={Position.Left} />
          <PortLabel data={data} direction="input" handle="image" label="Image Input" valueType="image" />
        </div>
        <div className="workflow-port workflow-port-input">
          <Handle id="prompt-before" type="target" position={Position.Left} />
          <PortLabel
            data={data}
            direction="input"
            handle="prompt-before"
            label="Prompt Before Override"
            valueType="mixed"
          />
        </div>
        <div className="workflow-port workflow-port-input">
          <Handle id="prompt-after" type="target" position={Position.Left} />
          <PortLabel
            data={data}
            direction="input"
            handle="prompt-after"
            label="Prompt After Override"
            valueType="mixed"
          />
        </div>
      </div>
      <PromptPreviewTools
        id={id}
        debug={data.llmPromptDebug}
        generatedText={data.generatedText}
        runLabel="LLM Prompt"
      />
      <div className="workflow-ports">
        <div className="workflow-port workflow-port-output">
          <PortLabel data={data} direction="output" label="Text" valueType="mixed" />
          <Handle type="source" position={Position.Right} />
        </div>
      </div>
    </div>
    {actionDialog ? (
      <PromptActionModal
        key={`${actionDialog.originalTitle}-${actionDialog.originalHasTitle}`}
        id={id}
        initialConfig={actionDialog.config}
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
        onReplace={applyPromptActionConfig}
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
