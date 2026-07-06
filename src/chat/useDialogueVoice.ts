import { useMemo, useRef, useState } from 'react';
import { isComfyVoiceConnection } from '../comfy/connectionRole';
import type { StorybookCharacter } from '../storybook/runtime';
import type { ConnectionPreset, MessageRecord } from '../types';
import {
  dialogueSpeechText,
  dialogueVoiceMessageSegments,
} from './dialogueVoiceSegments';

const dialogueVoiceCacheMaxEntries = 64;
// Reserved cache name for the narrator; the NUL byte cannot appear in character names.
const narratorSpeakerCacheName = '\u0000narrator';

export type DialogueVoiceRequest = {
  key: string;
  speakerName: string;
  text: string;
};

// Voice playback for the chat: click-to-speak on highlighted dialogue quotes,
// plus queue-based preloading and sequential read-aloud of whole messages.
// Clips are generated from the stored MP3 samples via the ComfyUI voice provider.
export function useDialogueVoice({
  storyCharacters,
  connections,
  englishProcessingEnabled,
  generateVoiceClip,
  notifySystem,
}: {
  storyCharacters: StorybookCharacter[];
  connections: ConnectionPreset[];
  englishProcessingEnabled: boolean;
  generateVoiceClip: (request: {
    providerId: string;
    speechText: string;
    sampleDataUrl: string;
  }) => Promise<Array<{ dataUrl: string; filename: string }>>;
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
  async function getOrGenerateClip(speakerName: string | null, speechText: string) {
    const sampleDataUrl = sampleForSpeaker(speakerName);
    if (!voiceProviderId || !sampleDataUrl || !speechText) {
      return null;
    }
    const cacheKey = clipCacheKey(speakerName, speechText);
    const cachedClip = clipCacheRef.current.get(cacheKey);
    if (cachedClip) {
      return cachedClip;
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
    return clipDataUrl;
  }

  async function speakDialogue({ key, speakerName, text }: DialogueVoiceRequest) {
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
      const clipDataUrl = await getOrGenerateClip(speakerName, speechText);
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
  async function preloadDialogueVoices(messages: MessageRecord[]) {
    if (!voiceProviderId) {
      return;
    }
    const token = ++preloadTokenRef.current;
    const queuedKeys = new Set<string>();
    for (const message of messages) {
      for (const segment of dialogueVoiceMessageSegments(message, englishProcessingEnabled)) {
        if (preloadTokenRef.current !== token) {
          return;
        }
        if (segment.speakerName === null || !voiceSamplesByName.has(segment.speakerName)) {
          continue;
        }
        const cacheKey = clipCacheKey(segment.speakerName, segment.text);
        if (queuedKeys.has(cacheKey) || clipCacheRef.current.has(cacheKey)) {
          continue;
        }
        queuedKeys.add(cacheKey);
        try {
          await getOrGenerateClip(segment.speakerName, segment.text);
        } catch (error) {
          notifySystem(
            'error',
            `Voice preload stopped: ${error instanceof Error ? error.message : String(error)}`,
          );
          return;
        }
      }
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
    for (const segment of segments) {
      if (readAloudTokenRef.current !== token) {
        break;
      }
      let clipDataUrl: string | null;
      try {
        clipDataUrl = await getOrGenerateClip(segment.speakerName, segment.text);
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
    await playback;
    if (readAloudTokenRef.current === token) {
      setReadAloudActive(false);
    }
  }

  return {
    dialogueVoiceSpeakerNames,
    narratorVoiceReady,
    activeDialogueVoiceKey,
    readAloudActive,
    speakDialogue,
    preloadDialogueVoices,
    readMessagesAloud,
    stopDialogueVoice,
  };
}
