import type { WorkflowNode } from '../../types';
import { fastTaskReasoningStart, fastTaskReasoningEnd } from '../../llm/fastTaskPrompt';
import { llmDecisionEntries, llmDecisionOutputHandle } from '../../workflow';
import { llmDecisionMemo } from '../runScratch';
import { resolveTextAndImageInputs } from '../shared/imageInputs';
import type { ExecuteContext } from '../types';

type LlmDecisionResult = {
  bool: boolean;
  text: string;
  number: number;
};

function parseLooseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : undefined;
    } catch {
      return undefined;
    }
  }
}

function parseDecision(text: string): LlmDecisionResult | undefined {
  const parsed = parseLooseJsonObject(text);
  if (!parsed || typeof parsed.text !== 'string') return undefined;
  const bool = typeof parsed.bool === 'boolean' ? parsed.bool
    : parsed.bool === 1 ? true : parsed.bool === 0 ? false
    : typeof parsed.bool === 'string' ? new Map([['true', true], ['yes', true], ['1', true], ['false', false], ['no', false], ['0', false]]).get(parsed.bool.trim().toLowerCase())
    : undefined;
  const number = typeof parsed.number === 'number' ? parsed.number
    : typeof parsed.number === 'string' && parsed.number.trim() ? Number(parsed.number) : NaN;
  if (bool === undefined || !Number.isFinite(number)) return undefined;
  return { bool, text: parsed.text, number };
}

async function runLlmDecision(node: WorkflowNode, context: ExecuteContext) {
  const entries = llmDecisionEntries(node.data);
  const { inputValue, images } = await resolveTextAndImageInputs(node, context);
  context.updateRuntimeData(node.id, { preview: 'Calling LLM ...', llmCallStats: [] });

  const results = await Promise.all(entries.map(async (entry, index): Promise<LlmDecisionResult> => {
    const prompt = [
      fastTaskReasoningStart,
      'Analyze the input text and answer the question with JSON only.',
      'Return exactly this object shape: {"bool":true,"text":"short answer","number":0}',
      'Use bool for yes/no, text for the extracted answer, and number for a count or numeric result.',
      `Question: ${entry.question.trim() || 'Analyze the input.'}`,
      'Input text:',
      inputValue,
      fastTaskReasoningEnd,
    ].join('\n\n');
    // Prose instead of JSON must not pass silently as "false": retry once
    // when format retries are enabled, then report the fallback.
    const maxAttempts = context.retryFormatErrorsEnabled ? 2 : 1;
    let parsed: LlmDecisionResult | undefined;
    let responseText = '';
    for (let attempt = 1; attempt <= maxAttempts && !parsed; attempt += 1) {
      const output = await context.llm.complete({
        connectionId: node.data.connectionId,
        nodeId: node.id,
        label: `Decision ${index + 1}`,
        prompt,
        fastTask: true,
        images,
        contributesToTokenCalibration: true,
      });
      responseText = output.text;
      parsed = parseDecision(output.text);
      if (parsed) {
        context.reportFormatResult({
          name: `Decision ${index + 1} JSON`,
          status: 'ok',
          detail: attempt > 1 ? 'Decision response parsed after retry.' : 'Decision response parsed.',
        });
      }
    }
    if (!parsed) {
      context.reportFormatResult({
        name: `Decision ${index + 1} JSON`,
        status: 'error',
        detail: 'Decision response did not contain valid bool, text and number fields.',
        preview: responseText,
      });
      context.reportWarning(
        `${node.data.label}: Decision ${index + 1} returned an invalid decision; using false, empty text and 0.`,
      );
    }
    return parsed ?? { bool: false, text: '', number: 0 };
  }));

  context.updateRuntimeData(node.id, {
    preview: `Answered ${results.length} decision${results.length === 1 ? '' : 's'}`,
    llmDecisionBoolResults: results.map((result) => result.bool),
    llmDecisionTextResults: results.map((result) => result.text),
    llmDecisionNumberResults: results.map((result) => result.number),
    fullText: JSON.stringify(
      results.length === 1
        ? results[0]
        : results.map((result, index) => ({
            decision: index + 1,
            ...result,
          })),
      null,
      2,
    ),
    displayTokenBytesPerToken: context.textMetrics.bytesPerToken,
  });
  return results;
}

export async function executeLlmDecisionNode(node: WorkflowNode, context: ExecuteContext) {
  const entries = llmDecisionEntries(node.data);
  const selectedEntry =
    entries.find((entry) =>
      ['bool', 'text', 'number'].some((kind) =>
        llmDecisionOutputHandle(entry.index, kind as 'bool' | 'text' | 'number') === context.sourceHandle,
      ),
    ) ?? entries[0];
  const selectedKind =
    (['bool', 'text', 'number'] as const).find((kind) =>
      llmDecisionOutputHandle(selectedEntry.index, kind) === context.sourceHandle,
    ) ?? 'text';

  const memo = llmDecisionMemo(context);
  const resultsPromise = memo.get(node.id) ?? runLlmDecision(node, context);
  memo.set(node.id, resultsPromise);
  const results = await resultsPromise;
  const result = results[selectedEntry.index] ?? { bool: false, text: '', number: 0 };
  return String(result[selectedKind]);
}
