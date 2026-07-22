import { useCallback, useEffect, useRef, useState } from 'react';
import type { Edge } from '@xyflow/react';
import type {
  CustomNodeAssistantDiagnostic,
  CustomNodeAssistantMessage,
} from '../components/AppDialogs';
import type { NodeLlmApi } from '../llm/NodeLlmApi';
import {
  customNodeAssistantPrompt,
  customNodeDefinition,
  defaultCustomNodeDefinition,
  isCustomNodeDefinition,
  parseCustomNodeAssistantResult,
} from '../nodes/custom-node/model';
import {
  assertAllowedCustomNodeCode,
  assertCompilableCustomNodeCode,
  inputValuesFromRuntimePorts,
  outputRuntimePortValues,
  runCustomNodeDefinition,
} from '../nodes/custom-node/runtime';
import {
  customNodeImageInputMetadata,
  customNodeImageInputsFromGraph,
  customNodeImagesForRequest,
} from '../nodes/custom-node/images';
import type {
  ChatImageAttachment,
  WorkflowNode,
  WorkflowNodeData,
} from '../types';

type UseCustomNodeAssistantOptions = {
  nodes: WorkflowNode[];
  nodesRef: { current: WorkflowNode[] };
  edges: Edge[];
  inputImages: ChatImageAttachment[];
  nodeLlm: NodeLlmApi;
  updateRuntimeNode: (nodeId: string, patch: Partial<WorkflowNodeData>) => void;
};

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': Error: /,
    '',
  );
}

function securityReviewRole(text: string): CustomNodeAssistantMessage['role'] {
  const verdictMatch = /^Verdict:\s*(Safe|Needs changes|Unsafe)\s*$/im.exec(text);
  if (!verdictMatch) {
    return 'assistant';
  }
  return verdictMatch[1].toLowerCase() === 'safe' ? 'assistant' : 'error';
}

export function useCustomNodeAssistant({
  nodes,
  nodesRef,
  edges,
  inputImages,
  nodeLlm,
  updateRuntimeNode,
}: UseCustomNodeAssistantOptions) {
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [histories, setHistories] = useState<Record<string, CustomNodeAssistantMessage[]>>({});
  const [diagnostics, setDiagnostics] = useState<Record<string, CustomNodeAssistantDiagnostic[]>>({});
  const lastRunErrorRef = useRef<Record<string, string>>({});
  const diagnosticCounterRef = useRef(0);

  const appendDiagnostic = useCallback((
    nodeId: string,
    source: string,
    message: string,
    expanded = true,
  ) => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      return;
    }
    diagnosticCounterRef.current += 1;
    const diagnostic: CustomNodeAssistantDiagnostic = {
      id: `${nodeId}-${Date.now()}-${diagnosticCounterRef.current}`,
      source,
      message: trimmedMessage,
      createdAt: Date.now(),
      expanded,
    };
    setDiagnostics((current) => {
      const existing = current[nodeId] ?? [];
      const deduped = existing.filter(
        (entry) => entry.source !== diagnostic.source || entry.message !== diagnostic.message,
      );
      return {
        ...current,
        [nodeId]: [...deduped, diagnostic].slice(-8),
      };
    });
  }, []);

  useEffect(() => {
    nodes.forEach((node) => {
      if (node.data.kind !== undefined || node.data.nodeType !== 'custom') {
        return;
      }
      const runError = node.data.runError?.trim();
      if (!runError) {
        delete lastRunErrorRef.current[node.id];
        return;
      }
      if (lastRunErrorRef.current[node.id] === runError) {
        return;
      }
      lastRunErrorRef.current[node.id] = runError;
      appendDiagnostic(node.id, 'Workflow run error', `${node.data.label}: ${runError}`);
    });
  }, [appendDiagnostic, nodes]);

  function appendMessage(nodeId: string, message: CustomNodeAssistantMessage) {
    setHistories((current) => ({
      ...current,
      [nodeId]: [...(current[nodeId] ?? []), message],
    }));
  }

  function diagnosticContext(nodeId: string) {
    return (diagnostics[nodeId] ?? [])
      .map((entry) => `DIAGNOSTIC ${entry.source}: ${entry.message}`)
      .join('\n\n');
  }

  async function submitMessage(message: string, connectionId: string) {
    const nodeId = activeNodeId;
    const node = nodesRef.current.find((candidate) => candidate.id === nodeId);
    if (!nodeId || !node || node.data.nodeType !== 'custom') {
      return;
    }
    const recentChatContext = (histories[nodeId] ?? [])
      .slice(-12)
      .map((entry) => `${entry.role.toUpperCase()}: ${entry.text}`)
      .join('\n\n');
    const assistantContext = [diagnosticContext(nodeId), recentChatContext]
      .filter(Boolean)
      .join('\n\n');

    appendMessage(nodeId, { role: 'user', text: message });
    updateRuntimeNode(nodeId, { preview: 'Custom Node Assistant thinking ...', llmCallStats: [] });

    try {
      const currentDefinition = customNodeDefinition(node.data.customNodeDefinition);
      const completion = await nodeLlm.complete({
        connectionId,
        nodeId,
        label: 'Custom Node Assistant',
        purpose: 'Custom Node Assistant',
        prompt: customNodeAssistantPrompt(currentDefinition, message, assistantContext),
      });
      const result = parseCustomNodeAssistantResult(completion.text, currentDefinition);
      if (result.definition) {
        assertCompilableCustomNodeCode(result.definition.code);
        updateRuntimeNode(nodeId, {
          customNodeDefinition: result.definition,
          connectionId,
          preview: `Updated via ${completion.connection.label}`,
        });
      } else {
        updateRuntimeNode(nodeId, {
          connectionId,
          preview: `Answered via ${completion.connection.label}`,
        });
      }
      const changed = result.changedFields.length
        ? `Changed: ${result.changedFields.slice(0, 5).join(', ')}. `
        : '';
      appendMessage(nodeId, { role: 'assistant', text: `${changed}${result.reply}` });
    } catch (error) {
      const messageText = errorMessage(error);
      updateRuntimeNode(nodeId, { preview: `Custom Node Assistant failed: ${messageText}` });
      appendMessage(nodeId, {
        role: 'error',
        text: [
          'Assistant output could not be applied.',
          messageText,
          'Ask me to fix it, and I will use this error plus the current definition as context.',
        ].join('\n'),
      });
    }
  }

  function applyDefinitionText(nodeId: string, text: string) {
    const node = nodesRef.current.find((candidate) => candidate.id === nodeId);
    if (!node || node.data.nodeType !== 'custom') {
      return;
    }
    try {
      const currentDefinition = customNodeDefinition(node.data.customNodeDefinition);
      const parsed = JSON.parse(text) as unknown;
      const definition = isCustomNodeDefinition(parsed)
        ? parsed
        : parseCustomNodeAssistantResult(text, currentDefinition).definition;
      if (!definition) {
        throw new Error('Pasted text contains only an assistant reply, not a Custom Node definition or patch.');
      }
      assertCompilableCustomNodeCode(definition.code);
      updateRuntimeNode(nodeId, {
        customNodeDefinition: definition,
        preview: 'Custom Node definition pasted',
      });
      appendMessage(nodeId, { role: 'assistant', text: 'Pasted Custom Node definition applied.' });
    } catch (error) {
      appendMessage(nodeId, { role: 'error', text: `Paste failed: ${errorMessage(error)}` });
    }
  }

  function resetDefinition(nodeId: string) {
    const node = nodesRef.current.find((candidate) => candidate.id === nodeId);
    if (!node || node.data.nodeType !== 'custom') {
      return;
    }
    updateRuntimeNode(nodeId, {
      customNodeDefinition: defaultCustomNodeDefinition(),
      customNodeRuntimeDisplays: {},
      runtimePortValues: {},
      preview: 'Custom Node reset',
    });
    setDiagnostics((current) => ({ ...current, [nodeId]: [] }));
    delete lastRunErrorRef.current[nodeId];
    appendMessage(nodeId, {
      role: 'assistant',
      text: 'Custom Node reset to the default empty definition.',
    });
  }

  function checkStructure(nodeId: string) {
    const node = nodesRef.current.find((candidate) => candidate.id === nodeId);
    if (!node || node.data.nodeType !== 'custom') {
      return;
    }
    const definition = customNodeDefinition(node.data.customNodeDefinition);
    const response = (() => {
      try {
        const issues: string[] = [];
        if (!definition.code.trim()) {
          issues.push('No runtime code is defined yet.');
        } else {
          assertCompilableCustomNodeCode(definition.code);
        }
        const duplicateGroups = [
          ['inputs', definition.inputs.map((port) => port.id)],
          ['outputs', definition.outputs.map((port) => port.id)],
          ['controls', definition.controls.map((control) => control.id)],
          ['displays', definition.displays.map((display) => display.id)],
        ] as const;
        duplicateGroups.forEach(([label, ids]) => {
          const seen = new Set<string>();
          ids.forEach((entry) => {
            if (seen.has(entry)) {
              issues.push(`Duplicate ${label} id: ${entry}`);
            }
            seen.add(entry);
          });
        });
        if (definition.inputs.length > 0 && definition.outputs.length === 0) {
          issues.push(
            'This Custom Node has inputs but no outputs. It can update displays during a workflow run, but it cannot pass a value to another node.',
          );
        }
        definition.outputs.forEach((port) => {
          if (!definition.code.includes(port.id)) {
            issues.push(`Output "${port.id}" is defined, but the code does not visibly reference that id.`);
          }
        });
        definition.displays.forEach((display) => {
          if (display.id !== 'about' && definition.code.trim() && !definition.code.includes(display.id)) {
            issues.push(`Display "${display.id}" is defined, but the code does not visibly reference that id.`);
          }
        });
        definition.controls.forEach((control) => {
          if (control.action && control.action !== 'run-code' && !control.stateKey) {
            issues.push(`Button "${control.id}" uses ${control.action} but has no stateKey.`);
          }
          if ((control.type === 'select' || control.type === 'radio') && (!control.options || control.options.length === 0)) {
            issues.push(`${control.type} "${control.id}" has no options.`);
          }
        });
        return issues.length
          ? `Structure check found possible issues:\n${issues.map((issue) => `- ${issue}`).join('\n')}`
          : 'Structure check passed. The definition shape is valid and the runtime code compiles.';
      } catch (error) {
        return `Structure check failed: ${errorMessage(error)}`;
      }
    })();
    appendMessage(nodeId, {
      role: response.includes('failed') || response.includes('issues') ? 'error' : 'assistant',
      text: response,
    });
  }

  async function checkSecurity(nodeId: string, connectionId: string) {
    const node = nodesRef.current.find((candidate) => candidate.id === nodeId);
    if (!node || node.data.nodeType !== 'custom') {
      return;
    }
    const definition = customNodeDefinition(node.data.customNodeDefinition);
    const localReport = (() => {
      try {
        assertAllowedCustomNodeCode(definition.code);
        return definition.code.trim()
          ? 'Local blocked-API scan passed.'
          : 'Local blocked-API scan passed. There is no runtime code yet.';
      } catch (error) {
        return `Local blocked-API scan failed: ${errorMessage(error)}`;
      }
    })();
    appendMessage(nodeId, {
      role: localReport.includes('failed') ? 'error' : 'assistant',
      text: `Security review started.\n${localReport}`,
    });
    try {
      const completion = await nodeLlm.complete({
        connectionId,
        nodeId,
        label: 'Custom Node Security Review',
        purpose: 'Custom Node Security Review',
        prompt: [
          'You are reviewing a user-generated RPGraph Custom Node definition for security.',
          'Return a concise security report for the user.',
          'Focus on exfiltration, network access, filesystem/browser access, dynamic code execution, prompt injection risks inside LLM prompts, suspicious obfuscation, infinite loops, and unwanted state/output behavior.',
          'The runtime executes the code in a sandboxed environment without file, network, storage, or Electron access, and additionally blocks imports, require, fetch, window, document, globalThis, self, process, eval, Function, constructor, XMLHttpRequest, WebSocket, and EventSource, but you should still mention any suspicious pattern.',
          'Do not rewrite the code. Do not execute it.',
          'Use this shape:',
          'Verdict: Safe | Needs changes | Unsafe',
          'Findings:',
          '- ...',
          'Suggested fix:',
          '- ...',
          '',
          JSON.stringify(definition, null, 2),
        ].join('\n'),
      });
      appendMessage(nodeId, { role: securityReviewRole(completion.text), text: completion.text });
    } catch (error) {
      appendMessage(nodeId, { role: 'error', text: `Security review failed: ${errorMessage(error)}` });
    }
  }

  async function runButton(nodeId: string, label: string) {
    const node = nodesRef.current.find((candidate) => candidate.id === nodeId);
    if (!node || node.data.nodeType !== 'custom') {
      return;
    }
    const definition = customNodeDefinition(node.data.customNodeDefinition);
    updateRuntimeNode(nodeId, {
      preview: `${label} running ...`,
      llmCallStats: [],
      runActive: true,
      runCompleted: false,
      runPrepared: false,
      runError: undefined,
    });
    try {
      const uniqueInputImages = Array.from(
        new Map(inputImages.map((image) => [image.id, image])).values(),
      );
      const imageInputs = customNodeImageInputsFromGraph(definition, node, {
        nodes: nodesRef.current,
        edges,
        inputImages: uniqueInputImages,
      });
      const result = await runCustomNodeDefinition(
        definition,
        {
          ...inputValuesFromRuntimePorts(definition, node.data.runtimePortValues),
          ...customNodeImageInputMetadata(imageInputs),
        },
        {
          llm: async (request) => {
            const prompt = typeof request === 'string' ? request : request.prompt;
            const requestedImages = typeof request === 'string' ? undefined : request.images;
            const completion = await nodeLlm.complete({
              connectionId: node.data.connectionId,
              nodeId,
              label: typeof request === 'string' ? label : request.label ?? label,
              purpose: 'Custom Node LLM',
              prompt,
              images: customNodeImagesForRequest(requestedImages, imageInputs),
              maxTokens: typeof request === 'string' ? undefined : request.maxTokens,
              temperature: typeof request === 'string' ? undefined : request.temperature,
              contributesToTokenCalibration: true,
            });
            return completion.text;
          },
        },
      );
      updateRuntimeNode(nodeId, {
        preview: `${label} ran`,
        customNodeRuntimeDisplays: result.displays,
        runtimePortValues: outputRuntimePortValues(result.outputs, node.data.runtimePortValues),
        customNodeDefinition: { ...definition, state: result.state },
        runActive: false,
        runCompleted: true,
        runPrepared: false,
        runError: undefined,
      });
    } catch (error) {
      const messageText = errorMessage(error);
      updateRuntimeNode(nodeId, {
        preview: `${label} failed: ${messageText}`,
        runActive: false,
        runCompleted: false,
        runPrepared: false,
        runError: messageText,
      });
      lastRunErrorRef.current[nodeId] = messageText.trim();
      appendDiagnostic(nodeId, `${label} run error`, messageText);
    }
  }

  function open(nodeId: string) {
    setActiveNodeId(nodeId);
    setHistories((current) => ({ ...current, [nodeId]: current[nodeId] ?? [] }));
  }

  function close() {
    setActiveNodeId(null);
  }

  function clearChat(nodeId: string) {
    setHistories((current) => ({ ...current, [nodeId]: [] }));
    setDiagnostics((current) => ({ ...current, [nodeId]: [] }));
    delete lastRunErrorRef.current[nodeId];
    updateRuntimeNode(nodeId, {
      runActive: false,
      runCompleted: false,
      runPrepared: false,
      runError: undefined,
    });
  }

  function clearState() {
    setHistories({});
    setDiagnostics({});
    lastRunErrorRef.current = {};
    setActiveNodeId(null);
  }

  function toggleDiagnostic(nodeId: string, diagnosticId: string) {
    setDiagnostics((current) => ({
      ...current,
      [nodeId]: (current[nodeId] ?? []).map((entry) =>
        entry.id === diagnosticId ? { ...entry, expanded: !entry.expanded } : entry,
      ),
    }));
  }

  function dismissDiagnostic(nodeId: string, diagnosticId: string) {
    setDiagnostics((current) => ({
      ...current,
      [nodeId]: (current[nodeId] ?? []).filter((entry) => entry.id !== diagnosticId),
    }));
  }

  const activeNode = nodes.find((node) => node.id === activeNodeId);

  return {
    activeNode,
    messages: activeNodeId ? histories[activeNodeId] ?? [] : [],
    diagnostics: activeNodeId ? diagnostics[activeNodeId] ?? [] : [],
    submitMessage,
    applyDefinitionText,
    resetDefinition,
    checkStructure,
    checkSecurity,
    runButton,
    open,
    close,
    clearChat,
    clearState,
    toggleDiagnostic,
    dismissDiagnostic,
  };
}
