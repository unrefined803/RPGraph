import { useEffect } from 'react';
import type { StorybookCharacter } from '../storybook/runtime';

/** Migrate loaded legacy profiles before the next interactive task, without an LLM run. */
export function useMatchMeMigration(characters: StorybookCharacter[], isRunning: boolean, migrate: (owner: StorybookCharacter) => void) {
  useEffect(() => {
    if (isRunning) return;
    for (const owner of characters) {
      if (owner.social.plotTwist && owner.social.plotTwist.historyVersion !== 1) migrate(owner);
    }
  }, [characters, isRunning, migrate]);
}
