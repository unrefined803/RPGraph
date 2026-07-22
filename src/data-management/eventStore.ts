import type { RpAppointment, WorkflowNode } from '../types';
import { parseRpStorybookJson } from '../nodes/rp-storybook/model';
import { isStorybookSourceNode } from '../storybook/runtime';
import {
  appointmentFromEventEntity,
  eventEntityFromAppointment,
  type EventEntity,
  type TimelineEventEntry,
} from './types';

function compareAppointments(left: RpAppointment, right: RpAppointment) {
  if (left.scheduledAt && right.scheduledAt) {
    return left.scheduledAt.localeCompare(right.scheduledAt);
  }
  if (left.scheduledAt) {
    return -1;
  }
  if (right.scheduledAt) {
    return 1;
  }
  return (left.sourceTurnNumber ?? 0) - (right.sourceTurnNumber ?? 0) ||
    left.title.localeCompare(right.title);
}

export function sortAppointments(appointments: RpAppointment[]) {
  return [...appointments].sort(compareAppointments);
}

export function upcomingAppointments(appointments: RpAppointment[]) {
  return sortAppointments(appointments.filter((event) => event.status === 'upcoming'));
}

export function appointmentEntitiesFromAppointments(
  appointments: RpAppointment[],
): Record<string, EventEntity> {
  return Object.fromEntries(
    appointments.map((appointment) => [
      appointment.id,
      eventEntityFromAppointment(appointment),
    ]),
  );
}

export function appointmentsFromEventEntities(events: Record<string, EventEntity>) {
  return sortAppointments(Object.values(events).map(appointmentFromEventEntity));
}

export function normalizeEventAppointments(appointments: RpAppointment[] = []) {
  return appointmentsFromEventEntities(appointmentEntitiesFromAppointments(appointments));
}

export function formatAppointmentForAnalysis(appointment: RpAppointment) {
  return {
    id: appointment.id,
    at: appointment.scheduledAt,
    title: appointment.title,
    condition: appointment.condition,
    details: appointment.details,
    channel: appointment.channel,
    phoneFrom: appointment.phoneFrom,
    phoneTo: appointment.phoneTo,
    phoneRequester: appointment.phoneRequester,
    phoneMessenger: appointment.phoneMessenger,
    phoneRecipient: appointment.phoneRecipient,
    phoneAction: appointment.phoneAction,
    by: appointment.requestedBy,
    to: appointment.assignedTo,
    turn: appointment.sourceTurnNumber,
    note: appointment.sourceNote,
    s: appointment.status,
  };
}

export function appointmentsEqual(left: RpAppointment[], right: RpAppointment[]) {
  return JSON.stringify(left.map(formatAppointmentForAnalysis)) ===
    JSON.stringify(right.map(formatAppointmentForAnalysis));
}

export function eventEntitiesFromNodes(nodes: WorkflowNode[]) {
  const storybookOpeningEventIds = new Set(
    nodes
      .filter(isStorybookSourceNode)
      .flatMap((node) => {
        try {
          return node.data.storybookJson
            ? parseRpStorybookJson(node.data.storybookJson).openingHistory.events.map((event) => event.id)
            : [];
        } catch {
          return [];
        }
      }),
  );
  return Object.fromEntries(
    nodes
      .filter((node) => node.data.kind === undefined && node.data.nodeType === 'event-manager')
      .flatMap((node) => node.data.eventAppointments ?? [])
      .map((appointment) => [
        appointment.id,
        eventEntityFromAppointment(appointment, {
          storybookOpening: storybookOpeningEventIds.has(appointment.id),
        }),
      ]),
  );
}

export function updateAppointmentStatus(
  appointments: RpAppointment[],
  eventId: string,
  status: 'completed' | 'cancelled',
) {
  return appointments.map((event) =>
    event.id === eventId ? { ...event, status } : event,
  );
}

export function updateEventEntityStatus(
  events: Record<string, EventEntity>,
  eventId: string,
  status: 'completed' | 'cancelled',
) {
  const event = events[eventId];
  if (!event) {
    return events;
  }
  return {
    ...events,
    [eventId]: {
      ...event,
      status,
    },
  };
}

export function removeEventEntities(
  events: Record<string, EventEntity>,
  eventIds: Set<string>,
) {
  return Object.fromEntries(
    Object.entries(events).filter(([eventId]) => !eventIds.has(eventId)),
  );
}

function eventOperation(event: EventEntity): TimelineEventEntry['operation'] {
  if (event.status === 'completed') {
    return 'complete';
  }
  if (event.status === 'cancelled') {
    return 'cancel';
  }
  return 'add';
}

export function eventTimelineEntriesFromEntities(
  events: Record<string, EventEntity>,
): TimelineEventEntry[] {
  const grouped = new Map<string, TimelineEventEntry>();
  appointmentsFromEventEntities(events).forEach((appointment) => {
    const event = events[appointment.id];
    if (!event) {
      return;
    }
    const operation = eventOperation(event);
    const turnId = event.source.turnId;
    const key = `${turnId ?? 'session'}:${operation}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.eventIds.push(event.id);
      return;
    }
    grouped.set(key, {
      id: `event-change-${key.replace(/[^A-Za-z0-9_-]+/g, '-')}`,
      kind: 'event-change',
      turnId,
      eventIds: [event.id],
      operation,
    });
  });
  return [...grouped.values()];
}
