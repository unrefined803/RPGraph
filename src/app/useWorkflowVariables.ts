import type { Edge } from '@xyflow/react';
import {
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { SettingsValueDefinition, WorkflowNode } from '../types';
import {
  builtInWorkflowVariables,
  contextLengthMaxOptionKey,
  defaultWorkflowVariableValue,
  settingsValueEntries,
  settingsValueHandle,
  textReferencesWorkflowVariable,
  textSetsWorkflowVariable,
  workflowVariableValueKind,
  type WorkflowVariableSetCommand,
} from '../workflow';

type UseWorkflowVariablesOptions = {
  nodes: WorkflowNode[];
  edges: Edge[];
  values: Record<string, string>;
  setValues: Dispatch<SetStateAction<Record<string, string>>>;
  setNodes: Dispatch<SetStateAction<WorkflowNode[]>>;
};

function dataContainsWorkflowVariable(
  value: unknown,
  definition: SettingsValueDefinition,
): boolean {
  if (typeof value === 'string') {
    return (
      textReferencesWorkflowVariable(value, definition) ||
      textSetsWorkflowVariable(value, definition)
    );
  }
  if (Array.isArray(value)) {
    return value.some((entry) => dataContainsWorkflowVariable(entry, definition));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some((entry) =>
      dataContainsWorkflowVariable(entry, definition),
    );
  }
  return false;
}

export function useWorkflowVariables({
  nodes,
  edges,
  values,
  setValues,
  setNodes,
}: UseWorkflowVariablesOptions) {
  const definitions = useMemo<SettingsValueDefinition[]>(() => {
    const definitionsByKey = new Map<string, SettingsValueDefinition>(
      builtInWorkflowVariables.map((definition) => [definition.key, definition]),
    );
    Object.entries(values).forEach(([key]) => {
      if (!definitionsByKey.has(key)) {
        definitionsByKey.set(key, {
          key,
          label: key,
          enabled: true,
          valueKind: workflowVariableValueKind(values[key] ?? ''),
          used: false,
          usedAsNumber: false,
        });
      }
    });
    nodes
      .filter((node) => node.data.kind === undefined && node.data.nodeType === 'settings-value')
      .flatMap((node) => settingsValueEntries(node.data))
      .forEach((entry) => {
        const current = definitionsByKey.get(entry.optionKey);
        definitionsByKey.set(entry.optionKey, {
          key: entry.optionKey,
          label: current?.builtIn ? current.label : entry.label,
          enabled: true,
          builtIn: current?.builtIn,
          valueKind: workflowVariableValueKind(
            values[entry.optionKey] ?? defaultWorkflowVariableValue(entry.optionKey),
          ),
          used: true,
          usedAsNumber: false,
        });
      });
    const numberKeys = new Set(
      edges.flatMap((edge) => {
        const source = nodes.find((node) => node.id === edge.source);
        const target = nodes.find((node) => node.id === edge.target);
        if (
          source?.data.nodeType !== 'settings-value' ||
          target?.data.nodeType !== 'context-compression' ||
          edge.targetHandle !== 'max-tokens'
        ) {
          return [];
        }
        const entry = settingsValueEntries(source.data).find(
          (candidate) => settingsValueHandle(candidate.id) === edge.sourceHandle,
        );
        return entry ? [entry.optionKey] : [];
      }),
    );
    return Array.from(definitionsByKey.values()).map((definition) => {
      const usedInText = nodes.some((node) =>
        dataContainsWorkflowVariable(node.data, definition),
      );
      const usedAsNumber = nodes.some(
        (node) =>
          textReferencesWorkflowVariable(
            String(node.data.contextCompressionMaxTokens ?? ''),
            definition,
          ) ||
          textReferencesWorkflowVariable(
            String(node.data.contextCompressionLengthWords ?? ''),
            definition,
          ) ||
          textReferencesWorkflowVariable(String(node.data.fixedNumberValue ?? ''), definition) ||
          textReferencesWorkflowVariable(
            String(node.data.historyLastTurnsCount ?? ''),
            definition,
          ),
      );
      return {
        ...definition,
        valueKind: workflowVariableValueKind(
          values[definition.key] ?? defaultWorkflowVariableValue(definition.key),
        ),
        used: definition.used || usedInText || usedAsNumber,
        usedAsNumber: definition.usedAsNumber || usedAsNumber || numberKeys.has(definition.key),
      };
    });
  }, [edges, nodes, values]);

  const resolvedValues = useMemo(
    () =>
      Object.fromEntries(
        definitions.map((definition) => [
          definition.key,
          values[definition.key] ?? defaultWorkflowVariableValue(definition.key),
        ]),
      ),
    [definitions, values],
  );
  const definitionsRef = useRef(definitions);
  const valuesRef = useRef(values);

  useEffect(() => {
    definitionsRef.current = definitions;
  }, [definitions]);
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  function replaceValues(nextValues: Record<string, string>) {
    const clonedValues = structuredClone(nextValues);
    valuesRef.current = clonedValues;
    setValues(clonedValues);
  }

  function valuesForGraph() {
    const currentValues = valuesRef.current;
    return Object.fromEntries(
      definitionsRef.current.map((definition) => [
        definition.key,
        currentValues[definition.key] ?? defaultWorkflowVariableValue(definition.key),
      ]),
    );
  }

  function changeValue(optionKey: string, value: string) {
    setValues((currentValues) => ({
      ...currentValues,
      [optionKey]: value,
    }));
    valuesRef.current = {
      ...valuesRef.current,
      [optionKey]: value,
    };
  }

  function setValuesFromCommands(commands: WorkflowVariableSetCommand[]) {
    const nextValues = { ...valuesRef.current };
    const currentDefinitions = definitionsRef.current;
    commands.forEach((command) => {
      const name = command.name.trim();
      if (!name) {
        return;
      }
      const normalizedName = name.toLocaleLowerCase();
      const definition = currentDefinitions.find(
        (entry) =>
          entry.key.toLocaleLowerCase() === normalizedName ||
          entry.label.toLocaleLowerCase() === normalizedName,
      );
      const existingCustomKey = Object.keys(nextValues).find(
        (key) => key.toLocaleLowerCase() === normalizedName,
      );
      nextValues[definition?.key ?? existingCustomKey ?? name] = command.value;
    });
    replaceValues(nextValues);
  }

  function addValue() {
    setValues((currentValues) => {
      let index = 1;
      let key = `custom-variable-${index}`;
      while (currentValues[key] !== undefined) {
        index += 1;
        key = `custom-variable-${index}`;
      }
      const nextValues = { ...currentValues, [key]: '' };
      valuesRef.current = nextValues;
      return nextValues;
    });
  }

  function renameValue(optionKey: string, label: string) {
    const normalizedLabel = label.trim();
    if (!normalizedLabel || optionKey === contextLengthMaxOptionKey) {
      return;
    }
    const definition = definitions.find((entry) => entry.key === optionKey);
    const duplicateDefinition = definitions.some(
      (entry) =>
        entry.key !== optionKey &&
        (entry.key.toLocaleLowerCase() === normalizedLabel.toLocaleLowerCase() ||
          entry.label.toLocaleLowerCase() === normalizedLabel.toLocaleLowerCase()),
    );
    if (duplicateDefinition) {
      return;
    }
    if (!definition?.builtIn && optionKey !== normalizedLabel) {
      setValues((currentValues) => {
        if (currentValues[normalizedLabel] !== undefined) {
          return currentValues;
        }
        const nextValues = {
          ...currentValues,
          [normalizedLabel]: currentValues[optionKey] ?? '',
        };
        delete nextValues[optionKey];
        valuesRef.current = nextValues;
        return nextValues;
      });
    }
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.data.nodeType === 'settings-value'
          ? {
              ...node,
              data: {
                ...node.data,
                settingsValueEntries: settingsValueEntries(node.data).map((entry) =>
                  entry.optionKey === optionKey
                    ? {
                        ...entry,
                        optionKey: definition?.builtIn ? entry.optionKey : normalizedLabel,
                        label: normalizedLabel,
                      }
                    : entry,
                ),
              },
            }
          : node,
      ),
    );
  }

  function removeValue(optionKey: string) {
    const definition = definitions.find((entry) => entry.key === optionKey);
    if (definition?.builtIn || definition?.used) {
      return;
    }
    setValues((currentValues) => {
      const nextValues = { ...currentValues };
      delete nextValues[optionKey];
      valuesRef.current = nextValues;
      return nextValues;
    });
  }

  return {
    definitions,
    definitionsRef,
    resolvedValues,
    valuesRef,
    replaceValues,
    valuesForGraph,
    changeValue,
    setValuesFromCommands,
    addValue,
    renameValue,
    removeValue,
  };
}
