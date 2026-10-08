import type { Edge } from '@xyflow/react';
import { fastTaskReasoningStart, fastTaskReasoningEnd } from '../../llm/fastTaskPrompt';
import { NodeLlmApi } from '../../llm/NodeLlmApi';
import { TextMetricsApi } from '../../llm/tokenMetrics';
import type { SettingsValueDefinition, WorkflowNode, WorkflowNodeData } from '../../types';
import {
  contextCompressionMaxTokensHandle,
  resolveWorkflowNumber,
  validCompressionLengthWords,
  validCompressionRatio,
  validCompressionTokenLimit,
} from '../../workflow';

function semanticPrefixEnd(text: string, target: number) {
  if (!text) {
    return 0;
  }
  const desired = Math.min(text.length, Math.max(1, target));
  const tolerance = Math.max(160, Math.floor(text.length * 0.16));
  const nearbyBoundary = (pattern: RegExp) => {
    const boundaries = Array.from(text.matchAll(pattern), (match) => {
      const matched = match[0];
      const trailingWhitespace = matched.match(/\s*$/)?.[0].length ?? 0;
      return (match.index ?? 0) + matched.length - trailingWhitespace;
    }).filter(
      (index) => index > 0 && Math.abs(index - desired) <= tolerance,
    );
    return boundaries.sort(
      (left, right) => Math.abs(left - desired) - Math.abs(right - desired),
    )[0];
  };

  const paragraphEnd = nearbyBoundary(/\n\s*\n+/g);
  if (paragraphEnd !== undefined) {
    return paragraphEnd;
  }
  const sentenceEnd = nearbyBoundary(/[.!?…](?:["'”’»)}\]]*)\s+/g);
  if (sentenceEnd !== undefined) {
    return sentenceEnd;
  }

  const nextSpace = text.indexOf(' ', desired);
  if (nextSpace !== -1 && nextSpace - desired <= tolerance) {
    return nextSpace;
  }
  const previousSpace = text.lastIndexOf(' ', desired);
  return previousSpace > 0 ? previousSpace : desired;
}

function prefixEndForTokenBudget(text: string, maxTokens: number, textMetrics: TextMetricsApi) {
  if (!text.trim()) {
    return 0;
  }
  let low = 1;
  let high = text.length;
  let best = 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (textMetrics.measure(text.slice(0, mid)).tokens <= maxTokens) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const semanticEnd = semanticPrefixEnd(text, best);
  return textMetrics.measure(text.slice(0, semanticEnd)).tokens <= maxTokens
    ? semanticEnd
    : best;
}

export async function executeContextCompressionNode({
  node,
  incoming,
  executeNode,
  llm,
  textMetrics,
  estimatedTokenBytesPerToken,
  settingsValueDefinitions,
  settingsValues,
  postOutputRun,
  blockPostOutput,
  updateRuntimeNode,
}: {
  node: WorkflowNode;
  incoming: Edge[];
  executeNode: (nodeId: string, sourceHandle?: string | null) => Promise<string>;
  llm: NodeLlmApi;
  textMetrics: TextMetricsApi;
  estimatedTokenBytesPerToken: number;
  settingsValueDefinitions: SettingsValueDefinition[];
  settingsValues: Record<string, string>;
  postOutputRun: boolean;
  blockPostOutput: (message: string) => never;
  updateRuntimeNode: (nodeId: string, patch: Partial<WorkflowNodeData>) => void;
}) {
  const incomingEdge = incoming.find(
    (edge) => edge.targetHandle !== contextCompressionMaxTokensHandle,
  );
  if (!incomingEdge) {
    throw new Error('Context Compression has no incoming Text connection.');
  }
  const inputValue = await executeNode(incomingEdge.source, incomingEdge.sourceHandle);
  const maxTokensEdge = incoming.find(
    (edge) => edge.targetHandle === contextCompressionMaxTokensHandle,
  );
  const connectedMaxTokens = maxTokensEdge
    ? resolveWorkflowNumber(
        await executeNode(maxTokensEdge.source, maxTokensEdge.sourceHandle),
        [],
        {},
      )
    : undefined;
  const cachedPrefix = node.data.compressionSourceText;
  const cachedSummary = node.data.compressedText;
  const hasCachedCompression = !!cachedPrefix && cachedSummary !== undefined;
  const cacheMatches = hasCachedCompression && inputValue.startsWith(cachedPrefix);
  const compressedPrefixChanged = hasCachedCompression && !cacheMatches;
  const remainingText = cacheMatches ? inputValue.slice(cachedPrefix.length) : inputValue;
  const compressedInput = cacheMatches
    ? [`[Compressed earlier context]`, cachedSummary, remainingText]
        .filter(Boolean)
        .join('\n\n')
    : inputValue;
  const resolvedMaxTokens = maxTokensEdge ? connectedMaxTokens : resolveWorkflowNumber(
    node.data.contextCompressionMaxTokens,
    settingsValueDefinitions,
    settingsValues,
  );
  if (resolvedMaxTokens === undefined) {
    throw new Error(`${node.data.label}: Max Tokens must resolve to one number.`);
  }
  const maxTokens = validCompressionTokenLimit(resolvedMaxTokens);
  const currentTokens = textMetrics.measure(compressedInput).tokens;
  const compressionThreshold = Math.max(1, Math.floor(maxTokens * 0.9));
  const hardLimit = maxTokens * 2;
  if (currentTokens < compressionThreshold && !compressedPrefixChanged) {
    updateRuntimeNode(node.id, {
      preview: `Below compression threshold (~${currentTokens} / ${compressionThreshold} tokens)`,
      fullText: compressedInput,
      compressionRemainingText: remainingText,
      displayTokenBytesPerToken: estimatedTokenBytesPerToken,
      hasContextLimitConnection: !!maxTokensEdge,
      resolvedContextTokenLimit: maxTokens,
      ...(!cacheMatches
        ? { compressedText: undefined, compressionSourceText: undefined }
        : {}),
    });
    return compressedInput;
  }
  if (currentTokens > hardLimit) {
    throw new Error(
      `Context Compression input is too large (~${currentTokens} / ${maxTokens} tokens). ` +
      `Reduce the incoming context or raise Max Tokens; this node stops above 2x its limit.`,
    );
  }
  if (
    !postOutputRun &&
    node.data.runAfterRpOutput &&
    currentTokens < maxTokens &&
    !compressedPrefixChanged
  ) {
    updateRuntimeNode(node.id, {
      preview: `Will compress next turn (~${currentTokens} / ${maxTokens} tokens)`,
      fullText: compressedInput,
      compressionRemainingText: remainingText,
      displayTokenBytesPerToken: estimatedTokenBytesPerToken,
      hasContextLimitConnection: !!maxTokensEdge,
      resolvedContextTokenLimit: maxTokens,
    });
    return compressedInput;
  }

  const ratio = validCompressionRatio(node.data.contextCompressionRatio);
  const lengthWords = validCompressionLengthWords(node.data.contextCompressionLengthWords);
  const newPrefixStart = cacheMatches ? cachedPrefix.length : 0;
  const suffixToAbsorb = inputValue.slice(newPrefixStart);
  if (!compressedPrefixChanged && !suffixToAbsorb.trim()) {
    updateRuntimeNode(node.id, {
      preview: 'Compressed context is still above token limit',
      fullText: compressedInput,
      compressionRemainingText: remainingText,
      displayTokenBytesPerToken: estimatedTokenBytesPerToken,
      hasContextLimitConnection: !!maxTokensEdge,
      resolvedContextTokenLimit: maxTokens,
    });
    return compressedInput;
  }
  const rawCompressedPrefix = compressedPrefixChanged
    ? inputValue.slice(
        0,
        semanticPrefixEnd(inputValue, Math.min(cachedPrefix.length, inputValue.length)),
      )
    : currentTokens >= maxTokens
      ? (() => {
          if (!cacheMatches) {
            return inputValue.slice(0, prefixEndForTokenBudget(inputValue, maxTokens, textMetrics));
          }
          // The cached prefix is already summarized. Budget only the new text
          // next to the summary it is merged with; measuring from the start
          // of the raw input would cut inside the summarized prefix.
          const summaryTokens = textMetrics.measure(`EXISTING SUMMARY:\n${cachedSummary}`).tokens;
          const absorbEnd = prefixEndForTokenBudget(
            suffixToAbsorb,
            Math.max(1, maxTokens - summaryTokens),
            textMetrics,
          );
          return `${cachedPrefix}${suffixToAbsorb.slice(0, absorbEnd)}`;
        })()
    : (() => {
        const targetCharacter = Math.max(
          1,
          Math.floor(suffixToAbsorb.length * ratio / 100),
        );
        const splitAt = semanticPrefixEnd(suffixToAbsorb, targetCharacter);
        return `${cacheMatches ? cachedPrefix : ''}${suffixToAbsorb.slice(0, splitAt)}`;
      })();
  if (!rawCompressedPrefix.trim()) {
    updateRuntimeNode(node.id, {
      preview: 'No text to compress',
      fullText: inputValue,
      compressedText: undefined,
      compressionSourceText: undefined,
      compressionRemainingText: inputValue,
      displayTokenBytesPerToken: estimatedTokenBytesPerToken,
      hasContextLimitConnection: !!maxTokensEdge,
      resolvedContextTokenLimit: maxTokens,
    });
    return inputValue;
  }
  if (postOutputRun && !node.data.runAfterRpOutput) {
    blockPostOutput('Context Compression needs permission to call its LLM after RP output.');
  }
  const retainedSuffix = inputValue.slice(rawCompressedPrefix.length).trimStart();
  const textToCompress = [
    cacheMatches ? `EXISTING SUMMARY:\n${cachedSummary}` : '',
    compressedPrefixChanged ? rawCompressedPrefix.trim() : suffixToAbsorb
      .slice(0, rawCompressedPrefix.length - newPrefixStart)
      .trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
  updateRuntimeNode(node.id, { preview: 'Compressing context ...', llmCallStats: [] });
  const prompt = [
    fastTaskReasoningStart,
    '',
    compressedPrefixChanged
      ? 'Rebuild the roleplay context summary because previously summarized source text changed. Use only the corrected earlier text below and do not invent facts.'
      : cacheMatches
        ? 'Update the existing roleplay context summary with the newly absorbed earlier text below, without inventing facts.'
        : 'Summarize the earlier roleplay context below without inventing facts.',
    `Condense it to at most ${lengthWords} words.`,
    'Preserve character names, relationships, locations, commitments, important actions, and unresolved emotional or plot details.',
    'Return only the compact summary text, without a heading or commentary.',
    '',
    'CONTEXT TO SUMMARIZE:',
    textToCompress,
    '',
    fastTaskReasoningEnd,
  ].join('\n');
  const completion = await llm.complete({
    connectionId: node.data.connectionId,
    nodeId: node.id,
    label: 'Compress',
    prompt,
    fastTask: true,
  });
  const compressed = [
    '[Compressed earlier context]',
    completion.text.trim(),
    retainedSuffix,
  ]
    .filter(Boolean)
    .join('\n\n');
  const compressedTokens = textMetrics.measure(compressed).tokens;
  if (compressedTokens > maxTokens) {
    throw new Error(
      `Context Compression result is still too large (~${compressedTokens} / ${maxTokens} tokens). ` +
      'Raise Max Tokens, shorten the incoming context, or increase the compressed amount.',
    );
  }
  updateRuntimeNode(node.id, {
    preview: compressedPrefixChanged
      ? `Recompressed changed earlier context to <= ${lengthWords} words`
      : `Compressed earlier context to <= ${lengthWords} words`,
    fullText: compressed,
    compressedText: completion.text.trim(),
    compressionSourceText: rawCompressedPrefix,
    compressionRemainingText: retainedSuffix,
    displayTokenBytesPerToken: estimatedTokenBytesPerToken,
    hasContextLimitConnection: !!maxTokensEdge,
    resolvedContextTokenLimit: maxTokens,
  });
  return compressed;
}
