import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EffectCallback, SetStateAction } from 'react';
import { useRoleplayPanelRuntime } from './useRoleplayPanelRuntime';
import { emptyRpStorybook, normalizeRpStorybook, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import { storyCharactersFromNodes } from '../storybook/runtime';
import { narratorCharacterId } from './runOrchestration';
import { bindAccountLinks } from '../chat/accountLinks';
import { appStateFromSessionV2, sessionV2FromCurrentState } from '../data-management/sessionStore';
import { currentWorkflowFormatVersion } from '../workflow/version';
import type { TurnRecord, WorkflowFile, WorkflowNode } from '../types';

// Exercise selection transitions without mounting components or launching the application.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, effects: [] as EffectCallback[] }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: <T,>(initial: T | (() => T)) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [hooks.slots[index], (update: SetStateAction<T>) => {
      hooks.slots[index] = typeof update === 'function' ? (update as (current: T) => T)(hooks.slots[index] as T) : update;
    }];
  },
  useRef: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useMemo: <T,>(compute: () => T) => compute(),
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: EffectCallback) => { hooks.effects.push(effect); },
  useLayoutEffect: (effect: EffectCallback) => { hooks.effects.push(effect); },
  useContext: () => null,
}));

beforeEach(() => { hooks.slots = []; hooks.index = 0; hooks.effects = []; });
afterEach(() => vi.unstubAllGlobals());

it('stops following at the bottom during generation and resumes when content grows', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const tick = (time: number) => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(time));
  };
  const { render, options } = harness();
  options.isRunning = true;
  options.smoothChatAutoScrollEnabled = true;
  options.smoothChatAutoScrollMinSpeed = 42;
  const runtime = render();
  const thread = { scrollHeight: 500, clientHeight: 300, scrollTop: 200 };
  runtime.chatThreadRef.current = thread as HTMLDivElement;
  runtime.scrollChatThreadToBottomIfFollowing();
  tick(0); tick(16); tick(32);
  expect(frames.size).toBe(0);
  expect(render().smoothChatAutoScrollActive).toBe(false);
  thread.scrollHeight = 510;
  runtime.scrollChatThreadToBottomIfFollowing();
  tick(48); tick(64); tick(80);
  expect(thread.scrollTop).toBeGreaterThan(200);
  expect(render().smoothChatAutoScrollActive).toBe(true);
  for (let time = 96; time <= 1000 && frames.size; time += 16) tick(time);
  expect(thread.scrollTop).toBe(210);
  expect(render().smoothChatAutoScrollActive).toBe(false);
  expect(frames.size).toBe(0);
});

it('coalesces queued automatic scrolls from streaming and image loads', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const { render, options } = harness();
  options.smoothChatAutoScrollEnabled = false;
  const runtime = render();
  const scrollTo = vi.fn();
  runtime.chatThreadRef.current = { scrollHeight: 500, scrollTo } as unknown as HTMLDivElement;
  for (let update = 0; update < 100; update++) {
    runtime.scrollChatThreadToBottomIfFollowing();
  }
  expect(frames.size).toBe(1);
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(16));
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 500, behavior: 'auto' });
});

it.each([60, 144, 240])('gently accelerates for long output without frame catch-up at %s Hz', (refreshRate) => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const tick = (time: number) => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(time));
  };
  const { render, options } = harness();
  options.smoothChatAutoScrollEnabled = true;
  options.smoothChatAutoScrollMinSpeed = 42;
  const runtime = render();
  let actualScrollTop = 0;
  const thread = {
    scrollHeight: 500, clientHeight: 300,
    get scrollTop() { return actualScrollTop; },
    set scrollTop(value: number) { actualScrollTop = Math.round(value); },
  };
  runtime.chatThreadRef.current = thread as HTMLDivElement;
  runtime.scrollChatThreadToBottomIfFollowing();
  tick(0); tick(0);
  for (let frame = 1; frame <= refreshRate; frame++) tick(frame * 1000 / refreshRate);
  expect(thread.scrollTop).toBe(42);
  thread.scrollHeight += 10000;
  runtime.scrollChatThreadToBottomIfFollowing();
  for (let frame = 1; frame <= refreshRate; frame++) tick(1000 + frame * 1000 / refreshRate);
  expect(thread.scrollTop).toBeGreaterThan(84);
  expect(thread.scrollTop).toBeLessThanOrEqual(89);
  const beforePause = thread.scrollTop;
  tick(12000);
  expect(thread.scrollTop - beforePause).toBeLessThanOrEqual(2);
  expect(thread.scrollTop).toBeGreaterThanOrEqual(beforePause);
});

it('positions restored history immediately before smoothly following later media loads', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const tick = (time: number) => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(time));
  };
  const { render, options } = harness();
  options.smoothChatAutoScrollEnabled = true;
  options.smoothChatAutoScrollMinSpeed = 42;
  const runtime = render();
  const thread = {
    scrollHeight: 5000, clientHeight: 300, scrollTop: 0,
    scrollTo: vi.fn(({ top }: ScrollToOptions) => {
      thread.scrollTop = Math.min(top!, thread.scrollHeight - thread.clientHeight);
    }),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  };
  runtime.chatThreadRef.current = thread as unknown as HTMLDivElement;
  const cleanups = hooks.effects.map((effect) => effect());
  // Image load events can supersede the mount effects before their frame runs.
  runtime.scrollChatThreadToBottomIfFollowing('smooth');
  runtime.scrollChatThreadToBottomIfFollowing('smooth');
  tick(16); tick(32);
  expect(thread.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 5000, behavior: 'auto' });
  expect(thread.scrollTop).toBe(4700);
  expect(frames.size).toBe(0);

  thread.scrollHeight += 200;
  runtime.scrollChatThreadToBottomIfFollowing('smooth');
  tick(48); tick(64); tick(80);
  expect(thread.scrollTop).toBeGreaterThan(4700);
  expect(thread.scrollTop).toBeLessThan(4900);
  expect(thread.scrollTo).toHaveBeenCalledTimes(1);
  expect(render().smoothChatAutoScrollActive).toBe(true);
  const wheelHandler = thread.addEventListener.mock.calls.find(([type]) => type === 'wheel')?.[1] as () => void;
  wheelHandler();
  expect(render().smoothChatAutoScrollActive).toBe(false);
  cleanups.forEach((cleanup) => cleanup?.());
  expect(frames.size).toBe(0);
});

it.each([false, true])('cancels a pending follow request on user input (smooth=%s)', (smooth) => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const { render, options } = harness();
  options.smoothChatAutoScrollEnabled = smooth;
  const runtime = render();
  const listeners = new Map<string, () => void>();
  const scrollTo = vi.fn();
  const thread = { scrollHeight: 600, clientHeight: 300, scrollTop: 300, scrollTo,
    addEventListener: (type: string, callback: () => void) => listeners.set(type, callback),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  runtime.chatThreadRef.current = thread as unknown as HTMLDivElement;
  const cleanups = hooks.effects.map((effect) => effect());
  runtime.scrollChatThreadToBottomIfFollowing();
  expect(listeners.has('wheel')).toBe(true);
  listeners.get('wheel')!();
  thread.scrollTop = 100;
  listeners.get('scroll')!();
  runtime.scrollChatThreadToBottomIfFollowing();
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(16));
  expect(scrollTo).not.toHaveBeenCalled();
  expect(thread.scrollTop).toBe(100);
  expect(frames.size).toBe(0);
  cleanups.forEach((cleanup) => cleanup?.());
});

function harness() {
  const book = normalizeRpStorybook({ ...emptyRpStorybook, characters: [
    { id: 'npc', name: 'NPC', playable: false }, { id: 'player', name: 'Player', playable: true },
  ] });
  const nodes = [{ id: 'book', data: { nodeType: 'rp-storybook', storybookJson: rpStorybookJsonText(book) } } as WorkflowNode];
  const cast = storyCharactersFromNodes(nodes);
  const options = { appCharacters: cast, nodeViewNodes: nodes, nodesRef: { current: nodes }, messages: [], turns: [],
    storybooksByNodeId: new Map([['book', book]]), characterStorybookNodeCount: 1,
    captureNpcParticipants: vi.fn(), notifySystem: vi.fn(), commitNodes: vi.fn(), isRunning: false,
  } as unknown as Parameters<typeof useRoleplayPanelRuntime>[0];
  const render = () => {
    hooks.index = 0;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useRoleplayPanelRuntime(options);
  };
  return { render, options, nodes, npc: cast[0], player: cast[1] };
}

it('retains NPC participants but excludes them from initial, explicit and restored player selection', () => {
  const { render, npc, player } = harness();
  expect(render().storyCharacters).toHaveLength(2);
  expect(render().playerCharacters.map((character) => character.id)).toEqual([player.id]);
  expect(render().characterColors.has(player.name)).toBe(true);
  expect(render().characterColors.has(npc.name)).toBe(false);
  expect(render().selectedCharacter?.id).toBe(player.id);
  render().selectChatCharacter(npc.id);
  expect(render().selectedCharacter?.id).toBe(player.id);
  render().setSelectedCharacterId(npc.id);
  expect(render().selectedCharacter?.id).toBe(player.id);
});

it('opens an NPC conversation from the playable side and preserves narrator inspection', () => {
  const { render, npc, player } = harness();
  render().openPhoneConversation('npc-player', 1, { speakerId: npc.id, contactId: player.id, activatePlayer: true });
  expect(render().selectedCharacter?.id).toBe(player.id);
  expect(render().viewedPhoneCharacter?.id).toBe(player.id);
  expect(render().selectedPhoneContact?.character.id).toBe(npc.id);
  expect(render().selectedPhoneContact?.color).toBe('#e8edf3');
  render().selectChatCharacter(narratorCharacterId);
  render().openPhoneConversation('npc-player', 1, { speakerId: npc.id, contactId: player.id, activatePlayer: false });
  expect(render().narratorSelected).toBe(true);
  expect(render().viewedPhoneCharacter?.id).toBe(npc.id);
});

it('opens an NPC publication for narrator inspection without selecting the NPC as player', () => {
  const { render, npc } = harness();
  render().openSocialPost({ app: 'onlyfriends', postId: 'npc-post', author: npc.name,
    authorCharacterId: npc.sourceId, authorHandle: 'npc', caption: 'NPC publication' });
  expect(render().narratorSelected).toBe(true);
  expect(render().selectedCharacter).toBeUndefined();
  expect(render().viewedPhoneCharacter?.id).toBe(npc.id);
  expect(render().socialPostOpenRequest?.postId).toBe('npc-post');
});


it('rebuilds automatic contacts after save/load and removes them when their turn is undone', () => {
  const { render, options, nodes, npc, player } = harness();
  const text = '@whatsup:Player';
  const turn: TurnRecord = { id: 'contact', number: 10, createdAt: '2026-09-14T00:00:00Z',
    input: { graphText: text, messages: [{ id: 1, role: 'user', originalText: text, phoneMessage: true,
      phoneFromAccountId: player.apps!.whatsup!.accountId, phoneToAccountId: npc.apps!.whatsup!.accountId,
      accountLinks: bindAccountLinks(text, [npc, player]) }] }, output: { graphText: '', messages: [] } };
  options.messages = turn.input.messages;
  const state = render();
  expect(state.persistedSocialConnectionsByCharacter.npc.whatsup).toContain(player.apps!.whatsup!.accountId);
  expect(state.savedSocialConnectionsByCharacter).toEqual({});
  // A manually saved contact must survive alongside a turn-owned grant.
  state.setSocialConnectionsByCharacter({ player: { whatsup: [npc.apps!.whatsup!.accountId] } });
  const workflow: WorkflowFile = { format: 'rpgraph-workflow', formatVersion: currentWorkflowFormatVersion,
    savedAt: turn.createdAt, nodes, edges: [] };
  const saved = sessionV2FromCurrentState({ name: 'Contacts', settings: { englishProcessingEnabled: false, displayLanguage: 'en' },
    turns: [turn], turnCheckpoints: [], openingMessages: [], workflowVariables: {},
    socialConnectionsByCharacter: render().savedSocialConnectionsByCharacter }, workflow, nodes);
  const loaded = appStateFromSessionV2(JSON.parse(JSON.stringify(saved)));
  render().setSocialConnectionsByCharacter(loaded.socialConnectionsByCharacter);
  options.messages = loaded.turns.flatMap((entry) => [...entry.input.messages, ...entry.output.messages]);
  expect(render().persistedSocialConnectionsByCharacter.npc.whatsup).toContain(player.apps!.whatsup!.accountId);
  options.messages = [];
  expect(render().persistedSocialConnectionsByCharacter).toEqual({ player: { whatsup: [npc.apps!.whatsup!.accountId] } });
});


it('invalidates panel state and clears drafts when the same cast starts another session', () => {
  const { render, player } = harness();
  const runtime = render();
  runtime.setPhoneDraft('Old phone draft');
  runtime.setShowPhoneEmojiPicker(true);
  runtime.setSelectedEventId('old-event');
  runtime.selectPhoneReply({ id: 42, role: 'output', originalText: 'Old message' });
  runtime.openSocialPost({ app: 'fotogram', postId: 'old-post', author: 'Player', authorHandle: 'player', caption: '' });
  const before = render();
  expect(before.phoneDraft).toBe('Old phone draft');
  expect(before.socialPostOpenRequest).toBeDefined();
  before.resetPanelSession();
  const after = render();
  expect(after.playerCharacters.map((character) => character.id)).toEqual([player.id]);
  expect(after.panelSessionRevision).toBe(before.panelSessionRevision + 1);
  expect(after.phoneDraft).toBe('');
  expect(after.phoneDraftCommands).toEqual([]);
  expect(after.phoneImages).toEqual([]);
  expect(after.showPhoneEmojiPicker).toBe(false);
  expect(after.selectedEventId).toBe('');
  expect(after.phoneReplyToMessage).toBeUndefined();
  expect(after.socialPostOpenRequest).toBeUndefined();
  after.resetPanelSession();
  expect(render().panelSessionRevision).toBe(after.panelSessionRevision + 1);
});

it('colors loaded and newly contacted NPCs using the same activity as the library', () => {
  const { render, options, npc, player } = harness();
  expect(render().characterColors.has(npc.name)).toBe(false);
  options.messages = [{ id: 1, role: 'user', channel: 'phone', originalText: 'Hello',
    phoneFrom: player.name, phoneTo: npc.name }];
  const contacted = render();
  expect(contacted.characterColors.get(npc.name)).toMatch(/^var\(--rp-npc-/);
  expect(contacted.characterColorSlots[npc.sourceId]).toBe(1);
  const slots = contacted.characterColorSlots;
  // Loading an old RP with messages but no color record derives colors immediately.
  contacted.setCharacterColorSlots({});
  expect(render().characterColors.has(npc.name)).toBe(true);
  // Modern saves preserve the assigned family.
  render().setCharacterColorSlots(slots);
  expect(render().characterColorSlots[npc.sourceId]).toBe(1);
});
