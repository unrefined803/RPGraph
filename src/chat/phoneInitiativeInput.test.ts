import { describe, expect, it } from 'vitest';
import { defaultRpStorybookCharacterBanking } from '../nodes/rp-storybook/model';
import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord } from '../types';
import { phoneInitiativeCharacterContext } from './phoneInitiativeInput';

function character(id: string): StorybookCharacter {
  return { id, sourceId: id, name: id, label: id, kind: 'character', storybookNodeId: 'book',
    profile: { name: id, description: `${id} description`, personality: '', speechStyle: '', role: '' },
    phoneSettings: { wallpaperId: '' }, banking: defaultRpStorybookCharacterBanking(),
    apps: {
      whatsup: { accountId: `${id}:phone`, enabled: true, bio: '' },
      fotogram: { accountId: `${id}:photo`, enabled: true, profileName: `${id}.photos`, bio: '' },
      onlyfriends: { accountId: `${id}:private`, enabled: false, profileName: 'disabled', bio: '' },
      matchme: { accountId: `${id}:dating`, enabled: true, profileName: `${id}.dating`, bio: '' },
    },
    social: { fotogramUsername: '', onlyfriendsUsername: '', plotTwist: {
      name: id, age: 25, bio: 'Public bio', interests: '', photoIds: [], decisions: {},
    } },
  };
}

function data(owner: StorybookCharacter, characters: StorybookCharacter[], messages: MessageRecord[] = []) {
  return phoneInitiativeCharacterContext(owner, characters, messages);
}

describe('phone initiative character context', () => {
  it('includes every relationship with only its connected enabled accounts and no media', () => {
    const owner = character('Jack');
    const sarah = character('Sarah');
    owner.relationships = [
      { characterId: 'Sarah', description: 'Sister', apps: { whatsup: true, onlyfriends: true } },
      { characterId: 'Helga', description: 'Colleague', apps: { fotogram: true } },
      { characterId: 'missing', description: 'Old friend', apps: { whatsup: true } },
    ];
    sarah.hiddenAgency = 'SECRET';
    const result = data(owner, [owner, sarah, character('Helga')]);
    expect(result).toContain('Description: Jack description');
    expect(result).toContain('- Sarah — Sister | WhatsUp');
    expect(result).toContain('- Helga — Colleague | Fotogram: Helga.photos');
    for (const excluded of ['SECRET', 'disabled', 'Old friend', 'accountId', 'Sarah:phone', 'Helga:photo', '{', '[]']) {
      expect(result).not.toContain(excluded);
    }
  });

  it('uses current MatchMe decisions and distinguishes likes from active matches', () => {
    const owner = character('Jack');
    const sarah = character('Sarah');
    const helga = character('Helga');
    owner.social.plotTwist!.decisions = { 'Sarah:dating': 'pass', 'Helga:dating': 'pass' };
    owner.relationships = [{ characterId: 'Sarah', description: 'Date', apps: { matchme: true } }];
    const messages: MessageRecord[] = [{ id: 1, role: 'user', originalText: '', includeInHistory: true,
      matchMeAction: { from: 'Jack:dating', to: 'Sarah:dating', decision: 'like' } }];
    const result = data(owner, [owner, sarah, helga], messages);
    expect(result).toContain('MatchMe likes given: Sarah.dating (like, matched)');
    expect(result).not.toContain('MatchMe other active matches:');
    expect(result).not.toContain('Helga.dating');
    expect(result).not.toContain('Sarah:dating');
    owner.relationships = [];
    expect(data(owner, [owner, sarah, helga], messages)).toContain('Sarah.dating (like, unmatched)');
  });

  it('handles missing selection and empty contacts without inventing entries', () => {
    expect(phoneInitiativeCharacterContext(undefined, [], [])).toBe('');
    const owner = character('Jack');
    expect(data(owner, [owner])).not.toContain('Contacts & relationships:');
    expect(data(owner, [owner])).not.toContain('MatchMe');
  });
});
