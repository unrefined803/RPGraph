import { describe, expect, it } from 'vitest';
import { bindAccountLinks, parseAccountLinks } from './accountLinks';
import { appCharactersFromRegistry } from '../characters/appRuntime';
import { buildCharacterRegistry, type CharacterRegistryEntry } from '../characters/registry';
import type { Character } from '../characters/character';
import fixture from '../characters/fixtures/stage4-npc.json';
import { captureNpcParticipants, npcReferencesFromMessages } from '../characters/npcParticipants';
import { bankingRecipientNamesForCharacter } from './bankTransfers';
import { normalizePhoneName } from './phoneMessages';
import type { MessageRecord } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';

function entry(id: string, name: string, tier: CharacterRegistryEntry['tier'] = 'user'): CharacterRegistryEntry {
  const character = structuredClone(fixture.character) as Character;
  character.id = id;
  character.name = name;
  character.profileImage = {
    imageId: character.images[0].id,
    dataUrl: character.images[0].dataUrl,
    crop: { x: 0, y: 0, size: 100 },
  };
  return { character, tier, source: id };
}

function setup() {
  const entries: CharacterRegistryEntry[] = [
    entry('player', 'Alex Player', 'storybook'),
    entry('npc1', 'Evelyn Reed', 'user'), // e.g. from NPC Library
    entry('npc2', 'Marcus Cole', 'user'),
  ];
  const appCharacters = appCharactersFromRegistry(buildCharacterRegistry(entries));
  const storyCharacters = appCharacters.filter((c) => c.sourceId === 'player');
  return { entries, appCharacters, storyCharacters };
}

describe('banking account links and recipients', () => {
  it('parses both @bank: and @banking: tokens for library NPCs and playable characters', () => {
    const { appCharacters } = setup();
    const text = 'Transfer to @bank:Evelyn Reed or @banking:Marcus Cole, or me @bank:Alex Player.';
    const links = parseAccountLinks(text, appCharacters);

    expect(links).toHaveLength(3);
    expect(links[0]).toMatchObject({
      app: 'banking',
      token: '@bank:Evelyn Reed',
      characterId: 'npc1',
      name: 'Evelyn Reed',
    });
    expect(links[1]).toMatchObject({
      app: 'banking',
      token: '@banking:Marcus Cole',
      characterId: 'npc2',
      name: 'Marcus Cole',
    });
    expect(links[2]).toMatchObject({
      app: 'banking',
      token: '@bank:Alex Player',
      characterId: 'player',
      name: 'Alex Player',
    });
  });

  it('pins NPC participants when a message contains a banking link', () => {
    const { appCharacters, entries } = setup();
    const text = 'Please send the fee to @bank:Evelyn Reed';
    const message: MessageRecord = {
      id: 10,
      role: 'user',
      originalText: text,
      accountLinks: bindAccountLinks(text, appCharacters),
    };

    const references = npcReferencesFromMessages([message]);
    expect(references).toContainEqual({ kind: 'character', id: 'npc1' });

    const archive = captureNpcParticipants({}, entries, references);
    expect(Object.keys(archive)).toContain('npc1');
  });

  it('resolves library NPC recipients in Send Money with their avatar profile image', () => {
    const { appCharacters, storyCharacters } = setup();
    const player = storyCharacters[0];

    // Initially, only storyCharacters are in recipientNames
    const initialRecipients = bankingRecipientNamesForCharacter(
      player,
      storyCharacters,
      [],
      [],
    );
    expect(initialRecipients).not.toContain('Evelyn Reed');

    // After Evelyn Reed is added as a banking contact:
    const contactNames = ['Evelyn Reed'];
    const recipientNames = bankingRecipientNamesForCharacter(
      player,
      storyCharacters,
      [],
      contactNames,
    );
    expect(recipientNames).toContain('Evelyn Reed');

    // In PhoneBankingScreen, recipients are matched against appCharacters (including library NPCs)
    const resolvedRecipients = recipientNames
      .map((name) => ({
        key: normalizePhoneName(name),
        name,
        character: appCharacters.find(
          (c) => normalizePhoneName(c.name) === normalizePhoneName(name),
        ),
      }))
      .filter((entry): entry is typeof entry & { character: StorybookCharacter } => !!entry.character);

    const evelynEntry = resolvedRecipients.find((entry) => entry.name === 'Evelyn Reed');
    expect(evelynEntry).toBeDefined();
    expect(evelynEntry?.character.profileImage?.dataUrl).toMatch(/^data:image\//);
  });

  it('filters out unknown names so non-existent characters do not appear in Send Money', () => {
    const { appCharacters, storyCharacters } = setup();
    const player = storyCharacters[0];

    // Pretend a bogus contact name is in saved contact names
    const contactNames = ['Ghost Unknown', 'Evelyn Reed'];
    const recipientNames = bankingRecipientNamesForCharacter(
      player,
      storyCharacters,
      [],
      contactNames,
    );

    const resolvedRecipients = recipientNames
      .map((name) => ({
        key: normalizePhoneName(name),
        name,
        character: appCharacters.find(
          (c) => normalizePhoneName(c.name) === normalizePhoneName(name),
        ),
      }))
      .filter((entry): entry is typeof entry & { character: StorybookCharacter } => !!entry.character);

    expect(resolvedRecipients.some((r) => r.name === 'Ghost Unknown')).toBe(false);
    expect(resolvedRecipients.some((r) => r.name === 'Evelyn Reed')).toBe(true);
  });

  it('validates candidates when adding a recipient in Add Recipient form', () => {
    const { appCharacters, storyCharacters } = setup();
    const player = storyCharacters[0];

    const matchCandidate = (input: string) => {
      const trimmed = input.trim().replace(/\s+/g, ' ');
      return trimmed
        ? appCharacters.find(
            (candidate) =>
              normalizePhoneName(candidate.name) === normalizePhoneName(trimmed) &&
              normalizePhoneName(candidate.name) !== normalizePhoneName(player.name),
          )
        : undefined;
    };

    expect(matchCandidate('Evelyn Reed')).toBeDefined();
    expect(matchCandidate('evelyn reed')?.id).toBe('npc1');
    expect(matchCandidate('Alex Player')).toBeUndefined(); // Cannot add self
    expect(matchCandidate('NonExistent Person')).toBeUndefined();
  });

  it('filters candidates within current list for 1-2 letters and expands to NPC library at 3+ letters', () => {
    const { appCharacters, storyCharacters } = setup();
    const player = storyCharacters[0];
    const playableStoryCharacters = storyCharacters.filter(
      (c) => normalizePhoneName(c.name) !== normalizePhoneName(player.name),
    );

    const getCandidates = (query: string, savedContactNames: string[] = []) => {
      const recipientNames = bankingRecipientNamesForCharacter(
        player,
        storyCharacters,
        [],
        savedContactNames,
      );
      const currentListCharacters = recipientNames
        .map((name) => appCharacters.find((c) => normalizePhoneName(c.name) === normalizePhoneName(name)))
        .filter((c): c is StorybookCharacter => !!c);

      const trimmed = query.trim().toLowerCase();
      if (!trimmed) {
        return currentListCharacters.slice(0, 9);
      }
      if (trimmed.length < 3) {
        return currentListCharacters
          .filter((c) => {
            const lowerName = c.name.toLowerCase();
            const nameParts = lowerName.split(/\s+/);
            return lowerName.includes(trimmed) || nameParts.some((part) => part.startsWith(trimmed));
          })
          .slice(0, 9);
      }
      return appCharacters
        .filter((c) => {
          if (normalizePhoneName(c.name) === normalizePhoneName(player.name)) return false;
          const lowerName = c.name.toLowerCase();
          const nameParts = lowerName.split(/\s+/);
          return lowerName.includes(trimmed) || nameParts.some((part) => part.startsWith(trimmed));
        })
        .slice(0, 9);
    };

    // When empty: only current list characters appear (max 9)
    expect(getCandidates('')).toEqual(playableStoryCharacters.slice(0, 9));

    // When 1-2 characters: only current list is filtered; NPC library characters not in list are NOT shown
    expect(getCandidates('e').map((c) => c.name)).not.toContain('Evelyn Reed');
    expect(getCandidates('ev').map((c) => c.name)).not.toContain('Evelyn Reed');

    // When 3+ characters: NPC library is searched, so Evelyn Reed appears
    expect(getCandidates('eve').map((c) => c.name)).toContain('Evelyn Reed');
    expect(getCandidates('mar').map((c) => c.name)).toContain('Marcus Cole');

    // If Evelyn Reed has been added to contacts, she is in current list and appears even at 1 letter:
    expect(getCandidates('e', ['Evelyn Reed']).map((c) => c.name)).toContain('Evelyn Reed');

    // Player themselves is never included
    expect(getCandidates('alex')).toEqual([]);
  });
});
