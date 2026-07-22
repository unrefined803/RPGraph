import {
  promptWithImageAttachmentMarkers,
  promptWithReferenceImageMarkers,
  referenceImageAttachments,
  type ReferenceImage,
} from '../../chat/referenceImages';
import type { ChatImageAttachment, WorkflowNode } from '../../types';
import {
  formatChatHistorySegments,
  type FormattedChatHistorySegment,
} from '../../workflow';
import {
  boundedHistoryLastTurnsCount,
  lastTurnMessages,
} from '../../data-management/historyStore';
import type { ExecuteContext } from '../types';
import {
  configForPromptActionToken,
  executePromptAction,
  knownPromptActionId,
  parsePromptActionCall,
  parsePromptActionRequest,
  parsePromptActionTokens,
  phoneImageCaptionPromptState,
  promptActionAfterReplyText,
  promptActionAvailable,
  promptActionInstructionText,
  promptActionKey,
  promptActionTokenText,
  replacePromptActionTokensWithInstructions,
  unwrapJsonCodeFence,
  type PromptActionConfig,
} from './promptActions';
import {
  configForPromptCommandToken,
  knownPromptCommandId,
  parsePromptCommandRequest,
  parsePromptCommandTokens,
  promptCommandIds,
  promptCommandPassInstruction,
  replacePromptCommandTokensWithHints,
  stripPromptCommandMarkers,
  type PromptCommandConfig,
  type PromptCommandId,
  type PromptCommandPassRequest,
} from './promptCommands';
import {
  buildPromptStepChain,
  injectStepOutput,
  rollPlanOutcomes,
  stepOutputTokenNames,
} from './promptSteps';
import { promptImagePass } from './promptImagePass';
import {
  storybookCreateImageCharactersFromNodes,
  storyCharactersFromNodes,
} from '../../storybook/runtime';
import {
  socialMessageCorrectionContext,
  validateSocialMessengerAccounts,
} from '../../chat/socialMessageValidation';
import { stripPlanBlocks, stripPlanBlocksFromStream } from '../../chat/messageFormats';
import { readableRuntimeName } from '../../llm/callDisplay';

export type PromptPreviewPart = {
  text: string;
  actionInserted?: boolean;
  stepOutputInserted?: string;
  historySegments?: FormattedChatHistorySegment[];
};

export type PromptPreviewPass = {
  label: string;
  prompt?: string;
  images?: Array<{
    index: number;
    id: string;
    name: string;
    source?: 'input' | 'action' | 'reference';
  }>;
  sections?: Array<{
    label: string;
    text: string;
    parts?: PromptPreviewPart[];
    historySegments?: FormattedChatHistorySegment[];
  }>;
};

export type PromptRunDebug = {
  inputValue: string;
  promptBefore: string;
  promptAfter: string;
  combinedPrompt: string;
  promptPasses?: PromptPreviewPass[];
  outputPasses?: Array<{ label: string; text: string }>;
  actionResults?: string[];
  generatedText: string;
};

function unknownPromptActionName(text: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapJsonCodeFence(text));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  const action = (parsed as Record<string, unknown>).action;
  return typeof action === 'string' && action.trim() ? action.trim() : undefined;
}

function normalizedSegmentText(text: string) {
  return text.trim().replace(/\r\n/g, '\n');
}

function matchingHistorySegments(
  segments: FormattedChatHistorySegment[],
  inputValue: string,
) {
  const normalizedInput = normalizedSegmentText(inputValue);
  if (!segments.length || !normalizedInput) {
    return undefined;
  }
  // Line endings are normalized once per segment; trimming stays on the
  // joined window so edge whitespace behaves exactly like normalizing the
  // window as a whole.
  const normalizedTexts = segments.map((segment) => segment.text.replace(/\r\n/g, '\n'));
  const fullText = normalizedTexts.join('\n\n').trim();
  if (fullText === normalizedInput) {
    return segments;
  }

  // cumulativeLengths[i] sums the trimmed lengths of the first i segments — a
  // lower bound for any window's final text length. Windows already longer
  // than the input can neither equal nor be contained in it, so they are
  // skipped without building their strings.
  const cumulativeLengths = [0];
  for (const text of normalizedTexts) {
    cumulativeLengths.push(cumulativeLengths[cumulativeLengths.length - 1] + text.trim().length);
  }
  let bestContainedMatch:
    | { segments: FormattedChatHistorySegment[]; textLength: number }
    | undefined;
  for (let start = 0; start < segments.length; start += 1) {
    for (let end = segments.length; end > start; end -= 1) {
      if (cumulativeLengths[end] - cumulativeLengths[start] > normalizedInput.length) {
        continue;
      }
      const candidateText = normalizedTexts.slice(start, end).join('\n\n').trim();
      if (candidateText === normalizedInput) {
        return segments.slice(start, end);
      }
      if (
        candidateText &&
        normalizedInput.includes(candidateText) &&
        (!bestContainedMatch || candidateText.length > bestContainedMatch.textLength)
      ) {
        bestContainedMatch = { segments: segments.slice(start, end), textLength: candidateText.length };
        break;
      }
    }
  }
  return bestContainedMatch?.segments;
}

function historySegmentsForInputValue(context: ExecuteContext, inputValue: string) {
  const historyNodes = context.nodes.filter(
    (candidate) => candidate.data.nodeType === 'history',
  );
  for (const historyNode of historyNodes) {
    const allOriginal = formatChatHistorySegments(
      context.historyMessages,
      false,
      context.rpDateTimeFormat,
      context.rpWeekdayLanguage,
    );
    const matchingAllOriginal = matchingHistorySegments(allOriginal, inputValue);
    if (matchingAllOriginal) {
      return matchingAllOriginal;
    }

    const allTranslated = formatChatHistorySegments(
      context.historyMessages,
      true,
      context.rpDateTimeFormat,
      context.rpWeekdayLanguage,
    );
    const matchingAllTranslated = matchingHistorySegments(allTranslated, inputValue);
    if (matchingAllTranslated) {
      return matchingAllTranslated;
    }

    const recentMessages = lastTurnMessages(
      context.historyMessages,
      boundedHistoryLastTurnsCount(historyNode.data.historyLastTurnsCount),
    );
    const recentOriginal = formatChatHistorySegments(
      recentMessages,
      false,
      context.rpDateTimeFormat,
      context.rpWeekdayLanguage,
      context.historyMessages,
    );
    const matchingRecentOriginal = matchingHistorySegments(recentOriginal, inputValue);
    if (matchingRecentOriginal) {
      return matchingRecentOriginal;
    }

    const recentTranslated = formatChatHistorySegments(
      recentMessages,
      true,
      context.rpDateTimeFormat,
      context.rpWeekdayLanguage,
      context.historyMessages,
    );
    const matchingRecentTranslated = matchingHistorySegments(recentTranslated, inputValue);
    if (matchingRecentTranslated) {
      return matchingRecentTranslated;
    }
  }
  return undefined;
}

export async function runActionAwarePrompt({
  node,
  context,
  inputValue,
  images,
  referenceImages,
  promptBefore: promptBeforeInput,
  promptAfter: promptAfterInput,
  actionConfigs,
  commandConfigs = [],
  streamsVisibleOutput,
  contributesToTokenCalibration,
  callLabel,
  random = Math.random,
}: {
  node: WorkflowNode;
  context: ExecuteContext;
  inputValue: string;
  images: ChatImageAttachment[];
  referenceImages: ReferenceImage[];
  promptBefore: string;
  promptAfter: string;
  actionConfigs: PromptActionConfig[];
  commandConfigs?: PromptCommandConfig[];
  streamsVisibleOutput: boolean;
  contributesToTokenCalibration: boolean;
  callLabel: (actionReplayCount: number) => string;
  random?: () => number;
}) {
  // @step: markers split a prompt into an ordered chain of named passes. Every
  // step before the last runs as an intermediate pass whose diced output is
  // injected into later steps at @output:<name> tokens (or prepended to the
  // next step without one); the last step produces the visible reply.
  const steps = buildPromptStepChain(promptBeforeInput, promptAfterInput);
  // @output tokens may only reference an earlier step; every other token is
  // removed here so unresolved markers never reach the LLM.
  steps.forEach((step, stepIndex) => {
    const earlierNames = steps.slice(0, stepIndex).map((earlier) => earlier.name);
    for (const field of ['before', 'after'] as const) {
      for (const name of stepOutputTokenNames(step[field])) {
        if (!earlierNames.includes(name)) {
          context.reportWarning(
            `${node.data.label}: @output:${name} has no earlier @step:${name} section; the marker was removed.`,
          );
          step[field] = injectStepOutput(step[field], name, '').text;
        }
      }
    }
  });
  const outputStep = steps[steps.length - 1];
  const intermediateSteps = steps.slice(0, -1);
  // Snapshot the authored prompt texts before earlier steps inject their
  // outputs; the missing-rolls warning must not trigger on "chance:" markers
  // that arrive via an injected plan.
  const authoredStepTexts = steps.map((step) => [step.before, step.after].join('\n'));
  let promptBefore = outputStep.before;
  let promptAfter = outputStep.after;
  const visionEnabled = await context.llm.supportsVision(
    node.data.connectionId,
    `${node.data.label} vision features`,
  );
  const usableReferenceImages = visionEnabled ? referenceImages : [];
  const referenceImageValues = visionEnabled
    ? referenceImageAttachments(usableReferenceImages)
    : [];
  const createImageCharacters = storybookCreateImageCharactersFromNodes(context.nodes);
  const actionAvailabilityOptions = {
    visionEnabled,
    hasImageInput: visionEnabled && images.length > 0,
    comfyProviderIds: context.comfyProviderIds,
    providerHealthById: context.providerHealthById,
    createImageCharacters,
  };
  const warnedUnknownCommandNames = new Set<string>();
  const warnUnknownCommandName = (name: string) => {
    if (!warnedUnknownCommandNames.has(name)) {
      warnedUnknownCommandNames.add(name);
      context.reportWarning(`${node.data.label}: Unknown prompt command @command:${name} was removed from the prompt.`);
    }
  };
  const availableCommandIds = Array.from(new Set(
    parsePromptCommandTokens([promptBeforeInput, promptAfterInput].join('\n'))
      .map((token) => knownPromptCommandId(token.name))
      .filter((commandId): commandId is PromptCommandId => !!commandId),
  ));
  const availableActionConfigs = parsePromptActionTokens([promptBeforeInput, promptAfterInput].join('\n'))
    .map((token) => configForPromptActionToken(actionConfigs, token.title));
  const uniqueAvailableActionConfigs = Array.from(
    new Map(
      availableActionConfigs
        .filter((action) => promptActionAvailable(action, actionAvailabilityOptions))
        .map((action) => [promptActionKey(action.title), action]),
    ).values(),
  );
  const preReplyActionConfigs = uniqueAvailableActionConfigs.filter((action) => !action.runAfterReply);
  const afterReplyActionConfigs = uniqueAvailableActionConfigs.filter((action) => action.runAfterReply);
  const actionResults = new Map<string, string>();
  const actionResultTexts: string[] = [];
  const actionImages: ChatImageAttachment[] = [];
  const finalOutputActionTexts: string[] = [];
  const outputPasses: Array<{ label: string; text: string }> = [];
  const promptPasses: PromptPreviewPass[] = [];
  const stepOutputInsertions = new Map<
    (typeof steps)[number],
    { before: Array<{ name: string; text: string }>; after: Array<{ name: string; text: string }> }
  >();
  const rememberStepOutputInsertion = (
    step: (typeof steps)[number],
    field: 'before' | 'after',
    name: string,
    text: string,
  ) => {
    const insertions = stepOutputInsertions.get(step) ?? { before: [], after: [] };
    insertions[field].push({ name, text });
    stepOutputInsertions.set(step, insertions);
  };
  const socialCharacters = storyCharactersFromNodes(context.nodes);
  let socialAccountCorrectionText = '';
  let socialAccountReplayUsed = false;
  const promptSectionValue = (value: string) =>
    replacePromptCommandTokensWithHints(
      replacePromptActionTokensWithInstructions(
        value.trim(),
        actionConfigs,
        actionResults,
        actionAvailabilityOptions,
      ),
      warnUnknownCommandName,
    );
  const promptSectionParts = (original: string, resolved: string): PromptPreviewPart[] => {
    const trimmedOriginal = original.trim();
    const tokens = parsePromptActionTokens(trimmedOriginal);
    if (!tokens.length || resolved === trimmedOriginal) {
      return [{ text: resolved }];
    }
    const plainPartText = (text: string) => replacePromptCommandTokensWithHints(text, warnUnknownCommandName);
    const resolvedParts: PromptPreviewPart[] = [];
    let cursor = 0;
    tokens.forEach((token) => {
      if (token.index > cursor) {
        resolvedParts.push({ text: plainPartText(trimmedOriginal.slice(cursor, token.index)) });
      }
      const config = configForPromptActionToken(actionConfigs, token.title);
      const actionText = promptActionTokenText(
        config,
        actionResults,
        actionAvailabilityOptions,
      );
      if (actionText) {
        resolvedParts.push({ text: actionText, actionInserted: true });
      }
      cursor = token.index + token.raw.length;
    });
    if (cursor < trimmedOriginal.length) {
      resolvedParts.push({ text: plainPartText(trimmedOriginal.slice(cursor)) });
    }
    return resolvedParts.length ? resolvedParts : [{ text: resolved }];
  };
  const markStepOutputParts = (
    parts: PromptPreviewPart[],
    insertions: Array<{ name: string; text: string }> | undefined,
  ) => (insertions ?? []).reduce((currentParts, insertion) => {
    let marked = false;
    return currentParts.flatMap((part): PromptPreviewPart[] => {
      if (marked || part.stepOutputInserted) return [part];
      const insertionIndex = part.text.indexOf(insertion.text);
      if (insertionIndex < 0) return [part];
      marked = true;
      const before = part.text.slice(0, insertionIndex);
      const after = part.text.slice(insertionIndex + insertion.text.length);
      return [
        ...(before ? [{ ...part, text: before }] : []),
        { text: insertion.text, stepOutputInserted: insertion.name },
        ...(after ? [{ ...part, text: after }] : []),
      ];
    });
  }, parts);
  const stepPromptSectionParts = (
    step: (typeof steps)[number],
    field: 'before' | 'after',
    original: string,
    resolved: string,
  ) => markStepOutputParts(
    promptSectionParts(original, resolved),
    stepOutputInsertions.get(step)?.[field],
  );
  // Matching the text input against the formatted chat history is quadratic
  // in the history length and the input repeats across passes, so each
  // distinct input text is resolved only once per run.
  const historySegmentsCache = new Map<string, FormattedChatHistorySegment[] | undefined>();
  const cachedHistorySegments = (textInput: string) => {
    if (!historySegmentsCache.has(textInput)) {
      historySegmentsCache.set(textInput, historySegmentsForInputValue(context, textInput));
    }
    return historySegmentsCache.get(textInput);
  };
  const buildPromptSections = (textInput = inputValue) => {
    const before = promptSectionValue(promptBefore);
    const after = promptSectionValue(promptAfter);
    const historySegments = cachedHistorySegments(textInput);
    return [
      {
        label: 'Prompt Before Input',
        text: before,
        parts: stepPromptSectionParts(outputStep, 'before', promptBefore, before),
      },
      {
        label: 'Text Input',
        text: textInput,
        parts: [{ text: textInput, historySegments }],
        historySegments,
      },
      ...(socialAccountCorrectionText
        ? [{
            label: 'Social Message Validation',
            text: socialAccountCorrectionText,
            parts: [{ text: socialAccountCorrectionText, actionInserted: true }],
          }]
        : []),
      {
        label: 'Prompt After Input',
        text: after,
        parts: stepPromptSectionParts(outputStep, 'after', promptAfter, after),
      },
    ];
  };
  const buildCombinedPrompt = (textInput = inputValue) => [
    promptSectionValue(promptBefore),
    textInput,
    socialAccountCorrectionText,
    promptSectionValue(promptAfter),
  ]
    .filter(Boolean)
    .join('\n\n');
  const imagePreviewItems = (
    values: Array<{ image: ChatImageAttachment; source?: 'input' | 'action' | 'reference' }>,
  ) =>
    values.map(({ image, source }, index) => ({
      index: index + 1,
      id: image.id,
      name: image.name,
      source,
    }));
  const currentImagePass = () => promptImagePass({
    actionReplay: actionImages.length > 0,
    actionImages,
    inputImages: visionEnabled ? images : [],
    referenceImages: referenceImageValues,
  });
  const textInputForImagePass = (
    text: string,
    imagePass: ReturnType<typeof promptImagePass>,
  ) => promptWithReferenceImageMarkers(
    promptWithImageAttachmentMarkers(text, imagePass.inputImages, imagePass.inputImageOffset),
    usableReferenceImages,
    imagePass.referenceImageOffset,
  );
  const previewImagesForPass = (imagePass: ReturnType<typeof promptImagePass>) =>
    imagePreviewItems([
      ...imagePass.actionImages.map((image) => ({ image, source: 'action' as const })),
      ...imagePass.inputImages.map((image) => ({ image, source: 'input' as const })),
      ...imagePass.referenceImages.map((image) => ({ image, source: 'reference' as const })),
    ]);

  // While a pre-reply action is still pending, the LLM may answer with either an
  // action call or the visible reply. Hold streamed chunks back until the output
  // clearly starts as prose; JSON/fenced starts stay hidden so action calls never
  // flash into the chat.
  // Private "[[plan]]" blocks and command requests — inline "[command_name:
  // plan]" markers or a final "[commands: ...]" line — are stripped from the
  // visible output later; remove completed blocks and markers from the stream
  // and hold back a trailing "[" while it still looks like the start of such a
  // marker so control text never flashes into the chat.
  const streamedCommandMarkerNames = ['command', 'commands', 'simulate_chatgpd', ...promptCommandIds];
  const holdTrailingCommandRequest = (value: string) => {
    const withoutPlanBlocks = stripPlanBlocksFromStream(value);
    if (!availableCommandIds.length) {
      return withoutPlanBlocks;
    }
    const visible = stripPromptCommandMarkers(withoutPlanBlocks);
    const openIndex = visible.lastIndexOf('[');
    if (openIndex < 0 || visible.slice(openIndex).includes(']')) {
      return visible;
    }
    const tail = visible.slice(openIndex + 1);
    const tailMatch = tail.match(/^\s*([A-Za-z0-9_]*)([\s\S]*)$/);
    const word = (tailMatch?.[1] ?? '').toLocaleLowerCase();
    const rest = tailMatch?.[2] ?? '';
    const looksLikeMarkerStart = rest
      ? /^\s*:/.test(rest) && streamedCommandMarkerNames.includes(word)
      : streamedCommandMarkerNames.some((name) => name.startsWith(word));
    if (looksLikeMarkerStart) {
      return visible.slice(0, openIndex).replace(/\s+$/, '');
    }
    return visible;
  };
  const streamVisible = context.streamOutput
    ? (value: string) => context.streamOutput?.(holdTrailingCommandRequest(value))
    : undefined;
  const streamUnlessActionCall = context.streamOutput
    ? (value: string) => {
        const trimmed = value.trimStart();
        if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('```') || '```'.startsWith(trimmed)) {
          return;
        }
        streamVisible?.(value);
      }
    : undefined;

  for (const [stepIndex, step] of intermediateSteps.entries()) {
    // An intermediate step can consume pre-reply actions itself (e.g. fetching
    // or creating a phone image the plan already knows it needs): an action
    // request in the step output runs the follow-up and the action, then the
    // step reruns with the action result inserted at its @action tokens. Later
    // passes see the same consumed results.
    let stepText = '';
    const actionCountAtStepStart = actionResultTexts.length;
    const maxStepPasses = Math.max(2, preReplyActionConfigs.length + 1);
    for (let stepPassIndex = 0; stepPassIndex <= maxStepPasses; stepPassIndex += 1) {
      const stepBefore = promptSectionValue(step.before);
      const stepAfter = promptSectionValue(step.after);
      const stepImagePass = currentImagePass();
      const stepTextInput = textInputForImagePass(inputValue, stepImagePass);
      const stepHistorySegments = cachedHistorySegments(stepTextInput);
      const stepReplayCount = actionResultTexts.length - actionCountAtStepStart;
      const passLabel = stepReplayCount
        ? `Step ${step.name} replay ${stepReplayCount}`
        : `Step ${step.name}`;
      promptPasses.push({
        label: passLabel,
        images: previewImagesForPass(stepImagePass),
        sections: [
          ...(stepBefore
            ? [{
                label: 'Step Prompt Before Input',
                text: stepBefore,
                parts: stepPromptSectionParts(step, 'before', step.before, stepBefore),
              }]
            : []),
          {
            label: 'Text Input',
            text: stepTextInput,
            parts: [{ text: stepTextInput, historySegments: stepHistorySegments }],
            historySegments: stepHistorySegments,
          },
          ...(stepAfter
            ? [{
                label: 'Step Prompt After Input',
                text: stepAfter,
                parts: stepPromptSectionParts(step, 'after', step.after, stepAfter),
              }]
            : []),
        ],
      });
      context.updateRuntimeData(node.id, {
        preview: stepReplayCount
          ? `Step ${step.name} with action result ...`
          : `Running step ${step.name} ...`,
      });
      const stepOutput = await context.llm.complete({
        connectionId: node.data.connectionId,
        nodeId: node.id,
        label: `${callLabel(0)} / ${passLabel}`,
        stage: { kind: 'step', name: step.name, replay: stepReplayCount || undefined },
        prompt: [stepBefore, stepTextInput, stepAfter].filter(Boolean).join('\n\n'),
        images: stepImagePass.images,
        contributesToTokenCalibration,
        useConnectionSampling: true,
      });
      outputPasses.push({ label: `${passLabel} output`, text: stepOutput.text });
      const actionRequest = parsePromptActionRequest(stepOutput.text);
      if (!actionRequest) {
        stepText = stepOutput.text;
        break;
      }
      const actionConfig = preReplyActionConfigs.find(
        (candidate) =>
          candidate.actionId === actionRequest.action &&
          !actionResults.has(promptActionKey(candidate.title)),
      );
      if (!actionConfig) {
        context.reportWarning(
          `${node.data.label}: Step ${step.name} requested unavailable or already-consumed action ${actionRequest.action}.`,
        );
        break;
      }
      if (stepPassIndex === maxStepPasses) {
        context.reportWarning(`${node.data.label}: Step ${step.name} action replay limit reached.`);
        break;
      }
      const followUpInstruction = promptActionInstructionText(
        actionConfig,
        actionAvailabilityOptions,
        actionRequest.plan,
        stepImagePass.inputImageOffset + 1,
      );
      promptPasses.push({
        label: `Step ${step.name} action follow-up: ${actionConfig.title}`,
        images: previewImagesForPass(stepImagePass),
        sections: [
          ...(stepBefore
            ? [{
                label: 'Step Prompt Before Input',
                text: stepBefore,
                parts: stepPromptSectionParts(step, 'before', step.before, stepBefore),
              }]
            : []),
          {
            label: 'Text Input',
            text: stepTextInput,
            parts: [{ text: stepTextInput, historySegments: stepHistorySegments }],
            historySegments: stepHistorySegments,
          },
          {
            label: 'Step Action Follow-Up',
            text: followUpInstruction,
            parts: [{ text: followUpInstruction, actionInserted: true }],
          },
        ],
      });
      context.updateRuntimeData(node.id, {
        preview: `Action ${actionRequest.action} requested in step ${step.name}; preparing it from the plan ...`,
      });
      const followUpOutput = await context.llm.complete({
        connectionId: node.data.connectionId,
        nodeId: node.id,
        label: `${callLabel(0)} / Step ${step.name} action follow-up: ${actionConfig.title}`,
        stage: { kind: 'action', name: actionConfig.title },
        prompt: [stepBefore, stepTextInput, followUpInstruction].filter(Boolean).join('\n\n'),
        images: stepImagePass.images,
        contributesToTokenCalibration,
        useConnectionSampling: true,
      });
      outputPasses.push({
        label: `Step ${step.name} action follow-up output: ${actionConfig.title}`,
        text: followUpOutput.text,
      });
      const actionCall = parsePromptActionCall(followUpOutput.text);
      if (!actionCall || actionCall.action !== actionConfig.actionId) {
        context.reportWarning(
          `${node.data.label}: Step ${step.name} action follow-up for ${actionConfig.title} returned no valid action call.`,
        );
        break;
      }
      const actionResult = await executePromptAction(context, actionConfig, actionCall, {
        ...actionAvailabilityOptions,
        llmConnectionId: node.data.connectionId,
        llmNodeId: node.id,
      });
      actionResults.set(promptActionKey(actionConfig.title), actionResult.text);
      actionResultTexts.push(actionResult.text);
      actionImages.push(...actionResult.images);
      if (actionResult.finalOutputText) {
        finalOutputActionTexts.push(actionResult.finalOutputText);
      }
      context.updateRuntimeData(node.id, {
        preview: `Action ${actionCall.action} resolved; rerunning step ${step.name} ...`,
      });
    }
    const rolledOutput = rollPlanOutcomes(stepText, random);
    const stepOutputText = rolledOutput.text.trim();
    const laterSteps = steps.slice(stepIndex + 1);
    if (stepOutputText) {
      // A missing-rolls warning only makes sense for plan-style steps; a
      // prompt that never mentions "chance:" gets its output passed on
      // verbatim.
      if (!rolledOutput.rolls.length && /chance:/i.test(authoredStepTexts[stepIndex])) {
        context.reportWarning(
          `${node.data.label}: Step ${step.name} output contains no (chance: NN%) markers; it is passed on without dice rolls.`,
        );
      }
      let injected = false;
      for (const laterStep of laterSteps) {
        const beforeInjection = injectStepOutput(laterStep.before, step.name, stepOutputText);
        const afterInjection = injectStepOutput(laterStep.after, step.name, stepOutputText);
        laterStep.before = beforeInjection.text;
        laterStep.after = afterInjection.text;
        if (beforeInjection.injected) {
          rememberStepOutputInsertion(laterStep, 'before', step.name, stepOutputText);
        }
        if (afterInjection.injected) {
          rememberStepOutputInsertion(laterStep, 'after', step.name, stepOutputText);
        }
        injected = injected || beforeInjection.injected || afterInjection.injected;
      }
      if (!injected) {
        const nextStep = laterSteps[0];
        nextStep.before = [stepOutputText, nextStep.before].filter(Boolean).join('\n\n');
        rememberStepOutputInsertion(nextStep, 'before', step.name, stepOutputText);
      }
    } else {
      context.reportWarning(
        `${node.data.label}: Step ${step.name} returned no output; continuing without it.`,
      );
      for (const laterStep of laterSteps) {
        laterStep.before = injectStepOutput(laterStep.before, step.name, '').text;
        laterStep.after = injectStepOutput(laterStep.after, step.name, '').text;
      }
    }
  }
  promptBefore = outputStep.before;
  promptAfter = outputStep.after;

  let generatedText = '';
  let connectionLabel = '';
  const maxActionPasses = Math.max(3, preReplyActionConfigs.length + 1);
  for (let passIndex = 0; passIndex <= maxActionPasses; passIndex += 1) {
    const pendingPreReplyAction = preReplyActionConfigs.some(
      (action) => !actionResults.has(promptActionKey(action.title)),
    );
    const actionReplayCount = actionResultTexts.length;
    const actionReplay = actionReplayCount > 0;
    const outputStepLabel = outputStep.name ? `Step ${outputStep.name}` : '';
    const passLabel = outputStepLabel
      ? `${outputStepLabel}${actionReplay ? ` replay ${actionReplayCount}` : ''}`
      : actionReplay
        ? `Action replay ${actionReplayCount}`
        : 'Initial action prompt';
    const imagePass = currentImagePass();
    const textInputForPass = textInputForImagePass(inputValue, imagePass);
    const promptForPass = buildCombinedPrompt(textInputForPass);
    promptPasses.push({
      label: passLabel,
      images: previewImagesForPass(imagePass),
      sections: buildPromptSections(textInputForPass),
    });
    let output = await context.llm.complete({
      connectionId: node.data.connectionId,
      nodeId: node.id,
      // A named output step carries its name into the call label so the run
      // progress shows e.g. "Step: Translation" instead of the generic main.
      label: outputStep.name
        ? `${callLabel(actionReplayCount)} / Step ${outputStep.name}`
        : callLabel(actionReplayCount),
      stage: {
        kind: 'step',
        name: outputStep.name || 'main',
        replay: actionReplayCount || undefined,
      },
      prompt: promptForPass,
      images: imagePass.images,
      onChunk: streamsVisibleOutput
        ? (pendingPreReplyAction ? streamUnlessActionCall : streamVisible)
        : undefined,
      contributesToTokenCalibration,
      useConnectionSampling: true,
    });
    outputPasses.push({
      label: outputStepLabel
        ? `${passLabel} output`
        : actionReplay
          ? `Action replay ${actionReplayCount} output`
          : 'Initial action output',
      text: output.text,
    });
    let socialAccountValidation = validateSocialMessengerAccounts({
      text: output.text,
      characters: socialCharacters,
      messages: context.historyMessages,
    });
    if (
      socialAccountValidation.issues.length > 0 &&
      context.retryFormatErrorsEnabled &&
      !socialAccountReplayUsed
    ) {
      socialAccountReplayUsed = true;
      socialAccountCorrectionText = socialMessageCorrectionContext(
        socialAccountValidation.issues,
      );
      const correctedPrompt = buildCombinedPrompt(textInputForPass);
      promptPasses.push({
        label: 'Social account correction replay',
        images: imagePreviewItems([
          ...imagePass.actionImages.map((image) => ({ image, source: 'action' as const })),
          ...imagePass.inputImages.map((image) => ({ image, source: 'input' as const })),
          ...imagePass.referenceImages.map((image) => ({ image, source: 'reference' as const })),
        ]),
        sections: buildPromptSections(textInputForPass),
      });
      context.updateRuntimeData(node.id, {
        preview: 'Invalid social account blocked; replaying prompt with account context ...',
      });
      context.streamOutput?.('');
      output = await context.llm.complete({
        connectionId: node.data.connectionId,
        nodeId: node.id,
        label: `${callLabel(actionReplayCount)} / Social account correction`,
        stage: { kind: 'correction', name: 'Social account' },
        prompt: correctedPrompt,
        images: imagePass.images,
        onChunk: streamsVisibleOutput
          ? (pendingPreReplyAction ? streamUnlessActionCall : streamVisible)
          : undefined,
        contributesToTokenCalibration,
        useConnectionSampling: true,
      });
      outputPasses.push({ label: 'Social account correction output', text: output.text });
      socialAccountValidation = validateSocialMessengerAccounts({
        text: output.text,
        characters: socialCharacters,
        messages: context.historyMessages,
      });
      if (socialAccountValidation.issues.length === 0) {
        context.reportFormatResult({
          name: 'Social messenger accounts',
          status: 'ok',
          detail: 'Invalid social account was corrected before delivery.',
        });
      }
    }
    if (socialAccountValidation.issues.length > 0) {
      const reasons = socialAccountValidation.issues
        .map((issue) => issue.resolved.reason)
        .filter((reason): reason is string => !!reason);
      const detail = Array.from(new Set(reasons)).join(' ');
      context.reportWarning(
        `${node.data.label}: Blocked generated social message. ${detail}`,
      );
      context.reportFormatResult({
        name: 'Social messenger accounts',
        status: 'error',
        detail,
        preview: output.text,
      });
      output = { ...output, text: socialAccountValidation.sanitizedText };
    }
    generatedText = output.text;
    connectionLabel = output.connection.label;
    let actionRequest = parsePromptActionRequest(output.text);
    if (!actionRequest) {
      // Models sometimes request an image action through the command syntax
      // ("[commands: create_image]") instead of the action JSON. Recover by
      // treating it as an action request; the drafted reply becomes the plan
      // and is rewritten in the replay pass with the action result available.
      const commandStyleRequest = parsePromptCommandRequest(
        output.text,
        (name) => !!knownPromptCommandId(name) || !!knownPromptActionId(name),
      );
      const requestedAction = commandStyleRequest?.requests
        .map((request) => ({ plan: request.plan, actionId: knownPromptActionId(request.name) }))
        .find((entry): entry is { plan: string; actionId: 'getImageId' | 'createImage' } =>
          (entry.actionId === 'getImageId' || entry.actionId === 'createImage') &&
          preReplyActionConfigs.some(
            (candidate) =>
              candidate.actionId === entry.actionId &&
              !actionResults.has(promptActionKey(candidate.title)),
          ),
        );
      if (commandStyleRequest && requestedAction) {
        actionRequest = {
          action: requestedAction.actionId,
          plan: [
            requestedAction.plan,
            commandStyleRequest.reply
              ? `Draft reply from the first pass (it is discarded and rewritten once the action result is available):\n${commandStyleRequest.reply}`
              : '',
          ].filter(Boolean).join('\n\n'),
        };
      }
    }
    let actionCall: ReturnType<typeof parsePromptActionCall>;
    let actionConfig: PromptActionConfig | undefined;
    if (actionRequest) {
      actionConfig = preReplyActionConfigs.find(
        (candidate) =>
          candidate.actionId === actionRequest.action &&
          !actionResults.has(promptActionKey(candidate.title)),
      );
      if (!actionConfig) {
        context.reportWarning(
          `${node.data.label}: LLM requested unavailable or already-consumed action ${actionRequest.action}.`,
        );
        generatedText = '';
        break;
      }

      const followUpImagePass = currentImagePass();
      const followUpInstruction = promptActionInstructionText(
        actionConfig,
        actionAvailabilityOptions,
        actionRequest.plan,
        followUpImagePass.inputImageOffset + 1,
      );
      const followUpTextInput = textInputForImagePass(inputValue, followUpImagePass);
      const promptBeforeForFollowUp = promptSectionValue(promptBefore);
      const followUpHistorySegments = cachedHistorySegments(followUpTextInput);
      promptPasses.push({
        label: `Action follow-up: ${actionConfig.title}`,
        images: previewImagesForPass(followUpImagePass),
        sections: [
          {
            label: 'Prompt Before Input',
            text: promptBeforeForFollowUp,
            parts: stepPromptSectionParts(
              outputStep,
              'before',
              promptBefore,
              promptBeforeForFollowUp,
            ),
          },
          {
            label: 'Text Input',
            text: followUpTextInput,
            parts: [{
              text: followUpTextInput,
              historySegments: followUpHistorySegments,
            }],
            historySegments: followUpHistorySegments,
          },
          {
            label: 'Prompt After Input (Action Follow-Up)',
            text: followUpInstruction,
            parts: [{ text: followUpInstruction, actionInserted: true }],
          },
        ],
      });
      context.updateRuntimeData(node.id, {
        preview: `Action ${actionRequest.action} requested; preparing it from the plan ...`,
      });
      const followUpOutput = await context.llm.complete({
        connectionId: node.data.connectionId,
        nodeId: node.id,
        label: `${callLabel(actionReplayCount)} / Action follow-up: ${actionConfig.title}`,
        stage: { kind: 'action', name: actionConfig.title },
        prompt: [promptBeforeForFollowUp, followUpTextInput, followUpInstruction]
          .filter(Boolean)
          .join('\n\n'),
        images: followUpImagePass.images,
        contributesToTokenCalibration,
        useConnectionSampling: true,
      });
      outputPasses.push({
        label: `Action follow-up output: ${actionConfig.title}`,
        text: followUpOutput.text,
      });
      actionCall = parsePromptActionCall(followUpOutput.text);
      if (!actionCall || actionCall.action !== actionConfig.actionId) {
        context.reportWarning(
          `${node.data.label}: Action follow-up for ${actionConfig.title} returned no valid action call.`,
        );
        generatedText = '';
        break;
      }
    } else {
      actionCall = parsePromptActionCall(output.text);
    }
    if (!actionCall) {
      const unknownAction = unknownPromptActionName(output.text);
      if (unknownAction) {
        context.reportWarning(knownPromptActionId(unknownAction)
          ? `${node.data.label}: LLM returned an incomplete or invalid ${unknownAction} action call.`
          : `${node.data.label}: LLM requested unsupported prompt action ${unknownAction}.`);
        generatedText = '';
      }
      break;
    }
    const matchesPendingCall = (candidate: PromptActionConfig) =>
      candidate.actionId === actionCall.action &&
      !actionResults.has(promptActionKey(candidate.title));
    actionConfig ??= afterReplyActionConfigs.find(matchesPendingCall);
    if (!actionConfig) {
      const pendingPreReplyConfig = preReplyActionConfigs.find(matchesPendingCall);
      context.reportWarning(pendingPreReplyConfig
        ? `${node.data.label}: LLM must request action ${actionCall.action} with a first-pass plan before executing it.`
        : `${node.data.label}: LLM requested unavailable or already-consumed action ${actionCall.action}.`);
      generatedText = '';
      break;
    }
    const actionKey = promptActionKey(actionConfig.title);
    const actionResult = await executePromptAction(context, actionConfig, actionCall, {
      ...actionAvailabilityOptions,
      llmConnectionId: node.data.connectionId,
      llmNodeId: node.id,
    });
    actionResults.set(actionKey, actionResult.text);
    actionResultTexts.push(actionResult.text);
    actionImages.push(...actionResult.images);
    if (actionResult.finalOutputText) {
      finalOutputActionTexts.push(actionResult.finalOutputText);
    }
    context.updateRuntimeData(node.id, {
      preview: `Action ${actionCall.action} resolved; replaying prompt ...`,
    });
    if (passIndex === maxActionPasses) {
      context.reportWarning(`${node.data.label}: Prompt action replay limit reached.`);
      generatedText = '';
      break;
    }
  }
  let visibleReply = generatedText.trim();
  let commandOutputText = '';
  const commandRequest = availableCommandIds.length
    ? parsePromptCommandRequest(visibleReply)
    : undefined;
  if (commandRequest) {
    visibleReply = commandRequest.reply;
    const requestedEntries = commandRequest.requests.flatMap((request) => {
      const commandId = knownPromptCommandId(request.name);
      if (!commandId || !availableCommandIds.includes(commandId)) {
        context.reportWarning(`${node.data.label}: LLM requested unavailable command ${request.name}.`);
        return [];
      }
      return [{ commandId, plan: request.plan }];
    });
    const uniqueRequests = Array.from(
      requestedEntries.reduce((byId, entry) => {
        const existing = byId.get(entry.commandId);
        return byId.set(entry.commandId, {
          config: configForPromptCommandToken(commandConfigs, entry.commandId),
          plan: [existing?.plan, entry.plan].filter(Boolean).join('\n'),
        });
      }, new Map<PromptCommandId, PromptCommandPassRequest>()).values(),
    );
    if (uniqueRequests.length && visibleReply) {
      const commandNames = uniqueRequests
        .map((request) => readableRuntimeName(request.config.commandId))
        .join(', ');
      const instruction = promptCommandPassInstruction(visibleReply, uniqueRequests, actionResultTexts);
      const commandImagePass = currentImagePass();
      const commandTextInput = textInputForImagePass(inputValue, commandImagePass);
      // The command pass prompts still see the full reply including [[plan]]
      // blocks; everything streamed to the chat hides them.
      const streamedVisibleReply = stripPlanBlocks(visibleReply);
      const streamCommandOutput = streamsVisibleOutput && context.streamOutput
        ? (value: string) => {
            const trimmed = value.trimStart();
            const couldBeJson =
              trimmed.startsWith('{') ||
              trimmed.startsWith('[') ||
              trimmed.startsWith('```') ||
              '```'.startsWith(trimmed);
            if (trimmed && couldBeJson) {
              context.streamOutput?.([streamedVisibleReply, value].filter(Boolean).join('\n'));
            }
          }
        : undefined;
      const historySegments = cachedHistorySegments(commandTextInput);
      promptPasses.push({
        label: `Command: ${commandNames}`,
        images: previewImagesForPass(commandImagePass),
        sections: [
          {
            label: 'Text Input',
            text: commandTextInput,
            parts: [{ text: commandTextInput, historySegments }],
            historySegments,
          },
          {
            label: 'Command Pass Prompt',
            text: instruction,
            parts: [{ text: instruction, actionInserted: true }],
          },
        ],
      });
      context.updateRuntimeData(node.id, {
        preview: `Running commands ${commandNames} ...`,
      });
      let output = await context.llm.complete({
        connectionId: node.data.connectionId,
        nodeId: node.id,
        label: `${callLabel(0)} / Command: ${commandNames}`,
        stage: { kind: 'command', name: commandNames },
        prompt: [commandTextInput, instruction].filter(Boolean).join('\n\n'),
        images: commandImagePass.images,
        onChunk: streamCommandOutput,
        contributesToTokenCalibration,
        useConnectionSampling: true,
      });
      outputPasses.push({ label: `Command output: ${commandNames}`, text: output.text });
      let commandSocialValidation = validateSocialMessengerAccounts({
        text: output.text,
        characters: socialCharacters,
        messages: context.historyMessages,
      });
      if (commandSocialValidation.issues.length > 0 && context.retryFormatErrorsEnabled) {
        const correction = socialMessageCorrectionContext(commandSocialValidation.issues);
        promptPasses.push({
          label: `Command correction: ${commandNames}`,
          images: previewImagesForPass(commandImagePass),
          sections: [
            {
              label: 'Text Input',
              text: commandTextInput,
              parts: [{ text: commandTextInput, historySegments }],
              historySegments,
            },
            {
              label: 'Social Message Validation',
              text: correction,
              parts: [{ text: correction, actionInserted: true }],
            },
            {
              label: 'Command Pass Prompt',
              text: instruction,
              parts: [{ text: instruction, actionInserted: true }],
            },
          ],
        });
        context.updateRuntimeData(node.id, {
          preview: 'Invalid command social account blocked; replaying command pass ...',
        });
        if (streamsVisibleOutput) {
          context.streamOutput?.(streamedVisibleReply);
        }
        output = await context.llm.complete({
          connectionId: node.data.connectionId,
          nodeId: node.id,
          label: `${callLabel(0)} / Command: ${commandNames} / Correction`,
          stage: { kind: 'command', name: commandNames, correction: true },
          prompt: [commandTextInput, correction, instruction].filter(Boolean).join('\n\n'),
          images: commandImagePass.images,
          onChunk: streamCommandOutput,
          contributesToTokenCalibration,
          useConnectionSampling: true,
        });
        outputPasses.push({
          label: `Command correction output: ${commandNames}`,
          text: output.text,
        });
        commandSocialValidation = validateSocialMessengerAccounts({
          text: output.text,
          characters: socialCharacters,
          messages: context.historyMessages,
        });
        if (commandSocialValidation.issues.length === 0) {
          context.reportFormatResult({
            name: 'Social messenger accounts',
            status: 'ok',
            detail: 'Invalid command social account was corrected before delivery.',
          });
        }
      }
      if (commandSocialValidation.issues.length > 0) {
        const reasons = commandSocialValidation.issues
          .map((issue) => issue.resolved.reason)
          .filter((reason): reason is string => !!reason);
        const detail = Array.from(new Set(reasons)).join(' ');
        context.reportWarning(
          `${node.data.label}: Blocked generated command social message. ${detail}`,
        );
        context.reportFormatResult({
          name: 'Social messenger accounts',
          status: 'error',
          detail,
          preview: output.text,
        });
        output = { ...output, text: commandSocialValidation.sanitizedText };
      }
      const commandJson = unwrapJsonCodeFence(output.text).trim();
      if (commandJson.startsWith('{') || commandJson.startsWith('[')) {
        commandOutputText = commandJson;
        if (streamsVisibleOutput) {
          context.streamOutput?.([streamedVisibleReply, commandOutputText].filter(Boolean).join('\n'));
        }
      } else {
        if (streamsVisibleOutput) {
          context.streamOutput?.(streamedVisibleReply);
        }
        context.reportWarning(
          `${node.data.label}: Command pass for ${commandNames} returned no JSON output.`,
        );
      }
    }
  }
  for (const actionConfig of afterReplyActionConfigs) {
    if (!visibleReply) {
      break;
    }
    const actionKey = promptActionKey(actionConfig.title);
    if (actionResults.has(actionKey)) {
      continue;
    }
    const afterReplyImagePass = currentImagePass();
    const promptBeforeForPass = promptSectionValue(promptBefore);
    const textInputForPass = textInputForImagePass(inputValue, afterReplyImagePass);
    const captionState = actionConfig.actionId === 'updatePhoneImageCaption'
      ? phoneImageCaptionPromptState(
          context.nodes,
          afterReplyImagePass.inputImages[0],
          textInputForPass,
        )
      : undefined;
    const instruction = promptActionAfterReplyText(
      actionConfig,
      visibleReply,
      captionState,
      afterReplyImagePass.inputImageOffset + 1,
    );
    const passLabel = `After-reply action: ${actionConfig.title}`;
    const historySegments = cachedHistorySegments(textInputForPass);
    promptPasses.push({
      label: passLabel,
      images: previewImagesForPass(afterReplyImagePass),
      sections: [
        {
          label: 'Prompt Before Input',
          text: promptBeforeForPass,
          parts: stepPromptSectionParts(
            outputStep,
            'before',
            promptBefore,
            promptBeforeForPass,
          ),
        },
        {
          label: 'Text Input',
          text: textInputForPass,
          parts: [{ text: textInputForPass, historySegments }],
          historySegments,
        },
        {
          label: 'After-Reply Action Prompt',
          text: instruction,
          parts: [{ text: instruction, actionInserted: true }],
        },
      ],
    });
    context.updateRuntimeData(node.id, {
      preview: `After-reply action ${actionConfig.title} ...`,
    });
    let output = await context.llm.complete({
      connectionId: node.data.connectionId,
      nodeId: node.id,
      label: `${callLabel(0)} / After-reply action: ${actionConfig.title}`,
      stage: { kind: 'action', name: actionConfig.title },
      prompt: [promptBeforeForPass, textInputForPass, instruction].filter(Boolean).join('\n\n'),
      images: afterReplyImagePass.images,
      contributesToTokenCalibration,
      useConnectionSampling: true,
    });
    outputPasses.push({ label: `${passLabel} output`, text: output.text });
    let actionCall = parsePromptActionCall(output.text);
    const captionCallMatchesRequiredState = () => {
      if (!captionState || !actionCall || actionCall.action !== 'updatePhoneImageCaption') {
        return !captionState;
      }
      const imageAction = actionCall.imageAction;
      const imageId = actionCall.imageId?.trim() ?? '';
      if (captionState.requiredImageAction === 'create') {
        return imageAction === 'create' && imageId === 'new_image' && !!actionCall.caption;
      }
      if (imageId !== captionState.imageId) {
        return false;
      }
      if (captionState.requiredImageAction === 'update') {
        return imageAction === 'update' && !!actionCall.caption;
      }
      return imageAction === 'no_change' || (imageAction === 'update' && !!actionCall.caption);
    };
    if (
      (!actionCall || actionCall.action !== actionConfig.actionId || !captionCallMatchesRequiredState()) &&
      (actionConfig.actionId === 'updatePhoneImageCaption' || actionConfig.actionId === 'describeInputImage')
    ) {
      const requiredImageId = captionState?.imageId || 'new_image';
      const requiredImageAction = captionState?.requiredImageAction === 'no_change_or_update'
        ? 'no_change, or update only when explicit new context materially changes the existing caption'
        : captionState?.requiredImageAction ?? 'create';
      const correctionInstruction = actionConfig.actionId === 'describeInputImage'
        ? [
            'Your previous internal image caption JSON was invalid:',
            output.text.trim() || '(empty output)',
            '',
            'Return exactly one corrected JSON object and nothing else:',
            '',
            '{',
            '"action": "describe_input_image",',
            '"caption": "20 to 30 word RP scene snapshot"',
            '}',
          ].join('\n')
        : [
            'Your previous internal phone image caption JSON was invalid:',
            output.text.trim() || '(empty output)',
            '',
            `RPGraph requires imageId "${requiredImageId}" and imageAction ${requiredImageAction}.`,
            'Return exactly one corrected JSON object and nothing else.',
            captionState?.requiredImageAction === 'update'
              ? 'The current caption is missing. Use imageAction "update" and include a 20 to 30 word caption.'
              : captionState?.requiredImageAction === 'create'
                ? 'Use imageAction "create" with imageId "new_image" and include a 20 to 30 word caption.'
                : `The current caption is: ${captionState?.currentCaption ?? '(none)'}`,
          ].join('\n');
      const correctionLabel = `${passLabel} correction`;
      promptPasses.push({
        label: correctionLabel,
        images: previewImagesForPass(afterReplyImagePass),
        sections: [
          {
            label: 'Correction Prompt',
            text: correctionInstruction,
            parts: [{ text: correctionInstruction, actionInserted: true }],
          },
        ],
      });
      context.updateRuntimeData(node.id, {
        preview: `Correcting after-reply action ${actionConfig.title} ...`,
      });
      output = await context.llm.complete({
        connectionId: node.data.connectionId,
        nodeId: node.id,
        label: `${callLabel(0)} / After-reply action correction: ${actionConfig.title}`,
        stage: { kind: 'action', name: actionConfig.title, correction: true },
        prompt: [
          promptBeforeForPass,
          textInputForPass,
          instruction,
          correctionInstruction,
        ].filter(Boolean).join('\n\n'),
        images: afterReplyImagePass.images,
        contributesToTokenCalibration,
        useConnectionSampling: true,
      });
      outputPasses.push({ label: `${correctionLabel} output`, text: output.text });
      actionCall = parsePromptActionCall(output.text);
    }
    if (!actionCall || actionCall.action !== actionConfig.actionId || !captionCallMatchesRequiredState()) {
      context.reportWarning(
        `${node.data.label}: After-reply action ${actionConfig.title} returned no valid action call.`,
      );
      continue;
    }
    const actionResult = await executePromptAction(context, actionConfig, actionCall, {
      ...actionAvailabilityOptions,
      llmConnectionId: node.data.connectionId,
      llmNodeId: node.id,
    });
    const recordedResult = actionResult.finalOutputText
      ? `After-reply action ${actionConfig.title} recorded:\n\n${actionResult.finalOutputText}`
      : actionResult.text;
    actionResults.set(actionKey, recordedResult);
    actionResultTexts.push(recordedResult);
    if (actionResult.finalOutputText) {
      finalOutputActionTexts.push(actionResult.finalOutputText);
    }
  }
  // [[plan]] blocks stay in visibleReply until here so the command and
  // after-reply passes see the full plan; only the returned output hides them.
  const visibleReplyForOutput = stripPlanBlocks(visibleReply);
  generatedText = commandRequest
    ? [visibleReplyForOutput, commandOutputText].filter(Boolean).join('\n')
    : visibleReplyForOutput;
  if (generatedText.trim() && finalOutputActionTexts.length) {
    generatedText = [
      generatedText.trim(),
      ...finalOutputActionTexts.map((entry) => entry.trim()).filter(Boolean),
    ].join('\n');
  }
  return {
    generatedText,
    connectionLabel,
    referenceImageCount: usableReferenceImages.length,
    debug: {
      inputValue,
      promptBefore,
      promptAfter,
      // The pass loop always records at least one prompt pass, so the
      // flat combined prompt is never needed as a fallback here.
      combinedPrompt: '',
      promptPasses,
      outputPasses,
      actionResults: actionResultTexts,
      generatedText,
    } satisfies PromptRunDebug,
  };
}
