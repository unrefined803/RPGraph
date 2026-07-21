import type { MessageRecord, MessageVoiceClip, TurnRecord } from '../types';

export type StorybookVoiceMedia = Record<string, string>;

type StoredVoiceClip = MessageVoiceClip & { mediaRef?: unknown };

const audioDataUrlPattern = /^data:audio\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/;
const voiceMediaRefPattern = /^voice-(\d+)$/;

function audioDataUrl(value: unknown): value is string {
  return typeof value === 'string' && audioDataUrlPattern.test(value);
}

export function normalizeStorybookVoiceMedia(value: unknown): StorybookVoiceMedia {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([ref, dataUrl]) =>
      voiceMediaRefPattern.test(ref) && audioDataUrl(dataUrl)
    ),
  );
}

function mapTurnMessages(
  turns: TurnRecord[],
  mapMessage: (message: MessageRecord) => MessageRecord,
): TurnRecord[] {
  return turns.map((turn) => ({
    ...turn,
    input: { ...turn.input, messages: turn.input.messages.map(mapMessage) },
    output: { ...turn.output, messages: turn.output.messages.map(mapMessage) },
  }));
}

/**
 * Moves Opening History voice payloads into one Storybook-level pool. The
 * returned pool contains only media referenced by the returned turns, so
 * replacing or removing a clip also removes its orphaned audio on rebuild.
 */
export function turnsWithStorybookVoiceRefs(
  turns: TurnRecord[],
  existingMedia: StorybookVoiceMedia = {},
) {
  const sourceMedia = normalizeStorybookVoiceMedia(existingMedia);
  const sourceRefByDataUrl = new Map(
    Object.entries(sourceMedia).map(([ref, dataUrl]) => [dataUrl, ref]),
  );
  const voiceMedia: StorybookVoiceMedia = {};
  const storedRefByDataUrl = new Map<string, string>();
  let nextRefNumber = Math.max(
    0,
    ...Object.keys(sourceMedia).map((ref) => Number(voiceMediaRefPattern.exec(ref)?.[1] ?? 0)),
  ) + 1;

  const mediaRefForDataUrl = (dataUrl: string) => {
    const storedRef = storedRefByDataUrl.get(dataUrl);
    if (storedRef) {
      return storedRef;
    }
    const sourceRef = sourceRefByDataUrl.get(dataUrl);
    const ref = sourceRef ?? `voice-${nextRefNumber++}`;
    storedRefByDataUrl.set(dataUrl, ref);
    voiceMedia[ref] = dataUrl;
    return ref;
  };

  const withVoiceRefs = (message: MessageRecord): MessageRecord => {
    if (!Array.isArray(message.voiceClips)) {
      return message;
    }
    const voiceClips = message.voiceClips.flatMap((clip) => {
      if (!clip || typeof clip !== 'object') {
        return [];
      }
      const storedClip = clip as StoredVoiceClip;
      const referencedDataUrl = typeof storedClip.mediaRef === 'string'
        ? sourceMedia[storedClip.mediaRef]
        : undefined;
      const dataUrl = audioDataUrl(clip.dataUrl) ? clip.dataUrl : referencedDataUrl;
      if (!dataUrl) {
        return [];
      }
      return [{
        ...clip,
        dataUrl: '',
        mediaRef: mediaRefForDataUrl(dataUrl),
      }];
    });
    return {
      ...message,
      voiceClips: voiceClips.length ? voiceClips : undefined,
    };
  };

  return {
    turns: mapTurnMessages(turns, withVoiceRefs),
    voiceMedia,
  };
}

export function turnsWithRehydratedStorybookVoices(
  turns: TurnRecord[],
  media: StorybookVoiceMedia,
): TurnRecord[] {
  const voiceMedia = normalizeStorybookVoiceMedia(media);
  const withVoiceData = (message: MessageRecord): MessageRecord => {
    if (!message.voiceClips?.length) {
      return message;
    }
    const voiceClips = message.voiceClips.flatMap((clip) => {
      const storedClip = clip as StoredVoiceClip;
      const dataUrl = audioDataUrl(clip.dataUrl)
        ? clip.dataUrl
        : typeof storedClip.mediaRef === 'string'
          ? voiceMedia[storedClip.mediaRef]
          : undefined;
      if (!dataUrl) {
        return [];
      }
      const { mediaRef: _mediaRef, ...runtimeClip } = storedClip;
      return [{ ...runtimeClip, dataUrl } satisfies MessageVoiceClip];
    });
    return {
      ...message,
      voiceClips: voiceClips.length ? voiceClips : undefined,
    };
  };
  return mapTurnMessages(turns, withVoiceData);
}
