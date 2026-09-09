import { describe, expect, it } from 'vitest';
import { defaultRpStorybookCharacterBanking } from '../nodes/rp-storybook/model';
import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord, TurnRecord, WorkflowFile, WorkflowNode } from '../types';
import { currentWorkflowFormatVersion } from '../workflow/version';
import { sessionV2FromCurrentState, appStateFromSessionV2 } from '../data-management/sessionStore';
import { isRpgraphSessionV2 } from '../data-management/validation';
import { datingAccountId, datingAccounts, datingNpcProfiles, resolveDatingAccount } from './datingAccounts';
import { canSendMatchMeMessage, incomingMatchMeMessage, isMatchMeMatch, matchMeContext, matchMeLikePolicy, matchMeMessageAllowed, matchMePairId, matchMeState, migrateDatingHistory } from './matchMe';
import { parseSocialDirectMessageOutput, socialDirectMessageActor, socialDirectMessageInputText } from './socialMedia';
import { parseMessengerAppMessagesObject } from './phoneMessages';
import { validateSocialMessengerAccounts } from './socialMessageValidation';
import { prepareMatchMePromptSlots, defaultMatchMeDmPrompt } from './matchMePrompt';

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
