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
  injectPlanOutput,
  planContextBlock,
  planOutputTokenPattern,
  planPassInstructionText,
  rollPlanOutcomes,
  splitPromptStepSections,
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

export type PromptPreviewPart = {
  text: string;
  actionInserted?: boolean;
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
  // Step markers split a prompt into a Step 1 planning prompt and the Step 2
  // main prompt. With a Step 1 section present, a planning pass runs first,
  // its bullet probabilities are diced, and the rolled plan is injected into
  // the main prompt (at @plan:output tokens, or prepended without one).
  const beforeSteps = splitPromptStepSections(promptBeforeInput);
  const afterSteps = splitPromptStepSections(promptAfterInput);
  const planMode = beforeSteps.hasPlanStep || afterSteps.hasPlanStep;
  let promptBefore = beforeSteps.main;
  let promptAfter = afterSteps.main;
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
  const buildPromptSections = (textInput = inputValue) => {
    const before = promptSectionValue(promptBefore);
    const after = promptSectionValue(promptAfter);
    const historySegments = historySegmentsForInputValue(context, textInput);
    return [
      {
        label: 'Prompt Before Input',
        text: before,
        parts: promptSectionParts(promptBefore, before),
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
        parts: promptSectionParts(promptAfter, after),
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

  if (planMode) {
    const planBefore = promptSectionValue(beforeSteps.plan);
    const planAfter = promptSectionValue(afterSteps.plan);
    const planHistorySegments = historySegmentsForInputValue(context, inputValue);
    promptPasses.push({
      label: 'Step 1: Planning',
      sections: [
        ...(planBefore
          ? [{
              label: 'Plan Prompt Before Input',
              text: planBefore,
              parts: promptSectionParts(beforeSteps.plan, planBefore),
            }]
          : []),
        {
          label: 'Text Input',
          text: inputValue,
          parts: [{ text: inputValue, historySegments: planHistorySegments }],
          historySegments: planHistorySegments,
        },
        ...(planAfter
          ? [{
              label: 'Plan Prompt After Input',
              text: planAfter,
              parts: promptSectionParts(afterSteps.plan, planAfter),
            }]
          : []),
        {
          label: 'Plan Output Instruction',
          text: planPassInstructionText,
          parts: [{ text: planPassInstructionText, actionInserted: true }],
        },
      ],
    });
    context.updateRuntimeData(node.id, {
      preview: 'Step 1: planning the turn ...',
    });
    const planOutput = await context.llm.complete({
      connectionId: node.data.connectionId,
      nodeId: node.id,
      label: `${callLabel(0)} / Step 1 planning`,
      prompt: [planBefore, inputValue, planAfter, planPassInstructionText]
        .filter(Boolean)
        .join('\n\n'),
      contributesToTokenCalibration,
      useConnectionSampling: true,
    });
    outputPasses.push({ label: 'Step 1 planning output', text: planOutput.text });
    const rolledPlan = rollPlanOutcomes(planOutput.text, random);
    if (rolledPlan.text.trim()) {
      if (rolledPlan.rolls.length) {
        outputPasses.push({ label: 'Step 1 plan after dice rolls', text: rolledPlan.text });
      } else {
        context.reportWarning(
          `${node.data.label}: Step 1 plan contains no percentages; it is passed on without dice rolls.`,
        );
      }
      const planBlock = planContextBlock(rolledPlan.text);
      const beforeInjection = injectPlanOutput(promptBefore, planBlock);
      const afterInjection = injectPlanOutput(promptAfter, planBlock);
      promptBefore = beforeInjection.text;
      promptAfter = afterInjection.text;
      if (!beforeInjection.injected && !afterInjection.injected) {
        promptBefore = [planBlock, promptBefore].filter(Boolean).join('\n\n');
      }
    } else {
      context.reportWarning(
        `${node.data.label}: Step 1 planning returned no plan; continuing without it.`,
      );
      promptBefore = injectPlanOutput(promptBefore, '').text;
      promptAfter = injectPlanOutput(promptAfter, '').text;
    }
  } else if ([promptBefore, promptAfter].join('\n').match(planOutputTokenPattern)) {
    context.reportWarning(
      `${node.data.label}: @plan:output has no Step 1 planning section; the marker was removed.`,
    );
    promptBefore = injectPlanOutput(promptBefore, '').text;
    promptAfter = injectPlanOutput(promptAfter, '').text;
  }

  let generatedText = '';
  let connectionLabel = '';
  const maxActionPasses = Math.max(3, preReplyActionConfigs.length + 1);
  for (let passIndex = 0; passIndex <= maxActionPasses; passIndex += 1) {
    const pendingPreReplyAction = preReplyActionConfigs.some(
      (action) => !actionResults.has(promptActionKey(action.title)),
    );
    const actionReplayCount = actionResultTexts.length;
    const actionReplay = actionReplayCount > 0;
    const passLabel = actionReplay ? `Action replay ${actionReplayCount}` : 'Initial action prompt';
    const inputImagesForPass = visionEnabled ? images : [];
    const imagePass = promptImagePass({
      actionReplay,
      actionImages,
      inputImages: inputImagesForPass,
      referenceImages: referenceImageValues,
    });
    const textInputWithInputImageMarkers = promptWithImageAttachmentMarkers(
      inputValue,
      inputImagesForPass,
      imagePass.inputImageOffset,
    );
    const textInputForPass = promptWithReferenceImageMarkers(
      textInputWithInputImageMarkers,
      usableReferenceImages,
      imagePass.referenceImageOffset,
    );
    const promptForPass = buildCombinedPrompt(textInputForPass);
    promptPasses.push({
      label: passLabel,
      images: imagePreviewItems([
        ...imagePass.actionImages.map((image) => ({ image, source: 'action' as const })),
        ...imagePass.inputImages.map((image) => ({ image, source: 'input' as const })),
        ...imagePass.referenceImages.map((image) => ({ image, source: 'reference' as const })),
      ]),
      sections: buildPromptSections(textInputForPass),
    });
    let output = await context.llm.complete({
      connectionId: node.data.connectionId,
      nodeId: node.id,
      label: callLabel(actionReplayCount),
      prompt: promptForPass,
      images: imagePass.images,
      onChunk: streamsVisibleOutput
        ? (pendingPreReplyAction ? streamUnlessActionCall : streamVisible)
        : undefined,
      contributesToTokenCalibration,
      useConnectionSampling: true,
    });
    outputPasses.push({
      label: actionReplay ? `Action replay ${actionReplayCount} output` : 'Initial action output',
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

      const followUpInstruction = promptActionInstructionText(
        actionConfig,
        actionAvailabilityOptions,
        actionRequest.plan,
      );
      const followUpImagePass = promptImagePass({
        actionReplay: false,
        actionImages: [],
        inputImages: inputImagesForPass,
        referenceImages: referenceImageValues,
      });
      const followUpTextWithInputImageMarkers = promptWithImageAttachmentMarkers(
        inputValue,
        inputImagesForPass,
        followUpImagePass.inputImageOffset,
      );
      const followUpTextInput = promptWithReferenceImageMarkers(
        followUpTextWithInputImageMarkers,
        usableReferenceImages,
        followUpImagePass.referenceImageOffset,
      );
      const promptBeforeForFollowUp = promptSectionValue(promptBefore);
      const followUpHistorySegments = historySegmentsForInputValue(context, followUpTextInput);
      promptPasses.push({
        label: `Action follow-up: ${actionConfig.title}`,
        images: imagePreviewItems([
          ...followUpImagePass.inputImages.map((image) => ({ image, source: 'input' as const })),
          ...followUpImagePass.referenceImages.map((image) => ({ image, source: 'reference' as const })),
        ]),
        sections: [
          {
            label: 'Prompt Before Input',
            text: promptBeforeForFollowUp,
            parts: promptSectionParts(promptBefore, promptBeforeForFollowUp),
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
      const commandNames = uniqueRequests.map((request) => request.config.commandId).join(', ');
      const instruction = promptCommandPassInstruction(visibleReply, uniqueRequests, actionResultTexts);
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
      const historySegments = historySegmentsForInputValue(context, inputValue);
      promptPasses.push({
        label: `Command pass: ${commandNames}`,
        sections: [
          {
            label: 'Text Input',
            text: inputValue,
            parts: [{ text: inputValue, historySegments }],
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
        label: `${callLabel(0)} / Command pass`,
        prompt: [inputValue, instruction].filter(Boolean).join('\n\n'),
        onChunk: streamCommandOutput,
        contributesToTokenCalibration,
        useConnectionSampling: true,
      });
      outputPasses.push({ label: `Command pass output`, text: output.text });
      let commandSocialValidation = validateSocialMessengerAccounts({
        text: output.text,
        characters: socialCharacters,
        messages: context.historyMessages,
      });
      if (commandSocialValidation.issues.length > 0 && context.retryFormatErrorsEnabled) {
        const correction = socialMessageCorrectionContext(commandSocialValidation.issues);
        promptPasses.push({
          label: 'Command social account correction replay',
          sections: [
            {
              label: 'Text Input',
              text: inputValue,
              parts: [{ text: inputValue, historySegments }],
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
          label: `${callLabel(0)} / Command social account correction`,
          prompt: [inputValue, correction, instruction].filter(Boolean).join('\n\n'),
          onChunk: streamCommandOutput,
          contributesToTokenCalibration,
          useConnectionSampling: true,
        });
        outputPasses.push({
          label: 'Command social account correction output',
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
    const inputImagesForPass = visionEnabled ? images : [];
    const instruction = promptActionAfterReplyText(actionConfig, visibleReply);
    const promptBeforeForPass = promptSectionValue(promptBefore);
    const textInputForPass = promptWithImageAttachmentMarkers(inputValue, inputImagesForPass, 0);
    const passLabel = `After-reply action: ${actionConfig.title}`;
    const historySegments = historySegmentsForInputValue(context, textInputForPass);
    promptPasses.push({
      label: passLabel,
      images: imagePreviewItems(inputImagesForPass.map((image) => ({ image, source: 'input' as const }))),
      sections: [
        {
          label: 'Prompt Before Input',
          text: promptBeforeForPass,
          parts: promptSectionParts(promptBefore, promptBeforeForPass),
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
    const output = await context.llm.complete({
      connectionId: node.data.connectionId,
      nodeId: node.id,
      label: `${callLabel(0)} / After-reply action`,
      prompt: [promptBeforeForPass, textInputForPass, instruction].filter(Boolean).join('\n\n'),
      images: inputImagesForPass,
      contributesToTokenCalibration,
      useConnectionSampling: true,
    });
    outputPasses.push({ label: `${passLabel} output`, text: output.text });
    const actionCall = parsePromptActionCall(output.text);
    if (!actionCall || actionCall.action !== actionConfig.actionId) {
      context.reportWarning(
        `${node.data.label}: After-reply action ${actionConfig.title} returned no valid action call.`,
      );
      continue;
    }
    const actionResult = await executePromptAction(context, actionConfig, actionCall, {
      ...actionAvailabilityOptions,
      llmConnectionId: node.data.connectionId,
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
