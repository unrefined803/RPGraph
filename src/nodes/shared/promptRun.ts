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
  promptCommandPassInstruction,
  replacePromptCommandTokensWithHints,
  type PromptCommandConfig,
  type PromptCommandId,
} from './promptCommands';
import { promptImagePass } from './promptImagePass';
import { storybookCreateImageCharactersFromNodes } from '../../storybook/runtime';

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

function segmentText(segments: FormattedChatHistorySegment[]) {
  return segments.map((segment) => segment.text).join('\n\n');
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
  const fullText = normalizedSegmentText(segmentText(segments));
  if (fullText === normalizedInput) {
    return segments;
  }

  let bestContainedMatch:
    | { segments: FormattedChatHistorySegment[]; textLength: number }
    | undefined;
  for (let start = 0; start < segments.length; start += 1) {
    for (let end = segments.length; end > start; end -= 1) {
      const candidate = segments.slice(start, end);
      const candidateText = normalizedSegmentText(segmentText(candidate));
      if (candidateText === normalizedInput) {
        return candidate;
      }
      if (
        candidateText &&
        normalizedInput.includes(candidateText) &&
        (!bestContainedMatch || candidateText.length > bestContainedMatch.textLength)
      ) {
        bestContainedMatch = { segments: candidate, textLength: candidateText.length };
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
  promptBefore,
  promptAfter,
  actionConfigs,
  commandConfigs = [],
  streamsVisibleOutput,
  contributesToTokenCalibration,
  callLabel,
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
}) {
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
    parsePromptCommandTokens([promptBefore, promptAfter].join('\n'))
      .map((token) => knownPromptCommandId(token.name))
      .filter((commandId): commandId is PromptCommandId => !!commandId),
  ));
  const availableActionConfigs = parsePromptActionTokens([promptBefore, promptAfter].join('\n'))
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
  // Commands are requested with a final "[commands: ...]" line that is stripped
  // from the visible output later; hold a trailing line back from the stream while
  // it still looks like such a request so it never flashes into the chat.
  const holdTrailingCommandRequest = (value: string) => {
    if (!availableCommandIds.length) {
      return value;
    }
    const lineStart = value.lastIndexOf('\n') + 1;
    const line = value.slice(lineStart).trimStart();
    if (!line.startsWith('[')) {
      return value;
    }
    const inner = line.slice(1).trimStart().toLocaleLowerCase();
    if (/^commands?\s*:/.test(inner) || 'commands:'.startsWith(inner)) {
      return value.slice(0, lineStart).replace(/\s+$/, '');
    }
    return value;
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

  let generatedText = '';
  let connectionLabel = '';
  let combinedPrompt = buildCombinedPrompt();
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
    const output = await context.llm.complete({
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
    generatedText = output.text;
    connectionLabel = output.connection.label;
    outputPasses.push({
      label: actionReplay ? `Action replay ${actionReplayCount} output` : 'Initial action output',
      text: output.text,
    });
    let actionRequest = parsePromptActionRequest(output.text);
    if (!actionRequest) {
      // Models sometimes request an image action through the command syntax
      // ("[commands: create_image]") instead of the action JSON. Recover by
      // treating it as an action request; the drafted reply becomes the plan
      // and is rewritten in the replay pass with the action result available.
      const commandStyleRequest = parsePromptCommandRequest(output.text);
      const requestedActionId = commandStyleRequest?.names
        .map((name) => knownPromptActionId(name))
        .find((actionId): actionId is 'getImageId' | 'createImage' =>
          (actionId === 'getImageId' || actionId === 'createImage') &&
          preReplyActionConfigs.some(
            (candidate) =>
              candidate.actionId === actionId &&
              !actionResults.has(promptActionKey(candidate.title)),
          ),
        );
      if (commandStyleRequest && requestedActionId) {
        actionRequest = {
          action: requestedActionId,
          plan: commandStyleRequest.reply
            ? `Draft reply from the first pass (it is discarded and rewritten once the action result is available):\n${commandStyleRequest.reply}`
            : '',
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
    combinedPrompt = buildCombinedPrompt();
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
    const requestedConfigs = commandRequest.names.flatMap((name) => {
      const commandId = knownPromptCommandId(name);
      if (!commandId || !availableCommandIds.includes(commandId)) {
        context.reportWarning(`${node.data.label}: LLM requested unavailable command ${name}.`);
        return [];
      }
      return [configForPromptCommandToken(commandConfigs, commandId)];
    });
    const uniqueRequestedConfigs = Array.from(
      new Map(requestedConfigs.map((config) => [config.commandId, config])).values(),
    );
    if (uniqueRequestedConfigs.length && visibleReply) {
      const commandNames = uniqueRequestedConfigs.map((config) => config.commandId).join(', ');
      const instruction = promptCommandPassInstruction(visibleReply, uniqueRequestedConfigs, actionResultTexts);
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
      const output = await context.llm.complete({
        connectionId: node.data.connectionId,
        nodeId: node.id,
        label: `${callLabel(0)} / Command pass`,
        prompt: [inputValue, instruction].filter(Boolean).join('\n\n'),
        contributesToTokenCalibration,
        useConnectionSampling: true,
      });
      outputPasses.push({ label: `Command pass output`, text: output.text });
      const commandJson = unwrapJsonCodeFence(output.text).trim();
      if (commandJson.startsWith('{') || commandJson.startsWith('[')) {
        commandOutputText = commandJson;
      } else {
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
  if (commandRequest) {
    generatedText = [visibleReply, commandOutputText].filter(Boolean).join('\n');
  }
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
      combinedPrompt: promptPasses.length ? '' : combinedPrompt,
      promptPasses,
      outputPasses,
      actionResults: actionResultTexts,
      generatedText,
    } satisfies PromptRunDebug,
  };
}
