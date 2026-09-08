import { readFileSync } from 'node:fs';
import { storyCharactersFromNodes } from '../storybook/runtime';
import { describe, expect, it } from 'vitest';
import { automaticAccountLinkGrants, bindAccountLinks, parseAccountLinks, resolveAccountLink, shieldTranslationAccountLinks, restoreTranslationAccountLinks } from './accountLinks';
import { appCharactersFromRegistry } from '../characters/appRuntime';
import { buildCharacterRegistry, type CharacterRegistryEntry } from '../characters/registry';
import type { Character } from '../characters/character';
import fixture from '../characters/fixtures/stage4-npc.json';
import { captureNpcParticipants, npcReferencesFromMessages, npcSnapshotEntries } from '../characters/npcParticipants';
import { buildSocialDirectory, normalizeSocialConnectionsByCharacter, socialConnectionIds, withSocialConnectionAdded } from './socialDirectory';
import { phoneCharacterAvatarDataUrl, phoneRuntimeCharactersFromMessages } from './phoneCharacters';
import { resolveWhatsUpRecipient } from '../characters/messageIdentity';
import { resolveSocialMessageIdentity, validateSocialMessengerAccounts } from './socialMessageValidation';
import { incomingMatchMeMessage, matchMeLikePolicy, matchMeState } from './matchMe';
import { parseSocialDirectMessageOutput } from './socialMedia';
import { appStateFromSessionV2, sessionV2FromCurrentState } from '../data-management/sessionStore';
import { isRpgraphSessionV2 } from '../data-management/validation';
import { currentWorkflowFormatVersion } from '../workflow/version';
import type { MessageRecord, TurnRecord, WorkflowFile } from '../types';

const now = '2026-09-08T12:00:00Z';
function entry(id: string, name: string, tier: CharacterRegistryEntry['tier'] = 'user'): CharacterRegistryEntry {
  const character = structuredClone(fixture.character) as Character;
  character.id = id; character.name = name;
  for (const [app, account] of Object.entries(character.apps!)) {
    account.accountId = `${id}:${app}`;
    account.username = `${id}.${app}`;
    account.displayName = `${name} Profile`;
  }
  character.apps!.whatsup = { accountId: `${id}:whatsup`, enabled: true, username: `${id}.phone`, displayName: `${name} Phone`, bio: '' };
  return { character, tier, source: id };
}
function setup() {
  const entries = [entry('player', 'Alex Player', 'storybook'), entry('nova', 'Nova Vale'), entry('third', 'Third Person')];
  return { entries, characters: appCharactersFromRegistry(buildCharacterRegistry(entries)) };
}
function direct(characters = setup().characters, text = 'Here: @whatsup:Third Person and @fotogram:player.fotogram'): MessageRecord {
  return { id: 1, role: 'user', originalText: text, socialDirectMessage: {
    app: 'fotogram', messageId: 'dm', from: 'Alex Player', fromHandle: 'player.fotogram', fromAccountId: 'player:fotogram',
    to: 'Nova Vale', toHandle: 'nova.fotogram', toAccountId: 'nova:fotogram', text, sentAt: now,
    accountLinks: bindAccountLinks(text, characters),
  } };
}

describe('inline account links', () => {
  it.each(['workflow.default_v27.json', 'workflow.default_planning_v27.json'])('resolves the reported Fotogram messages with standard WhatsUp accounts in %s', (file) => {
    const workflow = JSON.parse(readFileSync(file, 'utf8')) as WorkflowFile;
    const characters = structuredClone(storyCharactersFromNodes(workflow.nodes));
    for (const [text, name] of [
      ['espen has a new number @whatsup:Espen Harper', 'Espen Harper'],
      ["Haha, 'for studies' my ass. 😂 You just want to flirt with him! Here: @whatsup:Jack Carter", 'Jack Carter'],
    ]) {
      const character = characters.find((entry) => entry.name === name)!;
      expect(character.apps?.whatsup).toMatchObject({
        accountId: `character:${character.sourceId}:whatsup`,
        enabled: true,
        username: name,
        displayName: name,
      });
      // Existing messages from the broken implementation persisted empty bindings.
      const links = parseAccountLinks(text, characters, []);
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ token: `@whatsup:${name}`, characterId: character.sourceId,
        accountId: resolveWhatsUpRecipient(characters, [], name).accountId });
      expect(resolveAccountLink('whatsup', links[0].accountId, characters)?.characterId).toBe(character.sourceId);
      const saved = withSocialConnectionAdded({}, characters[0].sourceId, 'whatsup', links[0].accountId);
      expect(socialConnectionIds(saved, characters[0].id, 'whatsup', characters)).toContain(links[0].accountId);
    }
    const mixed = '@fotogram:Espen Harper and @whatsup:Jack Carter';
    const partial = bindAccountLinks('@fotogram:Espen Harper', characters);
    expect(parseAccountLinks(mixed, characters, partial)).toHaveLength(2);
    const jack = characters.find((entry) => entry.name === 'Jack Carter')!;
    jack.libraryNpc = true;
    expect(parseAccountLinks('@whatsup:Jack Carter', characters, [])).toHaveLength(1);
    jack.apps!.whatsup = { accountId: 'disabled-phone', enabled: false, username: '', displayName: 'Jack Carter', bio: '' };
    expect(parseAccountLinks('@whatsup:Jack Carter', characters, [])).toEqual([]);
  });

  it('resolves complete names, app display names, usernames and IDs without eating prose or punctuation', () => {
    const { characters } = setup();
    const text = 'Try @fotogram:Nova Vale tomorrow, @whatsapp:Third Person Phone! Or @Fotogram:nova.fotogram. @matchme:nova:matchme';
    const links = parseAccountLinks(text, characters);
    expect(links.map((link) => link.token)).toEqual(['@fotogram:Nova Vale', '@whatsapp:Third Person Phone', '@Fotogram:nova.fotogram', '@matchme:nova:matchme']);
    expect(links.map((link) => text.slice(link.start, link.end))).toEqual(links.map((link) => link.token));
    expect(links[1].app).toBe('whatsup');
    expect(parseAccountLinks('@photogram:@nova.fotogram', characters)[0].accountId).toBe('nova:fotogram');
    expect(parseAccountLinks('@fotogram:Nova  Vale, hello', characters)[0].characterId).toBe('nova');
    expect(parseAccountLinks('@fotogram:Nova @fotogram:nova.fotogram.extra x@fotogram:Nova Vale', characters)).toEqual([]);
  });

  it('rejects missing, disabled, wrong-app and ambiguous identities, including name/handle collisions', () => {
    const { characters } = setup();
    for (const text of ['@fotogram:Missing Name', '@onlyfriends:Nova Vale', '@fotogram:nova.phone']) {
      expect(parseAccountLinks(text, characters)).toEqual([]);
    }
    const duplicate = structuredClone(characters[2]); duplicate.name = 'Nova Vale';
    expect(parseAccountLinks('@fotogram:Nova Vale', [...characters, duplicate])).toEqual([]);
    characters[2].apps!.fotogram!.displayName = 'nova.fotogram';
    expect(parseAccountLinks('@fotogram:nova.fotogram', characters)).toEqual([]);
    expect(parseAccountLinks('@fotogram:nova:fotogram', characters)).toHaveLength(1);
    characters[1].apps!.fotogram!.enabled = false;
    expect(parseAccountLinks('@fotogram:nova:fotogram', characters)).toEqual([]);
  });

  it('pins shared third parties and keeps bound text attached to the same account after rename and promotion', () => {
    const { characters, entries } = setup();
    const message = direct(characters);
    const archive = captureNpcParticipants({}, entries, npcReferencesFromMessages([message]));
    expect(Object.keys(archive).sort()).toEqual(['nova', 'third']);
    const promoted = structuredClone(entries[2]); promoted.tier = 'storybook';
    promoted.character.name = 'Renamed Person'; promoted.character.apps!.whatsup!.displayName = 'New Phone Name';
    const restored = appCharactersFromRegistry(buildCharacterRegistry([entries[0], promoted, ...npcSnapshotEntries(archive)]));
    const binding = message.socialDirectMessage!.accountLinks!;
    expect(parseAccountLinks(message.socialDirectMessage!.text, restored, binding)[0]).toMatchObject({ characterId: 'third', accountId: 'third:whatsup' });
    expect(parseAccountLinks(message.socialDirectMessage!.text, restored.filter((entry) => entry.sourceId !== 'third'), binding).map((link) => link.characterId)).toEqual(['player']);
  });

  it('automatically grants contacts to simulated recipients, requires clicks for received player links and ignores drafts', () => {
    const { characters } = setup();
    const message = direct(characters);
    const grants = automaticAccountLinkGrants([message], characters);
    expect(grants.map(({ owner, link }) => [owner.sourceId, link.characterId])).toEqual([['nova', 'third'], ['nova', 'player']]);
    expect(automaticAccountLinkGrants([], characters)).toEqual([]);
    const reply: MessageRecord = { ...message, role: 'output', socialDirectMessage: { ...message.socialDirectMessage!, toAccountId: 'player:fotogram' } };
    expect(automaticAccountLinkGrants([reply], characters)).toEqual([]);
    expect(automaticAccountLinkGrants([{ ...message, role: 'output' }], characters)).toHaveLength(2);
    const self = direct(characters, '@fotogram:nova.fotogram');
    expect(automaticAccountLinkGrants([self], characters)).toEqual([]);
  });

  it('stores phone grants in the existing connections and projects NPC contacts without fake messages', () => {
    const { characters } = setup();
    const target = resolveAccountLink('whatsup', 'Third Person', characters)!;
    const saved = withSocialConnectionAdded({}, 'player', 'whatsup', target.accountId);
    expect(withSocialConnectionAdded(saved, 'player', 'whatsup', target.accountId)).toBe(saved);
    const restored = normalizeSocialConnectionsByCharacter(JSON.parse(JSON.stringify(saved)));
    expect(socialConnectionIds(restored, characters[0].id, 'whatsup', characters)).toEqual(['third:whatsup']);
    const contacts = phoneRuntimeCharactersFromMessages(characters, [], new Set(restored.player.whatsup));
    expect(contacts.map((entry) => entry.sourceId)).toEqual(['player', 'third']);
    expect(phoneRuntimeCharactersFromMessages(characters, []).map((entry) => entry.sourceId)).toEqual(['player']);
    expect(buildSocialDirectory({ storyCharacters: characters, messages: [] }).users).toHaveLength(3);
  });

  it('registers a library NPC phone identity and reuses its Fotogram avatar after sharing', () => {
    const player = entry('player', 'Alex Player', 'storybook');
    const library = entry('library', 'Library Person');
    delete library.character.apps!.whatsup;
    delete library.character.profileImage;
    const characters = appCharactersFromRegistry(buildCharacterRegistry([player, library]));
    const npc = characters.find((character) => character.sourceId === 'library')!;
    const target = parseAccountLinks('@whatsup:Library Person', characters)[0];

    expect(target).toMatchObject({
      characterId: 'library',
      accountId: 'character:library:whatsup',
    });
    expect(phoneRuntimeCharactersFromMessages(characters, [])).not.toContain(npc);
    expect(phoneRuntimeCharactersFromMessages(characters, [], new Set([target.accountId]))).toContain(npc);
    expect(phoneCharacterAvatarDataUrl(npc)).toBe(fixture.character.images[0].dataUrl);
  });

  it('accepts app display names for phone/social recipients and enforces the same bound MatchMe accounts', () => {
    const { characters } = setup();
    expect(resolveWhatsUpRecipient(characters, [], 'Nova Vale Phone').accountId).toBe('nova:whatsup');
    expect(resolveSocialMessageIdentity({ characters, messages: [], app: 'fotogram', identity: 'Nova Vale Profile' }).accountId).toBe('nova:fotogram');
    const match = matchMeLikePolicy('player:matchme', 'nova:matchme', matchMeState(characters, []), now)!;
    const history: MessageRecord[] = [{ id: 2, role: 'user', originalText: '', matchMeMatch: match }];
    const outgoing = incomingMatchMeMessage('player:matchme', 'nova:matchme', 'Your account?', matchMeState(characters, history), 'q', now)!;
    const text = JSON.stringify({ matchMeApp: [{ from: 'Nova Vale Profile', to: 'player.matchme', message: '@fotogram:nova.fotogram' }] });
    expect(validateSocialMessengerAccounts({ text, characters, messages: history, directMessage: outgoing }).issues).toEqual([]);
    expect(parseSocialDirectMessageOutput(text, outgoing, now, characters).message).toMatchObject({ fromAccountId: 'nova:matchme', toAccountId: 'player:matchme' });
    const wrong = text.replace('Nova Vale Profile', 'Third Person Profile');
    expect(validateSocialMessengerAccounts({ text: wrong, characters, messages: history, directMessage: outgoing }).issues.length).toBeGreaterThan(0);
    expect(parseSocialDirectMessageOutput(wrong, outgoing, now, characters).message).toBeUndefined();
  });

  it('round-trips bound phone/social links and grants in RP and rejects malformed binding metadata', () => {
    const { characters } = setup();
    const message = direct(characters);
    const phone: MessageRecord = { id: 2, role: 'output', channel: 'phone', phoneMessage: true, phoneFrom: 'Nova Vale', phoneTo: 'Alex Player',
      phoneFromAccountId: 'nova:whatsup', phoneToAccountId: 'player:whatsup', originalText: '@fotogram:Third Person',
      accountLinks: bindAccountLinks('@fotogram:Third Person', characters) };
    const turns: TurnRecord[] = [{ id: 'turn', number: 1, mode: 'user', createdAt: now,
      input: { graphText: '', messages: [message] }, output: { graphText: '', messages: [phone] } }];
    const workflow: WorkflowFile = { format: 'rpgraph-workflow', formatVersion: currentWorkflowFormatVersion, savedAt: now, nodes: [], edges: [] };
    const saved = sessionV2FromCurrentState({ name: 'Links', settings: { englishProcessingEnabled: false, displayLanguage: 'en' }, workflowVariables: {},
      turns, turnCheckpoints: [], openingMessages: [], socialConnectionsByCharacter: { player: { whatsup: ['third:whatsup'] } } }, workflow, [], now);
    const imported = JSON.parse(JSON.stringify(saved));
    expect(isRpgraphSessionV2(imported)).toBe(true);
    const restored = appStateFromSessionV2(imported);
    expect(restored.turns[0].input.messages[0].socialDirectMessage?.accountLinks).toEqual(message.socialDirectMessage!.accountLinks);
    expect(restored.turns[0].output.messages[0].accountLinks).toEqual(phone.accountLinks);
    expect(restored.socialConnectionsByCharacter.player.whatsup).toEqual(['third:whatsup']);
    imported.timeline[0].socialDirectMessage.accountLinks[0].app = 'unknown';
    expect(isRpgraphSessionV2(imported)).toBe(false);
  });

  it('preserves multi-word account names through translation placeholders', () => {
    const { characters } = setup();
    const shield = shieldTranslationAccountLinks('Ask @whatsup:Third Person, then @fotogram:Nova Vale.', characters);
    expect(shield.shielded).toBe('Ask [[RPGRAPH_ACCOUNT_LINK_0]], then [[RPGRAPH_ACCOUNT_LINK_1]].');
    expect(restoreTranslationAccountLinks('Contact [[RPGRAPH_ACCOUNT_LINK_0]] and [[RPGRAPH_ACCOUNT_LINK_1]].', shield.tokens))
      .toBe('Contact @whatsup:Third Person and @fotogram:Nova Vale.');
  });

});
