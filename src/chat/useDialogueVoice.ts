import { useMemo, useRef, useState } from 'react';
import { isComfyVoiceConnection } from '../comfy/connectionRole';
import type { StorybookCharacter } from '../storybook/runtime';
import type { ConnectionPreset } from '../types';

const dialogueVoiceCacheMaxEntries = 24;

export type DialogueVoiceRequest = {
  key: string;
  speakerName: string;
  text: string;
};

function speechTextFromDialoguePart(text: string) {
  return text
    .trim()
    .replace(/^["„“”«»‹›''']+/, '')
    .replace(/["„“”«»‹›''']+$/, '')
    .replace(/\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Click-to-speak for highlighted dialogue quotes in the chat: generates a voice
// clip from the speaker's stored MP3 sample and plays it back.
export function useDialogueVoice({
  storyCharacters,
  connections,
  generateVoiceClip,
  notifySystem,
}: {
  storyCharacters: StorybookCharacter[];
  connections: ConnectionPreset[];
  generateVoiceClip: (request: {
    providerId: string;
    speechText: string;
    sampleDataUrl: string;
  }) => Promise<Array<{ dataUrl: string; filename: string }>>;
  notifySystem: (level: 'info' | 'warning' | 'error', text: string) => void;
}) {
  const [activeDialogueVoiceKey, setActiveDialogueVoiceKey] = useState<string | null>(null);
  const activeKeyRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clipCacheRef = useRef(new Map<string, string>());

  const voiceProviderId = useMemo(
    () => connections.find(isComfyVoiceConnection)?.id ?? '',
    [connections],
  );
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

  function stopPlayback() {
    const audio = audioRef.current;
    audioRef.current = null;
    audio?.pause();
  }

  function finishKey(key: string) {
    if (activeKeyRef.current === key) {
      activeKeyRef.current = null;
      setActiveDialogueVoiceKey(null);
    }
  }

  function playClip(key: string, dataUrl: string) {
    stopPlayback();
    const audio = new Audio(dataUrl);
    audioRef.current = audio;
    audio.onended = () => finishKey(key);
    audio.onerror = () => finishKey(key);
    void audio.play().catch(() => finishKey(key));
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

  async function speakDialogue({ key, speakerName, text }: DialogueVoiceRequest) {
    if (activeKeyRef.current === key) {
      // Clicking the playing (or generating) quote again stops it.
      stopPlayback();
      finishKey(key);
      return;
    }
    const sampleDataUrl = voiceSamplesByName.get(speakerName);
    const speechText = speechTextFromDialoguePart(text);
    if (!voiceProviderId || !sampleDataUrl || !speechText) {
      return;
    }

    stopPlayback();
    activeKeyRef.current = key;
    setActiveDialogueVoiceKey(key);

    const cacheKey = `${speakerName}\u0000${speechText}`;
    const cachedClip = clipCacheRef.current.get(cacheKey);
    if (cachedClip) {
      playClip(key, cachedClip);
      return;
    }

    try {
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
      if (activeKeyRef.current !== key) {
        return;
      }
      playClip(key, clipDataUrl);
    } catch (error) {
      notifySystem(
        'error',
        `Voice playback for ${speakerName} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      finishKey(key);
    }
  }

  return {
    dialogueVoiceSpeakerNames,
    activeDialogueVoiceKey,
    speakDialogue,
  };
}
