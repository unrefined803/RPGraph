import { buildHistoryOutputs } from '../data-management/historyStore';
import { socialAccountPresentation, socialCharacterForPost, socialDirectMessageDisplayText, socialDirectMessageHistoryText } from './socialMedia';
import { describe, expect, it } from 'vitest';
import { defaultRpStorybookCharacterBanking } from '../nodes/rp-storybook/model';
import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord, TurnRecord, WorkflowFile, WorkflowNode } from '../types';
import { currentWorkflowFormatVersion } from '../workflow/version';
import { sessionV2FromCurrentState, appStateFromSessionV2 } from '../data-management/sessionStore';
import { isRpgraphSessionV2 } from '../data-management/validation';
import { normalizeDatingProfile, resetDatingPasses } from './datingProfile';
import { datingAccountId, datingAccounts, datingNpcProfiles, resolveDatingAccount } from './datingAccounts';
import { canSendMatchMeMessage, incomingMatchMeMessage, isMatchMeMatch, matchMeContext, matchMeLikePolicy, matchMeMessageAllowed, matchMePairId, matchMeState, migrateDatingHistory } from './matchMe';
import { parseSocialDirectMessageOutput, socialPostInputText, socialDirectMessageActor, socialDirectMessageInputText } from './socialMedia';
import { parseMessengerAppMessagesObject, parseEmbeddedPhoneMessagesFromRpOutput, embeddedPhoneMessagesLivePreview } from './phoneMessages';
import { validateSocialMessengerAccounts } from './socialMessageValidation';
import { prepareMatchMePromptSlots, defaultMatchMeDmPrompt } from './matchMePrompt';
import { socialMessagePreviewLinks } from './socialMessagePreview';

const now = '2026-09-06T10:00:00.000Z';
function character(id = 'mia', name = 'Mia'): StorybookCharacter {
  return { id, name, label: name, kind: 'character', sourceId: id, storybookNodeId: 'storybook',
    profile: { name, description: 'Private background', personality: `Private personality of ${id}`, speechStyle: 'Kind', role: '' },
    phoneSettings: { wallpaperId: '' }, banking: defaultRpStorybookCharacterBanking(),
    social: { fotogramUsername: '', onlyfriendsUsername: '', plotTwist: {
      name, age: 25, gender: 'woman', bio: 'Public profile', interests: 'Books', photoIds: ['photo'], decisions: {}, historyVersion: 1,
    } } };
}
function fixture(partner = 'demo-alex') {
  const owner = character();
  const characters = [owner];
  const accountIds = [datingAccountId(owner.id), partner].sort() as [string, string];
  const match = { id: matchMePairId(...accountIds), accountIds, matchedAt: now, status: 'active' as const };
  const messages: MessageRecord[] = [{ id: 1, role: 'user', originalText: 'Display text can change.', includeInHistory: true, matchMeMatch: match }];
  const active = matchMeState(characters, messages);
  const outgoing = incomingMatchMeMessage(datingAccountId(owner.id), partner, 'Hello', active, 'outgoing-1', now)!;
  return { owner, characters, state: active, match, messages, outgoing };
}
const replyJson = (from = 'demo-alex', to = datingAccountId('mia')) => JSON.stringify({ matchMeApp: [{ from, to, message: 'Hi!' }] });

describe('MatchMe permissions and identity', () => {
  it.each(['matchMeApp', 'matchmeApp'])('streams %s bubbles before JSON completion and keeps conversation identity', (key) => {
    const { state, messages } = fixture();
    const before = 'She checks her phone.\n';
    const first = { from: 'demo-alex', to: datingAccountId('mia'), message: 'Hello there' };
    const start = `${before}{"${key}":[${JSON.stringify(first)}, {"from":"${datingAccountId('mia')}","to":"demo-alex","message":"`;
    for (const partial of ['H', 'Hello', 'Hello back!']) {
      const parsed = embeddedPhoneMessagesLivePreview(start + partial);
      const links = socialMessagePreviewLinks(parsed.socialDirectMessages, state);
      expect(links).toHaveLength(2);
      expect(links.map((link) => link.message)).toEqual(['Hello there', partial]);
      expect(links.map((link) => link.socialMessageId)).toEqual([-1, -2]);
      expect(links.map((link) => link.sourceOrder)).toEqual([0, 1]);
      expect(links[0].previewMessage?.matchId).toBe(links[1].previewMessage?.matchId);
      expect(links[0].previewMessage?.fromAccountId).not.toBe(links[1].previewMessage?.fromAccountId);
      expect(links[1].from).toBe('Mia');
      expect(parsed.textBefore).toContain('She checks her phone.');
    }
    const complete = embeddedPhoneMessagesLivePreview(start + 'Hello back!"}]}\nShe smiles.');
    expect(socialMessagePreviewLinks(complete.socialDirectMessages, state)).toHaveLength(2);
    expect(complete.textAfter).toContain('She smiles.');
    expect(messages).toHaveLength(1);
    expect(socialMessagePreviewLinks(complete.socialDirectMessages, { ...state, matches: [] })).toEqual([]);
  });
  it('embeds lowercase MatchMe keys and applies the same delivery restrictions', () => {
    const { characters, messages, outgoing } = fixture();
    const alias = replyJson().replace('matchMeApp', 'matchmeApp');
    const text = `Before\n${alias}\nAfter`;
    const embedded = parseEmbeddedPhoneMessagesFromRpOutput(text);
    expect(embedded.socialDirectMessages).toMatchObject([{ app: 'matchme', text: 'Hi!' }]);
    expect(JSON.stringify(embedded)).not.toContain('matchmeApp');
    expect(embeddedPhoneMessagesLivePreview(`Before\n${alias.slice(0, -2)}`).socialDirectMessages)
      .toMatchObject([{ app: 'matchme', text: 'Hi!' }]);
    expect(validateSocialMessengerAccounts({ text, characters, messages }).issues).toEqual([]);
    expect(validateSocialMessengerAccounts({ text, characters, messages: [] }).sanitizedText).not.toContain('matchmeApp');
    const unknown = alias.replace('demo-alex', 'unknown-account');
    expect(validateSocialMessengerAccounts({ text: unknown, characters, messages }).sanitizedText).toBe('');
    expect(parseSocialDirectMessageOutput(alias, outgoing, now, characters).message).toBeDefined();
    const duplicate = JSON.stringify({ ...JSON.parse(replyJson()), ...JSON.parse(alias) });
    expect(validateSocialMessengerAccounts({ text: duplicate, characters, messages, directMessage: outgoing }).issues.length).toBeGreaterThan(0);
    expect(parseSocialDirectMessageOutput(duplicate, outgoing, now, characters).message).toBeUndefined();
  });
  it.each(datingNpcProfiles.map((profile) => profile.id))('restores legacy match %s once, in both directions', (id) => {
    const { state, owner, match } = fixture(id);
    const ownerId = datingAccountId(owner.id);
    expect(canSendMatchMeMessage(ownerId, id, state)).toBe(true);
    expect(canSendMatchMeMessage(id, ownerId, state)).toBe(true);
    expect(matchMeLikePolicy(ownerId, id, state, now)).toBeUndefined();
    expect(matchMeLikePolicy(id, ownerId, state, now)).toBeUndefined();
    expect(isMatchMeMatch(match)).toBe(true);
  });
  it('does not expose image-less legacy profiles in fresh discovery', () => {
    expect(matchMeState([character()], []).accounts.map((account) => account.id)).not.toEqual(
      expect.arrayContaining(datingNpcProfiles.map((profile) => profile.id)),
    );
  });
  it('rejects self, unknown, ambiguous IDs, inactive matches and visible history claims', () => {
    const { state, characters, owner, match } = fixture();
    const id = datingAccountId(owner.id);
    expect(canSendMatchMeMessage(id, id, state)).toBe(false);
    expect(canSendMatchMeMessage(id, 'invented', state)).toBe(false);
    expect(canSendMatchMeMessage(id, 'demo-alex', { ...state, accounts: [...state.accounts, state.accounts.find((a) => a.id === id)!] })).toBe(false);
    expect(canSendMatchMeMessage(id, 'demo-alex', { ...state, matches: [{ ...match, status: 'inactive' }] })).toBe(false);
    expect(canSendMatchMeMessage(id, 'demo-alex', matchMeState(characters, [{ id: 5, role: 'output', originalText: '[MatchMe Match] Mia and Alex matched.' }]))).toBe(false);
    expect(matchMeState(characters, []).matches).toEqual([]);
  });
  it('keeps names and private Storybook personalities separate from account IDs', () => {
    const { owner, messages, outgoing } = fixture();
    owner.social.plotTwist!.name = 'Renamed';
    const second = character('another', 'Renamed');
    const state = matchMeState([owner, second], messages);
    expect(resolveDatingAccount('Renamed', state.accounts)).toBeUndefined();
    expect(resolveDatingAccount(datingAccountId(owner.id), state.accounts)?.name).toBe('Renamed');
    expect(matchMeMessageAllowed(outgoing, state)).toBe(true);
    expect(socialDirectMessageActor([owner, second], second.id, outgoing)).toBeUndefined();
    expect(socialDirectMessageActor([owner, second], owner.id, outgoing)?.id).toBe(owner.id);
    expect(datingAccounts([owner]).find((a) => a.characterId === owner.id)?.personality).toContain('Private personality of mia');
    const context = matchMeContext(state, outgoing);
    expect(context).toContain('Public MatchMe profiles');
    expect(context).not.toContain('Private personality of mia');
    expect(context).not.toContain('Private background');
    expect(context).toContain(datingNpcProfiles[0].personality);
    const input = socialDirectMessageInputText(outgoing, messages, [owner, second]);
    expect(input.startsWith('[MATCHME DIRECT MESSAGE]')).toBe(true);
    expect(input).toContain(now);
  });
  it('isolates conversation history by stable match IDs after profile changes', () => {
    const { owner, messages, state, outgoing } = fixture();
    const otherAccountIds = [datingAccountId(owner.id), 'demo-robin'].sort() as [string, string];
    const otherMatch = { id: matchMePairId(...otherAccountIds), accountIds: otherAccountIds,
      matchedAt: now, status: 'active' as const };
    const otherState = { ...state, matches: [...state.matches, otherMatch] };
    const unrelated = incomingMatchMeMessage('demo-robin', datingAccountId(owner.id), 'Unrelated private conversation', otherState, 'other', now)!;
    const input = socialDirectMessageInputText(outgoing, [...messages, { id: 2, role: 'output', originalText: '', socialDirectMessage: unrelated }], [owner]);
    expect(input).not.toContain('Unrelated private conversation');
    const retryInput = socialDirectMessageInputText(outgoing, [...messages, { id: 3, role: 'user', originalText: '', socialDirectMessage: outgoing }], [owner]);
    expect(retryInput).not.toContain('Existing conversation');
    expect(retryInput).toContain(`New message:\n${outgoing.from}: Hello`);
    expect(matchMeMessageAllowed({ ...outgoing, matchId: otherMatch.id }, state)).toBe(false);
  });
});

describe('MatchMe output validation', () => {
  it('accepts exactly one bound reply with stable retry IDs', () => {
    const { outgoing, state } = fixture();
    const first = parseSocialDirectMessageOutput(replyJson(), outgoing, now).message!;
    const retry = parseSocialDirectMessageOutput(replyJson(), outgoing, now).message!;
    expect(first.fromAccountId).toBe('demo-alex');
    expect(first.toAccountId).toBe(datingAccountId('mia'));
    expect(first.replyToMessageId).toBe(outgoing.messageId);
    expect(first.messageId).toBe(retry.messageId);
    expect(matchMeMessageAllowed(first, state)).toBe(true);
  });
  it.each([
    replyJson('invented'), replyJson('demo-robin'), replyJson('Alex'), replyJson('demo-alex', 'invented'),
    JSON.stringify({ fotogramApp: [{ from: 'demo-alex', to: 'Mia', message: 'Hi' }] }),
    JSON.stringify({ matchMeApp: [{ from: 'demo-alex', to: datingAccountId('mia'), message: 'Hi' }, { from: 'demo-alex', to: datingAccountId('mia'), message: 'Again' }] }),
    replyJson() + '\n' + replyJson(),
    JSON.stringify({ matchMeApp: [{ from: 'demo-alex', to: datingAccountId('mia'), message: 'Hi', postId: 'post' }] }),
    JSON.stringify({ ...JSON.parse(replyJson()), onlyFriendsApp: [] }),
  ])('rejects invalid direct reply %s', (text) => {
    const { outgoing } = fixture();
    const parsed = parseSocialDirectMessageOutput(text, outgoing, now);
    expect(parsed.message).toBeUndefined();
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });
  it('uses the same account and match validation for embedded RP and commands', () => {
    const { characters, messages, outgoing } = fixture();
    const parsed = parseMessengerAppMessagesObject(JSON.parse(replyJson()));
    expect(parsed.socialDirectMessages[0].app).toBe('matchme');
    expect(validateSocialMessengerAccounts({ text: replyJson(), characters, messages }).issues).toEqual([]);
    const denied = validateSocialMessengerAccounts({ text: 'Before\n' + replyJson() + '\nAfter', characters, messages: [] });
    expect(denied.issues.length).toBeGreaterThan(0);
    expect(denied.sanitizedText).not.toContain('matchMeApp');
    expect(denied.sanitizedText).toContain('Before');
    const wrongActor = validateSocialMessengerAccounts({ text: replyJson(datingAccountId('mia'), 'demo-alex'), characters, messages, directMessage: outgoing });
    expect(wrongActor.issues.length).toBeGreaterThan(0);
    expect(wrongActor.sanitizedText).toBe('');
    const duplicate = validateSocialMessengerAccounts({ text: replyJson() + '\n' + replyJson(), characters, messages, directMessage: outgoing });
    expect(duplicate.issues.length).toBeGreaterThan(0);
    expect(duplicate.sanitizedText).toBe('');
  });
});

describe('MatchMe migration and persistence', () => {
  it('migrates legacy messages once, including conversations after Explore again', () => {
    const owner = character();
    owner.social.plotTwist!.historyVersion = undefined;
    owner.social.plotTwist!.messages = [
      { id: 'old-user', matchId: 'demo-alex', sender: 'owner', text: 'Hello', sentAt: now },
      { id: 'old-reply', matchId: 'demo-alex', sender: 'match', text: 'Demo hello', sentAt: now, demo: true },
    ];
    const additions = migrateDatingHistory(owner, matchMeState([owner], []), [], now);
    expect(additions).toHaveLength(3);
    expect(additions[0].matchMeMatch).toBeDefined();
    expect(additions[2].socialDirectMessage?.demo).toBe(true);
    const messages = additions.map((message, index) => ({ ...message, id: index + 1 }));
    expect(migrateDatingHistory(owner, matchMeState([owner], messages), messages, now)).toEqual([]);
    owner.social.plotTwist!.historyVersion = 1;
    expect(migrateDatingHistory(owner, matchMeState([owner], []), [], now)).toEqual([]);
  });
  it('round-trips structured match state, translated messages and read positions through RP saves', () => {
    const { messages, outgoing, characters } = fixture();
    const turns: TurnRecord[] = [{ id: 'turn-1', number: 1, mode: 'user', createdAt: now,
      input: { graphText: '', messages }, output: { graphText: '', messages: [{ id: 2, role: 'output', originalText: 'DM', includeInHistory: true,
        socialDirectMessage: { ...outgoing, displayText: 'Displayed variant', internalText: 'Internal variant' } }] } }];
    const workflow: WorkflowFile = { format: 'rpgraph-workflow', formatVersion: currentWorkflowFormatVersion, savedAt: now, nodes: [], edges: [] };
    const saved = sessionV2FromCurrentState({ name: 'Test', settings: { englishProcessingEnabled: true, displayLanguage: 'en' },
      workflowVariables: {}, turns, turnCheckpoints: [], openingMessages: [], phoneAppSeenByCharacter: { 'mia:matchme:dm:demo-alex': 2 } }, workflow, [], now);
    const imported = JSON.parse(JSON.stringify(saved));
    expect(isRpgraphSessionV2(imported)).toBe(true);
    const restored = appStateFromSessionV2(imported);
    const history = restored.turns.flatMap((turn) => [...turn.input.messages, ...turn.output.messages]);
    expect(canSendMatchMeMessage(datingAccountId('mia'), 'demo-alex', matchMeState(characters, history))).toBe(true);
    expect(history[1].socialDirectMessage).toEqual({ ...outgoing, displayText: 'Displayed variant', internalText: 'Internal variant' });
    expect(restored.phoneAppSeenByCharacter['mia:matchme:dm:demo-alex']).toBe(2);
    const broken = structuredClone(imported);
    broken.timeline[0].matchMeMatch.id = 'forged';
    expect(isRpgraphSessionV2(broken)).toBe(false);
  });
});

function promptSwitch(titles = ['Fotogram Post', 'OnlyFriends Post', 'Fotogram Thread', 'OnlyFriends Thread', 'Fotogram DM', 'OnlyFriends DM']): WorkflowNode {
  return { id: 'switch', type: 'workflow', position: { x: 0, y: 0 }, data: { nodeType: 'llm-prompt-switch', label: 'Switch',
    llmPromptSwitchOutputTitles: ['RP', 'WhatsUp', 'Social Media'], llmPromptSwitchPromptTitlesByOutput: [['RP'], ['Phone'], titles],
    llmPromptSwitchPromptBeforesByOutput: [['RP'], ['Phone'], titles.map((title) => `Before ${title}`)],
    llmPromptSwitchPromptAftersByOutput: [['RP'], ['Phone'], titles.map((title) => `Custom ${title}`)],
  } } as WorkflowNode;
}
describe('MatchMe prompt slot installation', () => {
  it('appends slot 6 and leaves every existing prompt intact', () => {
    const node = promptSwitch();
    const prepared = prepareMatchMePromptSlots([node]);
    expect(prepared.slot).toBe(6);
    expect(prepared.updates[0].data.llmPromptSwitchPromptAftersByOutput[2].slice(0, 6)).toEqual(node.data.llmPromptSwitchPromptAftersByOutput![2]);
    expect(prepared.updates[0].data.llmPromptSwitchPromptAftersByOutput[2][6]).toBe(defaultMatchMeDmPrompt);
    const installed = { ...node, data: { ...node.data, ...prepared.updates[0].data } };
    expect(prepareMatchMePromptSlots([installed]).updates).toEqual([]);
  });
  it('preserves custom slot 6 and uses 7 instead', () => {
    const node = promptSwitch([...promptSwitch().data.llmPromptSwitchPromptTitlesByOutput![2], 'Custom']);
    const prepared = prepareMatchMePromptSlots([node]);
    expect(prepared.slot).toBe(7);
    expect(prepared.updates[0].data.llmPromptSwitchPromptAftersByOutput[2][6]).toBe('Custom Custom');
  });
  it('rejects missing routing or exhausted slots without mutations', () => {
    expect(() => prepareMatchMePromptSlots([])).toThrow('Social Media');
    const node = promptSwitch(Array.from({ length: 10 }, (_, index) => `Custom ${index}`));
    const before = JSON.stringify(node);
    expect(() => prepareMatchMePromptSlots([node])).toThrow('No free');
    expect(JSON.stringify(node)).toBe(before);
  });
});

describe('MatchMe display identities', () => {
  it.each(['fotogram', 'onlyfriends'] as const)(
    'uses real character names and app-specific public names separately for %s',
    (app) => {
      const { owner, outgoing } = fixture();
      const partner = character('alex', 'Alex Realname');
      owner.name = 'Mia Realname';
      owner.apps = { [app]: { accountId: outgoing.fromAccountId!, username: 'mia.handle',
        enabled: true, displayName: 'Sender Profile', bio: '', profile: owner.social.plotTwist! } };
      partner.apps = { [app]: { accountId: outgoing.toAccountId!, username: 'alex.handle',
        enabled: true, displayName: 'Recipient Profile', bio: '', profile: partner.social.plotTwist! } };
      owner.social.plotTwist!.name = 'Sender Profile';
      partner.social.plotTwist!.name = 'Recipient Profile';
      const characters = [owner, partner];
      const direct = { ...outgoing, app, from: 'Sender Profile', to: 'Recipient Profile',
        text: 'Keep Sender Profile and @fotogram:Alex unchanged.' };
      const record: MessageRecord = { id: 2, role: 'user', isOpening: true,
        originalText: socialDirectMessageHistoryText(direct),
        translatedText: socialDirectMessageHistoryText({ ...direct, text: 'Translated Sender Profile' }),
        socialDirectMessage: direct };
      const before = JSON.stringify(record);
      const senderHandle = 'Sender Profile';
      const recipientHandle = 'Recipient Profile';
      const parties = `Mia Realname (@${senderHandle}) to Alex Realname (@${recipientHandle})`;
      expect(socialDirectMessageHistoryText(direct, characters)).toContain(parties);
      expect(socialDirectMessageDisplayText(record, false, characters)).toContain(parties);
      expect(socialDirectMessageDisplayText(record, true, characters)).toContain(parties);
      expect(socialDirectMessageDisplayText(record, false, characters)).toContain(direct.text);
      expect(socialDirectMessageDisplayText(record, true, characters)).toContain('Translated Sender Profile');
      const input = socialDirectMessageInputText(direct, [], characters);
      expect(input).toContain(`Sender: Mia Realname (@${senderHandle})`);
      expect(input).toContain(`Recipient: Alex Realname (@${recipientHandle})`);
      const outputs = buildHistoryOutputs({ messages: [record], characters, fallbackOriginalHistory: '',
        fallbackTranslatedHistory: '', lastTurnsCount: 5, rpDateTimeFormat: 'iso', rpWeekdayLanguage: 'en-US' });
      for (const history of [outputs.originalHistory, outputs.translatedHistory, outputs.lastTurnsHistory]) {
        expect(history).toContain(parties);
      }
      expect(JSON.stringify(record)).toBe(before);
      owner.apps[app]!.displayName = 'MiaLove';
      expect(socialDirectMessageDisplayText(record, false, characters)).toContain('Mia Realname (@MiaLove)');
      expect(socialDirectMessageDisplayText(record, true, characters)).toContain('Mia Realname (@MiaLove)');
      expect(owner.apps[app]!.username).toBe('mia.handle');

      owner.apps[app]!.displayName = '';
      expect(socialDirectMessageHistoryText(direct, characters)).toContain(`Mia Realname to Alex Realname (@${recipientHandle})`);
      expect(socialDirectMessageHistoryText(direct, [partner])).toContain(`Sender Profile to Alex Realname (@${recipientHandle})`);
    },
  );

  it('keeps private account owners and attached tips in LLM history, including legacy and translated records', () => {
    const { owner, outgoing } = fixture();
    const partner = character('alex', 'Alex Realname');
    owner.name = 'Mia Realname';
    owner.apps = { onlyfriends: { accountId: outgoing.fromAccountId!, username: 'mia.handle',
      enabled: true, privacyMode: true, displayName: 'midnight.mileage', bio: '' } };
    partner.apps = { onlyfriends: { accountId: outgoing.toAccountId!, username: 'alex.handle',
      enabled: true, privacyMode: true, displayName: 'open.road.radio', bio: '' } };
    const characters = [owner, partner];
    const direct = { ...outgoing, app: 'onlyfriends' as const, from: 'midnight.mileage',
      to: 'open.road.radio', text: 'Thank you!', tip: 5.5 };
    const parties = 'Mia Realname (@midnight.mileage; private) to Alex Realname (@open.road.radio; private)';
    for (const alreadyFormatted of [false, true]) {
      const record: MessageRecord = {
        id: 2, role: 'user', isOpening: true, socialDirectMessage: direct,
        originalText: socialDirectMessageHistoryText({ ...direct, tip: alreadyFormatted ? direct.tip : undefined }),
        translatedText: socialDirectMessageHistoryText({ ...direct, text: 'Translated thank you!',
          tip: alreadyFormatted ? direct.tip : undefined }),
      };
      const before = JSON.stringify(record);
      const outputs = buildHistoryOutputs({ messages: [record], characters, fallbackOriginalHistory: '',
        fallbackTranslatedHistory: '', lastTurnsCount: 5, rpDateTimeFormat: 'iso', rpWeekdayLanguage: 'en-US' });
      for (const history of [outputs.originalHistory, outputs.translatedHistory, outputs.lastTurnsHistory]) {
        expect(history).toContain(parties);
        expect(history.match(/\[Tip: \$5.5\]/g)).toHaveLength(1);
      }
      expect(outputs.originalHistory).toContain('"Thank you!" [Tip: $5.5]');
      expect(outputs.translatedHistory).toContain('"Translated thank you!" [Tip: $5.5]');
      expect(socialDirectMessageDisplayText(record, false, characters)).not.toContain('Realname');
      expect(JSON.stringify(record)).toBe(before);
    }
    expect(socialDirectMessageInputText(direct, [], characters)).toContain(`Sender: Mia Realname (@midnight.mileage; private)`);
    expect(socialDirectMessageInputText(direct, [], characters)).toContain('[Tip: $5.5]');
    expect(socialDirectMessageHistoryText({ ...direct, tip: 5 }, characters)).toContain('"Thank you!" [Tip: $5]');
    expect(socialDirectMessageHistoryText({ ...direct, tip: undefined }, characters)).not.toContain('[Tip:');
    expect(socialDirectMessageHistoryText({ ...direct, app: 'fotogram' }, characters)).not.toContain('[Tip:');
  });

  it.each(['fotogram', 'onlyfriends'] as const)('marks privacy per %s account only in model context', (app) => {
    const { owner, outgoing } = fixture();
    owner.apps = { [app]: { accountId: outgoing.fromAccountId!, enabled: true,
      profileName: 'quiet.artist', privacyMode: true, bio: '' } };
    const direct = { ...outgoing, app };
    expect(socialDirectMessageHistoryText(direct, [owner])).toContain('Mia (@quiet.artist; private)');
    expect(socialDirectMessageHistoryText(direct, [owner], false)).toContain('quiet.artist (@quiet.artist)');
    expect(socialDirectMessageHistoryText(direct, [owner], false)).not.toContain('; private');
    owner.apps[app]!.privacyMode = false;
    expect(socialDirectMessageHistoryText(direct, [owner])).toContain('Mia (@quiet.artist)');
    expect(socialDirectMessageHistoryText(direct, [owner])).not.toContain('; private');
    owner.apps[app]!.privacyMode = true;
    const otherApp = app === 'fotogram' ? 'onlyfriends' : 'fotogram';
    expect(socialDirectMessageHistoryText({ ...direct, app: otherApp }, [owner])).not.toContain('; private');
  });

  it.each(['fotogram', 'onlyfriends'] as const)('explains private sender and recipient identities only in the %s input block', (app) => {
    const { owner, outgoing } = fixture();
    const partner = character('alex', 'Alex Realname');
    owner.apps = { [app]: { accountId: outgoing.fromAccountId!, enabled: true,
      profileName: 'quiet.artist', privacyMode: true, bio: '' } };
    partner.apps = { [app]: { accountId: outgoing.toAccountId!, enabled: true,
      profileName: 'public.artist', privacyMode: false, bio: '' } };
    const direct = { ...outgoing, app };
    const characters = [owner, partner];
    const input = socialDirectMessageInputText(direct, [], characters);
    const sender = input.split('\n').find((line) => line.startsWith('Sender:'))!;
    const recipient = input.split('\n').find((line) => line.startsWith('Recipient:'))!;
    expect(sender).toContain('Mia (@quiet.artist; private) — Privacy Mode:');
    expect(sender).toContain('not the real name or character photo');
    expect(sender).toContain('only if established in the story');
    expect(recipient).toBe('Recipient: Alex Realname (@public.artist)');
    partner.apps[app]!.privacyMode = true;
    expect(socialDirectMessageInputText(direct, [], characters).split('\n')
      .find((line) => line.startsWith('Recipient:'))).toContain('(@public.artist; private) — Privacy Mode:');
    const history = socialDirectMessageHistoryText(direct, characters);
    expect(history).toContain('(@quiet.artist; private)');
    expect(history).not.toContain('Privacy Mode:');
    const ui = socialDirectMessageHistoryText(direct, characters, false);
    expect(ui).not.toContain('Privacy Mode:');
    expect(ui).not.toContain('Mia');
  });

  it.each(['fotogram', 'onlyfriends'] as const)('explains private post authors for %s photo and text posts', (app) => {
    const { owner } = fixture();
    owner.apps = { [app]: { accountId: 'author-account', enabled: true,
      profileName: 'quiet.artist', privacyMode: true, bio: '' } };
    const post = { app, postId: 'post-1', author: 'Old Name', authorHandle: 'old.handle',
      authorAccountId: 'author-account', caption: 'Hello!', imageId: 'photo-1' };
    for (const textOnly of [false, true]) {
      const input = socialPostInputText({ ...post, textOnly }, [owner]);
      expect(input).toContain('Author: Mia (@quiet.artist; private) — Privacy Mode:');
      expect(input).toContain('only the nickname is public');
      expect(input).toContain('such as a familiar face in the post');
      expect(input).toContain('Post text: Hello!');
    }
    expect(socialPostInputText({ ...post, caption: 'Translated caption' }, [owner]))
      .toContain('(@quiet.artist; private) — Privacy Mode:');
    owner.apps[app]!.privacyMode = false;
    expect(socialPostInputText(post, [owner])).toContain('Author: Mia (@quiet.artist)');
    expect(socialPostInputText(post, [owner])).not.toContain('Privacy Mode:');
    expect(socialPostInputText(post, [])).toContain('Author: Old Name (@old.handle)');
    expect(socialPostInputText(post, [])).not.toContain('Privacy Mode:');
  });

  it('uses the dating persona in public MatchMe names and history', () => {
    const { owner, outgoing } = fixture();
    owner.name = 'Mia Harper';
    owner.social.plotTwist!.name = 'Dating Persona';
    expect(socialDirectMessageHistoryText(outgoing, [owner])).toContain('Dating, 25 to Alex');
    expect(socialDirectMessageHistoryText(outgoing, [owner])).not.toContain('@');
    expect(matchMeState([owner], []).accounts.find((account) => account.id === datingAccountId(owner))?.name).toBe('Dating Persona');
  });

  it('uses first names and ages in new and saved MatchMe histories without changing identities or bodies', () => {
    const { owner, outgoing, messages } = fixture();
    owner.apps = { matchme: { accountId: datingAccountId(owner), enabled: true,
      username: 'generated.mia', displayName: 'Mia_actual', bio: '', profile: owner.social.plotTwist! } };
    const body = 'Keep @fotogram:Avery Hart and character:mia:matchme: "quoted"\nunchanged.';
    const direct = { ...outgoing, text: body };
    const legacy = `[MatchMe DM] ${direct.from} (@${direct.fromHandle}) to ${direct.to} (@${direct.toHandle}): "${body}"`;
    const record: MessageRecord = { id: 2, role: 'user', isOpening: true, originalText: legacy,
      translatedText: legacy.replace(body, 'Translated @fotogram:Avery Hart'), socialDirectMessage: direct };
    const before = JSON.stringify(record);
    expect(socialDirectMessageHistoryText(direct, [owner])).toBe(`[MatchMe DM] Mia, 25 to Alex: "${body}"`);
    expect(socialDirectMessageDisplayText(record, false, [owner])).toBe(socialDirectMessageHistoryText(direct, [owner]));
    expect(socialDirectMessageDisplayText(record, true, [owner])).toBe('[MatchMe DM] Mia, 25 to Alex: "Translated @fotogram:Avery Hart"');
    const outputs = buildHistoryOutputs({ messages: [record], characters: [owner], fallbackOriginalHistory: '',
      fallbackTranslatedHistory: '', lastTurnsCount: 5, rpDateTimeFormat: 'iso', rpWeekdayLanguage: 'en-US' });
    expect(outputs.originalHistory).toContain('Mia, 25 to Alex');
    expect(outputs.lastTurnsHistory).toContain('Mia, 25 to Alex');
    expect(outputs.translatedHistory).toContain('Translated @fotogram:Avery Hart');
    expect(outputs.translatedHistory).toContain('Mia, 25 to Alex');
    expect(outputs.rawHistory).toContain(direct.fromAccountId);
    expect(JSON.stringify(record)).toBe(before);
    const nameOnly = { ...record, originalText: `[MatchMe DM] Mia to Alex: "${body}"` };
    expect(socialDirectMessageDisplayText(nameOnly, false, [owner])).toBe(socialDirectMessageHistoryText(direct, [owner]));
    const reversed = { ...direct, from: direct.to, to: direct.from,
      fromAccountId: direct.toAccountId, toAccountId: direct.fromAccountId };
    expect(socialDirectMessageHistoryText(reversed, [owner])).toContain('Alex to Mia, 25');

    expect(matchMeMessageAllowed(direct, matchMeState([owner], messages))).toBe(true);
    expect(socialDirectMessageInputText(direct, messages, [owner])).toContain('Sender: Mia, 25');
  });

  it('uses explicit historical IDs but never names, guessed handles or ambiguous profiles', () => {
    const { owner, outgoing } = fixture();
    owner.apps = { matchme: { accountId: 'canonical', enabled: true, username: 'generated.mia',
      displayName: '@real.user', bio: '', profile: owner.social.plotTwist! } };
    owner.identityAliases = { accountIds: { matchme: [outgoing.fromAccountId!] } };
    expect(socialDirectMessageHistoryText(outgoing, [owner])).toContain('Mia, 25');
    expect(socialDirectMessageHistoryText(outgoing, [owner, { ...owner, id: 'duplicate' }])).toContain('Mia to Alex');
    expect(socialDirectMessageHistoryText({ ...outgoing, fromAccountId: undefined }, [owner])).toContain('Mia to Alex');
    expect(socialDirectMessageHistoryText({ ...outgoing, fromAccountId: 'Mia' }, [owner])).toContain('Mia to Alex');
    expect(socialDirectMessageHistoryText(outgoing, [])).toContain('Mia to Alex');
    owner.apps.matchme!.displayName = '';
    expect(socialDirectMessageHistoryText(outgoing, [owner])).toContain('Mia, 25 to Alex');
  });

  it.each(['fotogram', 'onlyfriends'] as const)('resolves %s profiles in old and translated histories', (app) => {
    const { outgoing, owner } = fixture();
    const partner = character('alex', 'Alex');
    owner.apps = { [app]: { accountId: outgoing.fromAccountId!, username: '@configured.sender',
      enabled: true, displayName: 'configured.sender', bio: '' } };
    partner.apps = { [app]: { accountId: outgoing.toAccountId!, username: 'configured.recipient',
      enabled: true, displayName: 'configured.recipient', bio: '' } };
    const characters = [owner, partner];
    const direct = { ...outgoing, app, fromHandle: 'stale.sender', toHandle: 'stale.recipient' };
    const label = app === 'fotogram' ? 'Fotogram' : 'OnlyFriends';
    const originalText = `[${label} DM] Mia (@stale.sender) to Alex (@stale.recipient): "Keep @fotogram:Alex"`;
    const record: MessageRecord = { id: 1, role: 'user', originalText,
      translatedText: originalText.replace('Keep', 'Translated'), socialDirectMessage: direct };
    const before = JSON.stringify(record);
    expect(socialDirectMessageHistoryText(direct, characters)).toContain('Mia (@configured.sender) to Alex (@configured.recipient)');
    expect(socialDirectMessageDisplayText(record, false, characters)).toBe(
      `[${label} DM] Mia (@configured.sender) to Alex (@configured.recipient): "Keep @fotogram:Alex"`);
    expect(socialDirectMessageDisplayText(record, true, characters)).toContain('"Translated @fotogram:Alex"');
    expect(socialDirectMessageInputText(direct, [], characters)).toContain('Sender: Mia (@configured.sender)');
    const outputs = buildHistoryOutputs({ messages: [record], characters, fallbackOriginalHistory: '',
      fallbackTranslatedHistory: '', lastTurnsCount: 5, rpDateTimeFormat: 'iso', rpWeekdayLanguage: 'en-US' });
    for (const history of [outputs.originalHistory, outputs.translatedHistory, outputs.lastTurnsHistory]) {
      expect(history).toContain('Mia (@configured.sender) to Alex (@configured.recipient)');
      expect(history).not.toContain('stale.sender');
    }
    expect(outputs.rawHistory).toContain('stale.sender');

    expect(socialDirectMessageHistoryText(direct, [])).toContain('Mia to Alex');
    expect(socialDirectMessageHistoryText(direct, [...characters, { ...owner, id: 'duplicate' }])).toContain('Mia to Alex (@configured.recipient)');
    expect(socialDirectMessageHistoryText({ ...direct, fromAccountId: 'missing' }, characters)).toContain('Mia to Alex');
    expect(JSON.stringify(record)).toBe(before);
    const authored = { ...record, originalText: 'Authored text', translatedText: 'Translation' };
    expect(socialDirectMessageDisplayText(authored, false, characters)).toBe('Authored text');
    expect(socialDirectMessageDisplayText(authored, true, characters)).toBe('Translation');
  });
});


describe('Social app profile labels', () => {
  it.each(['fotogram', 'onlyfriends'] as const)('refreshes %s labels without changing account routing', (app) => {
    const owner = character('helga', 'Helga Harper');
    owner.apps = { [app]: { accountId: 'helga-account', username: 'helga.harper',
      displayName: 'Helga Photogram', enabled: true, bio: '' } };
    const post = { app, postId: 'post-1', author: 'Old profile name', authorHandle: 'old.handle',
      authorAccountId: 'helga-account', caption: 'Keep @fotogram:Helga Harper' };
    const before = JSON.stringify(post);
    const resolve = () => socialAccountPresentation(app, socialCharacterForPost(post, [owner]), post.author, post.authorHandle);
    expect(resolve()).toEqual({ name: 'Helga Harper', handle: 'Helga Photogram' });
    owner.apps[app]!.displayName = '@New Display Name';
    expect(resolve()).toEqual({ name: 'Helga Harper', handle: 'New Display Name' });
    expect(owner.apps[app]!.username).toBe('helga.harper');
    expect(JSON.stringify(post)).toBe(before);
    expect(socialCharacterForPost(post, [owner, { ...owner, id: 'duplicate' }])).toBeUndefined();
    expect(socialCharacterForPost({ ...post, authorAccountId: 'missing' }, [owner])).toBeUndefined();
    expect(socialCharacterForPost({ ...post, authorAccountId: undefined, authorHandle: 'helga.harper' }, [owner])).toBe(owner);
    expect(socialCharacterForPost({ ...post, authorAccountId: undefined, author: owner.name }, [owner])).toBeUndefined();
    expect(socialAccountPresentation(app, undefined, 'Troll872', 'troll872'))
      .toEqual({ name: 'Troll872', handle: 'troll872' });
  });
});


describe('Reciprocal likes and superlikes', () => {
  it('persists a unilateral like without opening a conversation, then matches on the reciprocal like', () => {
    const a = character('a', 'A');
    const b = character('b', 'B');
    const aId = datingAccountId(a), bId = datingAccountId(b);
    a.social.plotTwist!.decisions[bId] = 'like';
    const state = matchMeState([a, b], []);
    expect(matchMeLikePolicy(aId, bId, state, now)).toBeUndefined();
    expect(incomingMatchMeMessage(aId, bId, 'Hello', state, 'blocked', now)).toBeUndefined();
    const match = matchMeLikePolicy(bId, aId, state, now)!;
    expect(match).toBeDefined();
    const history: MessageRecord[] = [{ id: 1, role: 'user', originalText: '', matchMeMatch: match }];
    const matched = matchMeState([a, b], history);
    expect(canSendMatchMeMessage(aId, bId, matched)).toBe(true);
    expect(canSendMatchMeMessage(bId, aId, matched)).toBe(true);
    expect(matchMeLikePolicy(bId, aId, matched, now)).toBeUndefined();
  });
  it('allows a superlike to unlock chat without a reciprocal like and preserves it through normalization', () => {
    const a = character('a', 'A'), b = character('b', 'B');
    const aId = datingAccountId(a), bId = datingAccountId(b);
    b.social.plotTwist!.decisions[aId] = 'pass';
    const state = matchMeState([a, b], []);
    expect(matchMeLikePolicy(aId, bId, state, now)).toBeUndefined();
    const match = matchMeLikePolicy(aId, bId, state, now, 'superlike')!;
    expect(canSendMatchMeMessage(aId, bId, { ...state, matches: [match] })).toBe(true);
    a.social.plotTwist!.decisions[bId] = 'superlike';
    expect(normalizeDatingProfile(a.social.plotTwist)?.decisions[bId]).toBe('superlike');
    expect(matchMeLikePolicy(aId, aId, state, now, 'superlike')).toBeUndefined();
    expect(matchMeLikePolicy(aId, 'missing', state, now, 'superlike')).toBeUndefined();
  });
  it('resolves reciprocal decisions saved under legacy account aliases', () => {
    const a = character('a', 'A'), b = character('b', 'B');
    a.identityAliases = { accountIds: { matchme: ['old-a'] } };
    b.social.plotTwist!.decisions['old-a'] = 'like';
    const state = matchMeState([a, b], []);
    expect(matchMeLikePolicy(datingAccountId(a), datingAccountId(b), state, now)).toBeDefined();
    b.social.plotTwist!.decisions[datingAccountId(a)] = 'pass';
    expect(matchMeLikePolicy(datingAccountId(a), datingAccountId(b), state, now)).toBeUndefined();
  });
  it('only resets passes when exploring again', () => {
    const decisions = { a: 'like', b: 'pass', c: 'superlike' } as const;
    expect(resetDatingPasses(decisions)).toEqual({ a: 'like', c: 'superlike' });
    expect(decisions.b).toBe('pass');
    expect(resetDatingPasses(resetDatingPasses(decisions))).toEqual({ a: 'like', c: 'superlike' });
  });
});
