import { beforeEach, expect, it, vi } from 'vitest';
import type { MessageRecord } from '../types';
import { fixedReferenceImageOptions, phoneReferenceImageScope, rpReferenceImageScope } from './referenceImages';
import { useNextTurnReferenceImages } from './useNextTurnReferenceImages';

// Exercise hook state transitions without mounting an interface or starting a browser.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[] }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: <T,>(initial: T | (() => T)) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [hooks.slots[index], (value: T) => { hooks.slots[index] = value; }];
  },
  useRef: <T,>(current: T) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current };
    return hooks.slots[index];
  },
  useMemo: <T,>(compute: () => T) => compute(),
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
}));

const attachment = { id: 'old-photo', name: 'Photo', mimeType: 'image/png', size: 1, dataUrl: 'data:image/png;base64,AA==' };
const phoneScope = phoneReferenceImageScope('Avery', 'Blake');
const reply: MessageRecord = {
  id: 1, role: 'output', originalText: 'Photo.', channel: 'phone',
  phoneFrom: 'Avery', phoneTo: 'Blake', imageAttachments: [attachment], turnNumber: 1,
};
const messages: MessageRecord[] = [reply, ...Array.from({ length: 20 }, (_, index): MessageRecord => ({
  id: index + 2, role: 'user', originalText: 'Later.', turnNumber: index + 2,
}))];
function render(scope: string, replyToMessage?: MessageRecord) {
  hooks.cursor = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const result = useNextTurnReferenceImages({ messages, nodes: [],
    options: { ...fixedReferenceImageOptions, scope }, replyToMessage });
  hooks.effects.splice(0).forEach((effect) => effect());
  return result;
}
beforeEach(() => { hooks.slots = []; hooks.effects = []; hooks.cursor = 0; });

it('clears a manual phone selection when switching to RP or another contact', () => {
  for (const destination of [rpReferenceImageScope, phoneReferenceImageScope('Avery', 'Casey')]) {
    render(phoneScope).toggleSelectedImage(attachment);
    expect(render(phoneScope).selectedImageIds.has(attachment.id)).toBe(true);
    const switched = render(destination);
    expect(switched.selectedImageIds.size).toBe(0);
    expect(switched.optionsForRun().additionalImageIds).toEqual([]);
    expect(switched.contextualImageIds.has(attachment.id)).toBe(false);
    expect(render(phoneScope).selectedImageIds.size).toBe(0);
  }
});

it('allows manually selecting an old card in RP without carrying it into Phone', () => {
  render(rpReferenceImageScope).toggleSelectedImage(attachment);
  expect(render(rpReferenceImageScope).contextualImageIds.has(attachment.id)).toBe(true);
  expect(render(phoneScope).optionsForRun().additionalImageIds).toEqual([]);
});

it('includes reply images only for the matching phone conversation', () => {
  expect(render(phoneScope, reply).optionsForRun(reply).additionalImageIds).toEqual([attachment.id]);
  const switched = render(rpReferenceImageScope, reply);
  expect(switched.contextualImageIds.has(attachment.id)).toBe(false);
  expect(switched.optionsForRun(reply).additionalImageIds).toEqual([]);
});

it('retains reply images before sending clears the reply composer', () => {
  render(phoneScope).retainMessageImages(reply);
  expect(render(phoneScope).optionsForRun().additionalImageIds).toEqual([attachment.id]);
});
