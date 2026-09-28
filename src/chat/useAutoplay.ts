import { useCallback, useRef } from 'react';
import {
  escalationPromptSlot,
  localActivityPromptSlot,
  remoteActivityPromptSlot,
  storyFlowPromptSlot,
} from './messageFormats';

export type AutoplayMode = 'local-activity' | 'remote-activity' | 'story-flow' | 'escalation';

export type AutoplayRunRequest = {
  playerCharacterName: string;
  promptSlot: number;
};

type UseAutoplayOptions = {
  isRunning: boolean;
  runAutoplay: (request: AutoplayRunRequest) => Promise<boolean>;
};

const runnableModeSlots: Record<AutoplayMode, number> = {
  'local-activity': localActivityPromptSlot,
  'remote-activity': remoteActivityPromptSlot,
  'story-flow': storyFlowPromptSlot,
  'escalation': escalationPromptSlot,
};

/** Autoplay modes run only when explicitly requested from the chat menu. */
export function useAutoplay({ isRunning, runAutoplay }: UseAutoplayOptions) {
  const runActiveRef = useRef(false);
  const runModeNow = useCallback((mode: AutoplayMode, playerCharacterName: string) => {
    if (isRunning || runActiveRef.current || !playerCharacterName.trim()) return;
    runActiveRef.current = true;
    void runAutoplay({ playerCharacterName, promptSlot: runnableModeSlots[mode] }).finally(() => {
      runActiveRef.current = false;
    });
  }, [isRunning, runAutoplay]);

  return { runModeNow };
}
