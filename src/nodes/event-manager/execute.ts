import type { MessageRecord, RpAppointment, WorkflowNode } from '../../types';
import { formatAppointments } from '../../workflow';
import { storyCharacterRefsFromNodes } from '../../storybook/runtime';
import {
  appointmentEntitiesFromAppointments,
  appointmentsEqual,
  formatAppointmentForAnalysis,
  sortAppointments,
} from '../../data-management/eventStore';
import type { ExecuteContext } from '../types';
import { buildEventManagerPrompt } from './prompt';

type EventManagerOutputs = {
  contextText: string;
  appointmentsText: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLocalDateTime(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour, minute] = match;
  const parsed = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  ));
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day) ||
    parsed.getUTCHours() !== Number(hour) ||
    parsed.getUTCMinutes() !== Number(minute)
  ) {
    return undefined;
  }
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function currentLocalDateTime() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  ].join('T');
}

function latestHistoryRpDateTime(messages: MessageRecord[]) {
  return [...messages]
    .reverse()
    .find((message) =>
      message.includeInHistory !== false &&
      (message.role === 'user' || message.role === 'output') &&
      !!normalizeLocalDateTime(message.rpDateTime),
    )?.rpDateTime;
}

function parseResponse(text: string, label = 'Event Manager LLM') {
  const trimmed = text.trim();
  if (trimmed.toLocaleUpperCase() === 'END') {
    return { op: 'end' };
  }
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (withoutFence.toLocaleUpperCase() === 'END') {
    return { op: 'end' };
  }
  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  const candidates = Array.from(new Set([
    withoutFence,
    firstBrace >= 0 && lastBrace > firstBrace
      ? withoutFence.slice(firstBrace, lastBrace + 1)
      : '',
  ].filter(Boolean)));
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!isRecord(parsed)) {
        throw new Error('response is not an object');
      }
      return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `${label} returned invalid JSON: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function normalizeCharacterName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

function resolveCharacterName(value: string | undefined, characterNames: string[]) {
  if (!value) {
    return undefined;
  }
  const normalized = normalizeCharacterName(value);
  return characterNames.find((name) => normalizeCharacterName(name) === normalized);
}

function appointmentKey(appointment: Pick<RpAppointment, 'scheduledAt' | 'condition' | 'title'>) {
  return `${appointment.scheduledAt ?? ''}\n${appointment.condition ?? ''}\n${appointment.title.toLowerCase()}`;
}

function normalizeAppointmentEntry(
  entry: unknown,
  existingAppointments: RpAppointment[],
  currentTurnId: string,
  currentTurnNumber: number | undefined,
  referenceDateTime: string,
  characterNames: string[],
  index: number,
  fallbackExisting?: RpAppointment,
) {
  if (!isRecord(entry)) {
    return undefined;
  }
  const existingById = new Map(existingAppointments.map((appointment) => [appointment.id, appointment]));
  const existingByKey = new Map(
    existingAppointments.map((appointment) => [appointmentKey(appointment), appointment]),
  );
  const scheduledAt = normalizeLocalDateTime(entry.at ?? entry.scheduledAt) ?? fallbackExisting?.scheduledAt;
  const title =
    typeof entry.title === 'string'
      ? entry.title.trim()
      : fallbackExisting?.title ?? '';
  const condition =
    typeof entry.condition === 'string'
      ? entry.condition.trim() || undefined
      : fallbackExisting?.condition;
  const details =
    typeof entry.details === 'string'
      ? entry.details.trim() || undefined
      : fallbackExisting?.details;
  if (!title || (!scheduledAt && !condition && !details)) {
    return undefined;
  }
  const existing =
    fallbackExisting ??
    (typeof entry.id === 'string'
      ? existingById.get(entry.id)
      : existingByKey.get(appointmentKey({ scheduledAt, condition, title })));
  const requestedChannel: RpAppointment['channel'] =
    entry.channel === 'phone' || entry.channel === 'chat'
      ? entry.channel
      : existing?.channel ?? 'chat';
  const rawPhoneFrom =
    typeof entry.phoneFrom === 'string'
      ? entry.phoneFrom.trim() || undefined
      : existing?.phoneFrom;
  const rawPhoneTo =
    typeof entry.phoneTo === 'string'
      ? entry.phoneTo.trim() || undefined
      : existing?.phoneTo;
  const phoneFrom = resolveCharacterName(rawPhoneFrom, characterNames);
  const phoneTo = resolveCharacterName(rawPhoneTo, characterNames);
  const channel: RpAppointment['channel'] = requestedChannel === 'phone' && phoneFrom && phoneTo ? 'phone' : 'chat';
  const phoneRequester =
    typeof (entry.phoneRequester ?? entry.requester) === 'string'
      ? String(entry.phoneRequester ?? entry.requester).trim() || undefined
      : existing?.phoneRequester;
  const phoneMessenger =
    typeof (entry.phoneMessenger ?? entry.messenger) === 'string'
      ? String(entry.phoneMessenger ?? entry.messenger).trim() || undefined
      : existing?.phoneMessenger;
  const phoneRecipient =
    typeof (entry.phoneRecipient ?? entry.recipient) === 'string'
      ? String(entry.phoneRecipient ?? entry.recipient).trim() || undefined
      : existing?.phoneRecipient;
  const phoneAction =
    typeof (entry.phoneAction ?? entry.action) === 'string'
      ? normalizePhoneAction(
        String(entry.phoneAction ?? entry.action).trim() || undefined,
        phoneRecipient ?? phoneTo,
      )
      : existing?.phoneAction;
  const rawStatus = entry.status ?? entry.s;
  const status: RpAppointment['status'] =
    rawStatus === 'completed' || rawStatus === 'cancelled'
      ? rawStatus
      : 'upcoming';
  if (existing && existing.status !== 'upcoming' && rawStatus !== 'upcoming') {
    return undefined;
  }
  if (status !== 'upcoming' || (scheduledAt !== undefined && scheduledAt <= referenceDateTime)) {
    return undefined;
  }
  const sourceTurnNumber =
    typeof (entry.turn ?? entry.sourceTurnNumber) === 'number' &&
    Number.isFinite(entry.turn ?? entry.sourceTurnNumber)
      ? Number(entry.turn ?? entry.sourceTurnNumber)
      : existing?.sourceTurnNumber ?? currentTurnNumber;
  const sourceNote =
    typeof (entry.note ?? entry.sourceNote) === 'string'
      ? String(entry.note ?? entry.sourceNote).trim() || undefined
      : existing?.sourceNote;
  return {
    id:
      existing?.id ??
      (typeof entry.id === 'string' && entry.id.trim()
        ? entry.id.trim()
        : `${currentTurnId}-event-${index + 1}`),
    scheduledAt,
    title,
    condition,
    details,
    channel,
    phoneFrom: channel === 'phone' ? phoneFrom : undefined,
    phoneTo: channel === 'phone' ? phoneTo : undefined,
    phoneRequester: channel === 'phone' ? phoneRequester : undefined,
    phoneMessenger: channel === 'phone' ? phoneMessenger ?? phoneFrom : undefined,
    phoneRecipient: channel === 'phone' ? phoneRecipient ?? phoneTo : undefined,
    phoneAction: channel === 'phone' ? phoneAction : undefined,
    requestedBy:
      typeof (entry.by ?? entry.requestedBy) === 'string'
        ? String(entry.by ?? entry.requestedBy).trim() || undefined
        : existing?.requestedBy,
    assignedTo:
      typeof (entry.to ?? entry.assignedTo) === 'string'
        ? String(entry.to ?? entry.assignedTo).trim() || undefined
        : existing?.assignedTo,
    sourceTurnId:
      existing?.sourceTurnId ??
      (typeof entry.sourceTurnId === 'string' && entry.sourceTurnId.trim()
        ? entry.sourceTurnId.trim()
        : currentTurnId),
    sourceTurnNumber,
    sourceNote,
    status,
  };
}

function responseArray(value: unknown) {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function normalizePhoneAction(action: string | undefined, recipient: string | undefined) {
  if (!action) {
    return undefined;
  }
  let normalized = action.trim().replace(/^["']+|["']+$/g, '').replace(/[.!?]+$/, '').trim();
  if (recipient) {
    const escapedRecipient = escapeRegExp(recipient);
    normalized = normalized
      .replace(new RegExp(`^(?:tell|ask|message|text|call|contact)\\s+${escapedRecipient}\\s+to\\s+`, 'i'), '')
      .replace(new RegExp(`^(?:tell|ask|message|text|call|contact)\\s+${escapedRecipient}\\s+about\\s+`, 'i'), 'ask about ');
  }
  normalized = normalized
    .replace(/^(?:tell|ask)\s+(?:him|her|them)\s+to\s+/i, '')
    .replace(/^(?:message|text|call|contact)\s+(?:him|her|them)\s+about\s+/i, 'ask about ')
    .trim();
  return normalized || undefined;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function responseDeleteIds(value: unknown) {
  return responseArray(value).flatMap((entry) => {
    if (typeof entry === 'string') {
      return [entry];
    }
    if (isRecord(entry) && typeof entry.id === 'string') {
      return [entry.id];
    }
    return [];
  });
}

function hasEventChanges(response: Record<string, unknown>) {
  return (
    responseArray(response.add).length > 0 ||
    responseArray(response.newEvent).length > 0 ||
    responseArray(response.newEvents).length > 0 ||
    responseArray(response.update).length > 0 ||
    responseDeleteIds(response.delete).length > 0 ||
    responseDeleteIds(response.deleteIds).length > 0 ||
    responseDeleteIds(response.remove).length > 0 ||
    responseDeleteIds(response.cancel).length > 0
  );
}

function applyEventResponse(
  response: Record<string, unknown>,
  existingAppointments: RpAppointment[],
  currentTurnId: string,
  currentTurnNumber: number | undefined,
  referenceDateTime: string,
  characterNames: string[],
) {
  const activeAppointments = existingAppointments.filter((appointment) =>
    appointment.status === 'upcoming' &&
    (!appointment.scheduledAt || appointment.scheduledAt > referenceDateTime),
  );
  const deletedIds = new Set([
    ...responseDeleteIds(response.delete),
    ...responseDeleteIds(response.deleteIds),
    ...responseDeleteIds(response.remove),
    ...responseDeleteIds(response.cancel),
  ]);
  const byId = new Map(
    activeAppointments
      .filter((appointment) => !deletedIds.has(appointment.id))
      .map((appointment) => [appointment.id, appointment]),
  );
  responseArray(response.update).forEach((entry, index) => {
    const existing =
      isRecord(entry) && typeof entry.id === 'string'
        ? byId.get(entry.id) ?? activeAppointments.find((appointment) => appointment.id === entry.id)
        : undefined;
    const normalized = normalizeAppointmentEntry(
      entry,
      activeAppointments,
      currentTurnId,
      currentTurnNumber,
      referenceDateTime,
      characterNames,
      index,
      existing,
    );
    if (normalized) {
      byId.set(normalized.id, normalized);
    }
  });
  [
    ...responseArray(response.add),
    ...responseArray(response.newEvent),
    ...responseArray(response.newEvents),
  ].forEach((entry, index) => {
    const normalized = normalizeAppointmentEntry(
      entry,
      [...byId.values()],
      currentTurnId,
      currentTurnNumber,
      referenceDateTime,
      characterNames,
      index,
    );
    if (normalized) {
      byId.set(normalized.id, normalized);
    }
  });
  return sortAppointments([...byId.values()]);
}

async function inputContext(node: WorkflowNode, context: ExecuteContext) {
  const incomingEdge = context.edges.find((edge) => edge.target === node.id);
  if (!incomingEdge) {
    return '';
  }
  return await context.executeInput(incomingEdge.source, incomingEdge.sourceHandle);
}

function outputForHandle(outputs: EventManagerOutputs, sourceHandle?: string | null) {
  if (sourceHandle === 'appointments') {
    return outputs.appointmentsText;
  }
  return '';
}

export async function executeEventManagerNode(node: WorkflowNode, context: ExecuteContext) {
  const contextText = await inputContext(node, context);
  const appointments = node.data.eventAppointments ?? [];
  let outputs: EventManagerOutputs = {
    contextText,
    appointmentsText: formatAppointments(
      appointments,
      context.rpDateTimeFormat,
      context.rpWeekdayLanguage,
    ),
  };

  if (context.phase !== 'prepare-next-turn') {
    context.updateRuntimePortValue(node.id, 'output', 'appointments', outputs.appointmentsText);
    context.updateRuntimeData(node.id, {
      preview: contextText ? 'Event context ready' : 'No event context connected',
      fullText: contextText,
      displayTokenBytesPerToken: context.textMetrics.bytesPerToken,
      eventStatus: node.data.eventStatus ?? 'Waiting for event update',
    });
    return outputForHandle(outputs, context.sourceHandle);
  }

  const currentTurnId = context.currentTurnId;
  if (!currentTurnId) {
    throw new Error('Event Manager needs the current turn id.');
  }
  const processedTurnIds = node.data.eventProcessedTurnIds ?? [];
  if (processedTurnIds.includes(currentTurnId)) {
    context.updateRuntimePortValue(node.id, 'output', 'appointments', outputs.appointmentsText);
    context.updateRuntimeData(node.id, {
      preview: 'Event list already prepared',
      fullText: contextText,
      displayTokenBytesPerToken: context.textMetrics.bytesPerToken,
      eventStatus: node.data.eventStatus ?? 'Waiting for event update',
    });
    return outputForHandle(outputs, context.sourceHandle);
  }

  const referenceRpDateTime = normalizeLocalDateTime(latestHistoryRpDateTime(context.historyMessages)) ??
    currentLocalDateTime();
  const currentTurnNumber = context.historyMessages.find(
    (message) => message.turnId === currentTurnId && message.turnNumber !== undefined,
  )?.turnNumber;
  const characterNames = storyCharacterRefsFromNodes(context.nodes).map((character) => character.label);
  const prompt = buildEventManagerPrompt(node.data.eventManagerPrompt, {
    EventManagerContext: contextText,
    ReferenceRpTime: referenceRpDateTime,
    ReferenceWallClock: currentLocalDateTime(),
    AvailableCharacterNames: JSON.stringify(characterNames),
    ExistingEvents: JSON.stringify(appointments.map(formatAppointmentForAnalysis)),
  });
  let lastResponseText = '';
  const attemptEvents = async (attempt: number) => {
    lastResponseText = '';
    context.updateRuntimeData(node.id, { eventLastPrompt: prompt, eventLastResponse: '' });
    const completion = await context.llm.complete({
      connectionId: node.data.connectionId,
      nodeId: node.id,
      label: 'Events',
      prompt,
      fastTask: true,
      contributesToTokenCalibration: true,
      // A retry at the same near-zero temperature tends to reproduce the
      // identical malformed response; add variation on the second try.
      temperature: attempt > 1 ? 0.5 : 0.1,
    });
    lastResponseText = completion.text;
    context.updateRuntimeData(node.id, { eventLastResponse: completion.text });
    return { completion, response: parseResponse(completion.text, 'Event Manager') };
  };
  const maxAttempts = context.retryFormatErrorsEnabled ? 2 : 1;
  let completion!: Awaited<ReturnType<typeof attemptEvents>>['completion'];
  let response!: Record<string, unknown>;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      ({ completion, response } = await attemptEvents(attempt));
      context.reportFormatResult({
        name: 'Event JSON',
        status: 'ok',
        detail: attempt > 1
          ? 'Event Manager response parsed after retry.'
          : 'Event Manager response parsed.',
      });
      break;
    } catch (error) {
      if (attempt < maxAttempts) {
        continue;
      }
      context.reportFormatResult({
        name: 'Event JSON',
        status: 'error',
        detail: error instanceof Error ? error.message : String(error),
        preview: lastResponseText,
      });
      throw error;
    }
  }
  const nextAppointments = applyEventResponse(
    response,
    appointments,
    currentTurnId,
    currentTurnNumber,
    referenceRpDateTime,
    characterNames,
  );
  const changedEvents = hasEventChanges(response) || !appointmentsEqual(appointments, nextAppointments);
  outputs = {
    contextText,
    appointmentsText: formatAppointments(
      nextAppointments,
      context.rpDateTimeFormat,
      context.rpWeekdayLanguage,
    ),
  };
  context.updateRuntimePortValue(node.id, 'output', 'appointments', outputs.appointmentsText);
  const eventStatus = changedEvents
    ? `Events updated: ${nextAppointments.length} upcoming`
    : `Events unchanged: ${nextAppointments.length} upcoming`;
  context.updateEventEntities(
    node.id,
    appointmentEntitiesFromAppointments(nextAppointments),
    eventStatus,
  );
  context.updateRuntimeData(node.id, {
    preview: 'Events prepared',
    fullText: contextText,
    displayTokenBytesPerToken: context.textMetrics.bytesPerToken,
    eventProcessedTurnIds: [...processedTurnIds, currentTurnId],
    eventLastPrompt: prompt,
    eventLastResponse: completion.text,
  });
  return outputForHandle(outputs, context.sourceHandle);
}
