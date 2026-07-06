import { useEffect, useMemo, useRef, useState } from 'react';
import { isComfyVoiceConnection } from '../comfy/connectionRole';
import type { StorybookCharacter } from '../storybook/runtime';
import type { ConnectionPreset, MessageRecord, MessageVoiceClip } from '../types';
import {
  dialogueSpeechText,
  dialogueVoiceMessageSegments,
} from './dialogueVoiceSegments';

const dialogueVoiceCacheMaxEntries = 64;
// Reserved cache name for the narrator; the NUL byte cannot appear in character names.
const narratorSpeakerCacheName = '\u0000narrator';

export type DialogueVoiceRequest = {
  key: string;
  messageId: number;
  speakerName: string;
  text: string;
};

// Voice playback for the chat: click-to-speak on highlighted dialogue quotes,
// plus queue-based preloading and sequential read-aloud of whole messages.
// Clips are generated from the stored MP3 samples via the ComfyUI voice provider.
export function useDialogueVoice({
  storyCharacters,
  connections,
  messages,
  englishProcessingEnabled,
  generateVoiceClip,
  unloadVoiceModels,
  onVoiceClipGenerated,
  notifySystem,
}: {
  storyCharacters: StorybookCharacter[];
  connections: ConnectionPreset[];
  messages: MessageRecord[];
  englishProcessingEnabled: boolean;
  generateVoiceClip: (request: {
    providerId: string;
    speechText: string;
    sampleDataUrl: string;
  }) => Promise<Array<{ dataUrl: string; filename: string }>>;
  unloadVoiceModels: (providerId: string) => Promise<void>;
  onVoiceClipGenerated: (messageId: number, clip: MessageVoiceClip) => void;
  notifySystem: (level: 'info' | 'warning' | 'error', text: string) => void;
}) {
  const [activeDialogueVoiceKey, setActiveDialogueVoiceKey] = useState<string | null>(null);
  const [readAloudActive, setReadAloudActive] = useState(false);
  const activeKeyRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackDoneRef = useRef<(() => void) | null>(null);
  const preloadTokenRef = useRef(0);
  const readAloudTokenRef = useRef(0);
  const clipCacheRef = useRef(new Map<string, string>());
  const messagesRef = useRef(messages);

  const voiceConnection = useMemo(
    () => connections.find(isComfyVoiceConnection),
    [connections],
  );
  const voiceProviderId = voiceConnection?.id ?? '';
  const narratorVoiceSampleDataUrl = voiceConnection?.comfyNarratorVoice?.dataUrl ?? '';
  const voiceSamplesByName = useMemo(() => {
    const samples = new Map<string, string>();
    for (const character of storyCharacters) {
      const sampleDataUrl = character.voiceConfig?.sampleDataUrl;
      if (sampleDataUrl && character.name.trim() && !samples.has(character.name)) {
        samples.set(character.name, sampleDataUrl);
      }
    }
    return samples;
  }, [storyCharacters]);
  const dialogueVoiceSpeakerNames = useMemo(
    () => (voiceProviderId ? new Set(voiceSamplesByName.keys()) : new Set<string>()),
    [voiceProviderId, voiceSamplesByName],
  );
  const narratorVoiceReady = !!voiceProviderId && !!narratorVoiceSampleDataUrl;

  function sampleForSpeaker(speakerName: string | null) {
    return speakerName === null
      ? narratorVoiceSampleDataUrl
      : voiceSamplesByName.get(speakerName) ?? '';
  }

  function clipCacheKey(speakerName: string | null, speechText: string) {
    return `${speakerName ?? narratorSpeakerCacheName}\u0000${speechText}`;
  }

  function phoneVoiceMessageSpeechText(message: MessageRecord) {
    const text = englishProcessingEnabled
      ? message.translatedText ?? message.originalText
      : message.originalText;
    return message.imageAttachments?.length && text === 'Attached image.'
      ? ''
      : dialogueSpeechText(text);
  }

  function phoneVoiceMessageSpeakerName(message: MessageRecord) {
    return message.phoneFrom?.trim() || message.speakerName?.trim() || '';
  }

  useEffect(() => {
    messagesRef.current = messages;
    for (const message of messages) {
      for (const clip of message.voiceClips ?? []) {
        if (clip.dataUrl && clip.text) {
          cacheClip(clipCacheKey(clip.speakerName, clip.text), clip.dataUrl);
        }
      }
    }
  }, [messages]);

  function stopPlayback() {
    const audio = audioRef.current;
    audioRef.current = null;
    audio?.pause();
    const resolvePlayback = playbackDoneRef.current;
    playbackDoneRef.current = null;
    resolvePlayback?.();
  }

  function cancelReadAloud() {
    readAloudTokenRef.current += 1;
    setReadAloudActive(false);
  }

  function stopDialogueVoice() {
    preloadTokenRef.current += 1;
    cancelReadAloud();
    stopPlayback();
    activeKeyRef.current = null;
    setActiveDialogueVoiceKey(null);
  }

  function finishKey(key: string) {
    if (activeKeyRef.current === key) {
      activeKeyRef.current = null;
      setActiveDialogueVoiceKey(null);
    }
  }

  function playClipAndWait(dataUrl: string) {
    stopPlayback();
    return new Promise<void>((resolve) => {
      const audio = new Audio(dataUrl);
      audioRef.current = audio;
      playbackDoneRef.current = resolve;
      const finish = () => {
        if (audioRef.current === audio) {
          audioRef.current = null;
        }
        if (playbackDoneRef.current === resolve) {
          playbackDoneRef.current = null;
        }
        resolve();
      };
      audio.onended = finish;
      audio.onerror = finish;
      void audio.play().catch(finish);
    });
  }

  function cacheClip(cacheKey: string, dataUrl: string) {
    clipCacheRef.current.set(cacheKey, dataUrl);
    while (clipCacheRef.current.size > dialogueVoiceCacheMaxEntries) {
      const oldestKey = clipCacheRef.current.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      clipCacheRef.current.delete(oldestKey);
    }
  }

  // Returns the clip data URL, or null when the speaker has no sample.
  // Throws when the ComfyUI generation fails.
  function storeVoiceClip(
    messageId: number | undefined,
    speakerName: string | null,
    speechText: string,
    dataUrl: string,
    filename: string | undefined,
    source: MessageVoiceClip['source'],
  ) {
    if (messageId === undefined) {
      return;
    }
    onVoiceClipGenerated(messageId, {
      speakerName,
      text: speechText,
      dataUrl,
      filename,
      source,
      createdAt: new Date().toISOString(),
    });
  }

  async function getOrGenerateClip(
    speakerName: string | null,
    speechText: string,
    options: { messageId?: number; source?: MessageVoiceClip['source'] } = {},
  ) {
    const sampleDataUrl = sampleForSpeaker(speakerName);
    if (!voiceProviderId || !sampleDataUrl || !speechText) {
      return null;
    }
    const cacheKey = clipCacheKey(speakerName, speechText);
    const cachedClip = clipCacheRef.current.get(cacheKey);
    if (cachedClip) {
      storeVoiceClip(options.messageId, speakerName, speechText, cachedClip, undefined, options.source);
      return cachedClip;
    }
    const storedClip = options.messageId !== undefined
      ? messagesRef.current
          .find((message) => message.id === options.messageId)
          ?.voiceClips
          ?.find((clip) =>
            clip.speakerName === speakerName &&
            clip.text === speechText &&
            (!options.source || clip.source === options.source)
          )
      : undefined;
    if (storedClip?.dataUrl) {
      cacheClip(cacheKey, storedClip.dataUrl);
      return storedClip.dataUrl;
    }
    const clips = await generateVoiceClip({
      providerId: voiceProviderId,
      speechText,
      sampleDataUrl,
    });
    const clipDataUrl = clips[0]?.dataUrl;
    if (!clipDataUrl) {
      throw new Error('No voice clip was returned.');
    }
    cacheClip(cacheKey, clipDataUrl);
    storeVoiceClip(options.messageId, speakerName, speechText, clipDataUrl, clips[0]?.filename, options.source);
    return clipDataUrl;
  }

  // Frees the ComfyUI voice model once a whole preload or read-aloud queue is
  // done. Single clicked clips keep it loaded; the next local LLM call frees it.
  async function unloadVoiceModelsAfterQueue() {
    if (!voiceProviderId) {
      return;
    }
    try {
      await unloadVoiceModels(voiceProviderId);
    } catch (error) {
      notifySystem(
        'warning',
        `ComfyUI voice unload failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function speakDialogue({ key, messageId, speakerName, text }: DialogueVoiceRequest) {
    if (activeKeyRef.current === key) {
      // Clicking the playing (or generating) quote again stops it.
      stopDialogueVoice();
      return;
    }
    const speechText = dialogueSpeechText(text);
    if (!voiceProviderId || !voiceSamplesByName.get(speakerName) || !speechText) {
      return;
    }

    cancelReadAloud();
    stopPlayback();
    activeKeyRef.current = key;
    setActiveDialogueVoiceKey(key);

    try {
      const clipDataUrl = await getOrGenerateClip(speakerName, speechText, {
        messageId,
        source: 'dialogue',
      });
      if (!clipDataUrl || activeKeyRef.current !== key) {
        return;
      }
      await playClipAndWait(clipDataUrl);
    } catch (error) {
      notifySystem(
        'error',
        `Voice playback for ${speakerName} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      finishKey(key);
    }
  }

  // Generates the clips for all character quotes of the given messages in
  // reading order, so later clicks play instantly from the cache.
  async function preloadDialogueVoices(messages: MessageRecord[], options: { unloadAfterQueue?: boolean } = {}) {
    if (!voiceProviderId) {
      return 0;
    }
    const token = ++preloadTokenRef.current;
    let generatedCount = 0;
    for (const message of messages) {
      for (const segment of dialogueVoiceMessageSegments(message, englishProcessingEnabled)) {
        if (preloadTokenRef.current !== token) {
          return generatedCount;
        }
        if (segment.speakerName === null || !voiceSamplesByName.has(segment.speakerName)) {
          continue;
        }
        const cacheKey = clipCacheKey(segment.speakerName, segment.text);
        const hadCachedClip = clipCacheRef.current.has(cacheKey);
        const hadStoredClip = message.voiceClips?.some((clip) =>
          clip.speakerName === segment.speakerName &&
          clip.text === segment.text &&
          clip.source === 'dialogue' &&
          !!clip.dataUrl
        );
        try {
          await getOrGenerateClip(segment.speakerName, segment.text, {
            messageId: message.id,
            source: 'dialogue',
          });
          if (!hadCachedClip && !hadStoredClip) {
            generatedCount += 1;
          }
        } catch (error) {
          notifySystem(
            'error',
            `Voice preload stopped: ${error instanceof Error ? error.message : String(error)}`,
          );
          return generatedCount;
        }
      }
    }
    if (generatedCount > 0 && preloadTokenRef.current === token && options.unloadAfterQueue !== false) {
      await unloadVoiceModelsAfterQueue();
    }
    return generatedCount;
  }

  // Generates phone voice-message clips after a turn when voice preloading is
  // enabled, so the Phone tab can play them instantly from the stored clip.
  async function preloadPhoneVoiceMessages(messages: MessageRecord[], options: { unloadAfterQueue?: boolean } = {}) {
    if (!voiceProviderId) {
      return 0;
    }
    const token = ++preloadTokenRef.current;
    let generatedCount = 0;
    for (const message of messages) {
      if (preloadTokenRef.current !== token) {
        return generatedCount;
      }
      if (!message.phoneVoiceMessage) {
        continue;
      }
      const speakerName = phoneVoiceMessageSpeakerName(message);
      const speechText = phoneVoiceMessageSpeechText(message);
      if (!speakerName || !voiceSamplesByName.has(speakerName) || !speechText) {
        continue;
      }
      const cacheKey = clipCacheKey(speakerName, speechText);
      const hadCachedClip = clipCacheRef.current.has(cacheKey);
      const hadStoredClip = message.voiceClips?.some((clip) =>
        clip.speakerName === speakerName &&
        clip.text === speechText &&
        clip.source === 'phone' &&
        !!clip.dataUrl
      );
      try {
        await getOrGenerateClip(speakerName, speechText, {
          messageId: message.id,
          source: 'phone',
        });
        if (!hadCachedClip && !hadStoredClip) {
          generatedCount += 1;
        }
      } catch (error) {
        notifySystem(
          'error',
          `Phone voice preload stopped: ${error instanceof Error ? error.message : String(error)}`,
        );
        return generatedCount;
      }
    }
    if (generatedCount > 0 && preloadTokenRef.current === token && options.unloadAfterQueue !== false) {
      await unloadVoiceModelsAfterQueue();
    }
    return generatedCount;
  }

  async function preloadTurnVoices(messages: MessageRecord[]) {
    const dialogueGeneratedCount = await preloadDialogueVoices(messages, { unloadAfterQueue: false });
    const phoneGeneratedCount = await preloadPhoneVoiceMessages(messages, { unloadAfterQueue: false });
    if (dialogueGeneratedCount + phoneGeneratedCount > 0) {
      await unloadVoiceModelsAfterQueue();
    }
  }

  // Reads the given messages aloud in order: narration with the narrator
  // voice, quotes with the matching character voice. Generation runs ahead
  // of playback, so the next clip is usually ready when the previous ends.
  async function readMessagesAloud(messages: MessageRecord[]) {
    if (!voiceProviderId) {
      return;
    }
    stopDialogueVoice();
    const token = ++readAloudTokenRef.current;
    const segments = messages
      .flatMap((message) => dialogueVoiceMessageSegments(message, englishProcessingEnabled))
      .filter((segment) => !!sampleForSpeaker(segment.speakerName));
    if (segments.length === 0) {
      return;
    }
    setReadAloudActive(true);
    let playback = Promise.resolve();
    let generatedCount = 0;
    for (const segment of segments) {
      if (readAloudTokenRef.current !== token) {
        break;
      }
      let clipDataUrl: string | null;
      try {
        const cached = clipCacheRef.current.has(clipCacheKey(segment.speakerName, segment.text));
        clipDataUrl = await getOrGenerateClip(segment.speakerName, segment.text, {
          messageId: segment.messageId,
          source: segment.speakerName === null ? 'narration' : 'dialogue',
        });
        if (!cached && clipDataUrl) {
          generatedCount += 1;
        }
      } catch (error) {
        notifySystem(
          'error',
          `Read-aloud stopped: ${error instanceof Error ? error.message : String(error)}`,
        );
        break;
      }
      if (!clipDataUrl || readAloudTokenRef.current !== token) {
        continue;
      }
      const nextClip = clipDataUrl;
      playback = playback.then(() =>
        readAloudTokenRef.current === token ? playClipAndWait(nextClip) : undefined,
      );
    }
    if (readAloudTokenRef.current === token) {
      if (generatedCount > 0) {
        await unloadVoiceModelsAfterQueue();
      }
      await playback;
      if (readAloudTokenRef.current === token) {
        setReadAloudActive(false);
      }
    } else {
      await playback;
    }
  }

  // Generates (or serves from cache) one clip for a phone voice message.
  // Returns null when the speaker has no sample or no voice provider exists.
  async function generateVoiceMessageClip(messageId: number, speakerName: string, text: string) {
    return getOrGenerateClip(speakerName, dialogueSpeechText(text), {
      messageId,
      source: 'phone',
    });
  }

  return {
    dialogueVoiceSpeakerNames,
    narratorVoiceReady,
    activeDialogueVoiceKey,
    readAloudActive,
    speakDialogue,
    preloadDialogueVoices,
    preloadPhoneVoiceMessages,
    preloadTurnVoices,
    readMessagesAloud,
    generateVoiceMessageClip,
    stopDialogueVoice,
  };
}
