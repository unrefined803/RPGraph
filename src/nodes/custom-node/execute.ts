import type { WorkflowNode } from '../../types';
import type { ExecuteContext } from '../types';
import {
  customNodeImageInputMetadata,
  customNodeImageInputsFromGraph,
  customNodeImagesForRequest,
} from './images';
import { customNodeDefinition } from './model';
import { coercePortValue, runCustomNodeDefinition } from './runtime';

export async function executeCustomNode(node: WorkflowNode, context: ExecuteContext): Promise<string> {
  const definition = customNodeDefinition(node.data.customNodeDefinition);
  if (!definition.code.trim()) {
    context.updateRuntimeData(node.id, {
      preview: 'Custom Node has no runtime code yet',
      customNodeRuntimeDisplays: {},
    });
    return '';
  }

  const inputs: Record<string, unknown> = {};
  const imageInputs = customNodeImageInputsFromGraph(definition, node, context);
  Object.assign(inputs, customNodeImageInputMetadata(imageInputs));
  await Promise.all(definition.inputs.map(async (port) => {
    const edge = context.edges.find(
      (candidate) => candidate.target === node.id && candidate.targetHandle === port.id,
    );
    if (port.valueType === 'image') {
      if (edge) {
        await context.executeInput(edge.source, edge.sourceHandle);
      }
      return;
    }
    const rawValue = edge ? await context.executeInput(edge.source, edge.sourceHandle) : '';
    inputs[port.id] = coercePortValue(rawValue, port.valueType);
  }));

  // Stream raw LLM chunks as a live preview only when this node feeds the RP
  // Output directly; the node's processed result replaces the preview at the end.
  const streamsVisibleOutput = !!context.streamOutput && context.edges.some(
    (edge) => edge.source === node.id && edge.target === context.outputNodeId,
  );
  const result = await runCustomNodeDefinition(definition, inputs, {
    llm: async (request) => {
      const prompt = typeof request === 'string' ? request : request.prompt;
      const requestedImages = typeof request === 'string' ? undefined : request.images;
      const images = customNodeImagesForRequest(requestedImages, imageInputs);
      const output = await context.llm.complete({
        connectionId: node.data.connectionId,
        nodeId: node.id,
        label: typeof request === 'string' ? 'Custom Node LLM' : request.label ?? 'Custom Node LLM',
        prompt,
        images,
        maxTokens: typeof request === 'string' ? undefined : request.maxTokens,
        temperature: typeof request === 'string' ? undefined : request.temperature,
        onChunk: streamsVisibleOutput ? context.streamOutput : undefined,
        contributesToTokenCalibration: true,
      });
      return output.text;
    },
  });
  const sourceHandle = context.sourceHandle ?? definition.outputs[0]?.id ?? 'default';
  const outputValue = result.outputs[sourceHandle] ?? '';

  context.updateRuntimeData(node.id, {
    preview: definition.outputs.length
      ? `Custom code ran: ${sourceHandle}`
      : 'Custom code ran',
    customNodeRuntimeDisplays: result.displays,
    customNodeDefinition: {
      ...definition,
      state: result.state,
    },
  });
  Object.entries(result.outputs).forEach(([handle, value]) => {
    context.updateRuntimePortValue(node.id, 'output', handle, value);
  });
  return outputValue;
}
