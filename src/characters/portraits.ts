import type { Character, CharacterAppAccount, CustomPortraits, PortraitId } from './character';
import type { RpStorybookCharacterProfileImage } from '../nodes/rp-storybook/model';
import { portraitDataUrl } from './portrait';

export const portraitIds = ['character', 'custom1', 'custom2'] as const;
export const portraitLabels: Record<PortraitId, string> = {
  character: 'Character Portrait', custom1: 'Custom Portrait 1', custom2: 'Custom Portrait 2',
};
export type PortraitOwner = {
  profileImage?: RpStorybookCharacterProfileImage;
  customPortraits?: CustomPortraits;
  images?: Array<{ id: string; dataUrl: string; width?: number; height?: number }>;
  apps?: Character['apps'];
};
export function characterPortrait(owner: PortraitOwner | undefined, id: PortraitId = 'character') {
  return id === 'character' ? owner?.profileImage : owner?.customPortraits?.[id];
}
export function characterPortraitUrl(owner: PortraitOwner | undefined, id: PortraitId = 'character') {
  const portrait = characterPortrait(owner, id);
  const image = owner?.images?.find((entry) => entry.id === portrait?.imageId);
  return image ? portraitDataUrl(image, portrait?.crop) : owner?.images ? undefined : portrait?.dataUrl || undefined;
}

/** Every app resolves the same three slots. Privacy mode affects names only. */
export function accountPortraitUrl(owner: PortraitOwner | undefined, account?: Pick<CharacterAppAccount, 'portraitId'>) {
  return characterPortraitUrl(owner, account?.portraitId ?? 'character');
}

/** Clearing a custom slot returns its app selections to the main portrait. */
export function withPortraitSlot<T extends PortraitOwner>(owner: T, id: PortraitId, portrait?: RpStorybookCharacterProfileImage): T {
  if (id !== 'character' && portrait && !owner.profileImage) throw new Error('Create the character portrait first.');
  if (id === 'character' && !portrait && Object.values(owner.customPortraits ?? {}).length) {
    throw new Error('Clear the custom portraits before clearing the character portrait.');
  }
  const customPortraits = { ...owner.customPortraits };
  if (id !== 'character') {
    if (portrait) customPortraits[id] = portrait;
    else delete customPortraits[id];
  }
  const reset = <A extends { portraitId?: PortraitId }>(account: A): A =>
    !portrait && account.portraitId === id ? { ...account, portraitId: 'character' } : account;
  const apps = owner.apps && Object.fromEntries(Object.entries(owner.apps).map(([key, account]) => [key,
    { ...reset(account), ...(key === 'whatsup' && owner.apps?.whatsup?.alias ? { alias: reset(owner.apps.whatsup.alias) } : {}) },
  ]));
  return { ...owner, ...(id === 'character' ? { profileImage: portrait } : { customPortraits }), ...(apps ? { apps } : {}) };
}
