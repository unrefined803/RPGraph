import { describe, expect, it } from 'vitest';
import type { MessageRecord, WorkflowNode } from '../types';
import { normalizeRpStorybook, emptyRpStorybook, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import fixture from '../characters/fixtures/stage4-npc.json';
import {
  collectRecentReferenceImages,
  fixedReferenceImageOptions,
  phoneReferenceImageScope,
  referenceImageScopeForMessage,
  rpReferenceImageScope,
  socialDirectReferenceImageScope,
  unknownConversationReferenceImageScope,
} from './referenceImages';

function image(id: string) {
  return { id, name: id, mimeType: 'image/png', size: 1, dataUrl: `data:image/png;base64,${id}` };
}

function phoneMessage(id: number, from: string, to: string, imageId: string): MessageRecord {
  return {
    id, role: id % 2 ? 'user' : 'output', originalText: 'Photo.', includeInHistory: true,
    channel: 'phone', phoneMessage: true, phoneFrom: from, phoneTo: to,
    imageAttachments: [image(imageId)], phoneImageIds: [imageId], turnNumber: id,
  };
}

const messages: MessageRecord[] = [
  phoneMessage(1, 'Avery', 'Blake', 'avery_blake_01'),
  phoneMessage(2, 'Blake', 'Avery', 'blake_avery_01'),
  {
    id: 3, role: 'user', originalText: 'Look at this.', includeInHistory: true,
    imageAttachments: [image('rp_01')], turnNumber: 3,
  },
  phoneMessage(4, 'Avery', 'Casey', 'avery_casey_01'),
];

function collect(scope: string | undefined, additionalImageIds?: string[]) {
  return collectRecentReferenceImages({
    messages, nodes: [],
    options: { enabled: true, turnLookback: 10, maxImages: 3, scope, additionalImageIds, additionalImageScope: scope },
  }).map((reference) => reference.imageId);
}

describe('reference image conversation scope', () => {
  it('classifies messages by conversation', () => {
    expect(referenceImageScopeForMessage(messages[0]))
      .toBe(referenceImageScopeForMessage(messages[1]));
    expect(referenceImageScopeForMessage(messages[2])).toBe(rpReferenceImageScope);
    expect(referenceImageScopeForMessage(messages[3]))
      .not.toBe(referenceImageScopeForMessage(messages[0]));
    expect(socialDirectReferenceImageScope({ app: 'fotogram', fromHandle: '@Avery', toHandle: 'blake' }))
      .toBe(socialDirectReferenceImageScope({ app: 'fotogram', fromHandle: 'Blake', toHandle: 'avery' }));
  });

  it('attaches only images of the active conversation', () => {
    expect(collect(phoneReferenceImageScope('Blake', 'Avery')))
      .toEqual(['blake_avery_01', 'avery_blake_01']);
    expect(collect(phoneReferenceImageScope('Avery', 'Casey'))).toEqual(['avery_casey_01']);
    expect(collect(rpReferenceImageScope)).toEqual(['avery_casey_01', 'rp_01', 'blake_avery_01']);
    expect(collect(unknownConversationReferenceImageScope)).toEqual([]);
  });

  it('keeps every recent image without a scope', () => {
    expect(collect(undefined)).toEqual(['avery_casey_01', 'rp_01', 'blake_avery_01']);
  });

  it('allows explicit selection of a card in the active view', () => {
    expect(collect(phoneReferenceImageScope('Avery', 'Casey'), ['avery_blake_01']))
      .toEqual(['avery_casey_01', 'avery_blake_01']);
  });

  it('uses the phone lookback for messenger conversations only', () => {
    const scoped = (scope: string) => collectRecentReferenceImages({
      messages: [...messages, phoneMessage(5, 'Blake', 'Avery', 'blake_avery_02')], nodes: [],
      options: { enabled: true, turnLookback: 1, phoneTurnLookback: 4, maxImages: 3, scope },
    }).map((reference) => reference.imageId);
    expect(scoped(phoneReferenceImageScope('Avery', 'Blake')))
      .toEqual(['blake_avery_02', 'blake_avery_01']);
    expect(scoped(rpReferenceImageScope)).toEqual(['blake_avery_02', 'avery_casey_01']);
  });

  it('keeps images of the latest two conversation messages beyond the lookback', () => {
    const later: MessageRecord[] = Array.from({ length: 12 }, (_, index) => ({
      id: 10 + index, role: 'user', originalText: 'Later.', includeInHistory: true,
      turnNumber: 10 + index,
    }));
    const scoped = (history: MessageRecord[]) => collectRecentReferenceImages({
      messages: history, nodes: [],
      options: {
        enabled: true, turnLookback: 5, phoneTurnLookback: 10, maxImages: 3,
        scope: phoneReferenceImageScope('Avery', 'Blake'),
      },
    }).map((reference) => reference.imageId);
    expect(scoped([...messages, ...later])).toEqual(['blake_avery_01', 'avery_blake_01']);
    const textOnly = (id: number): MessageRecord => ({
      ...phoneMessage(id, 'Avery', 'Blake', 'unused'), imageAttachments: [], phoneImageIds: [],
    });
    expect(scoped([...messages.slice(0, 2), textOnly(5), textOnly(6), ...later])).toEqual([]);
  });
});


describe('fixed reference image rules', () => {
  const rp = (turnNumber: number): MessageRecord => ({
    id: 100 + turnNumber, role: 'user', originalText: 'Continue.', turnNumber,
  });
  function collectHistory(history: MessageRecord[], scope = rpReferenceImageScope,
    extra: Partial<import('./referenceImages').ReferenceImageOptions> = {}) {
    return collectRecentReferenceImages({ messages: history, nodes: [],
      options: { ...fixedReferenceImageOptions, scope, ...extra },
    }).map((reference) => reference.imageId);
  }

  it('expires card images after three turns and direct RP images after five', () => {
    const first = [
      phoneMessage(1, 'Avery', 'Blake', 'phone'),
      { ...rp(1), imageAttachments: [image('rp')] },
    ];
    expect(collectHistory([...first, rp(2), rp(3)])).toEqual(['rp', 'phone']);
    expect(collectHistory([...first, rp(2), rp(3), rp(4)])).toEqual(['rp']);
    expect(collectHistory([...first, rp(2), rp(3), rp(4), rp(5)])).toEqual(['rp']);
    expect(collectHistory([...first, rp(2), rp(3), rp(4), rp(5), rp(6)])).toEqual([]);
  });

  it('does not renew a card image through its embedded link or duplicate it', () => {
    const card = phoneMessage(1, 'Avery', 'Blake', 'phone');
    const narrative = { ...rp(1), embeddedPhoneMessages: [{
      phoneMessageId: 1, from: 'Avery', to: 'Blake', message: 'Photo.',
    }] };
    expect(collectHistory([card, narrative])).toEqual(['phone']);
    expect(collectHistory([card, narrative, rp(2), rp(3), rp(4)])).toEqual([]);
  });

  it('keeps the messenger exception out of RP and other messenger pairs', () => {
    const history = [phoneMessage(1, 'Avery', 'Blake', 'phone'),
      ...Array.from({ length: 20 }, (_, index) => rp(index + 2))];
    expect(collectHistory(history, phoneReferenceImageScope('Avery', 'Blake'))).toEqual(['phone']);
    expect(collectHistory(history, phoneReferenceImageScope('Avery', 'Casey'))).toEqual([]);
    expect(collectHistory(history)).toEqual([]);
  });

  it('rejects manual selections captured in a different view at run time', () => {
    const scope = phoneReferenceImageScope('Avery', 'Blake');
    const history = [phoneMessage(1, 'Avery', 'Blake', 'phone'),
      ...Array.from({ length: 20 }, (_, index) => rp(index + 2))];
    expect(collectHistory(history, rpReferenceImageScope, {
      additionalImageIds: ['phone'], additionalImageScope: scope,
    })).toEqual([]);
    expect(collectHistory(history, phoneReferenceImageScope('Avery', 'Casey'), {
      additionalImageIds: ['phone'], additionalImageScope: scope,
    })).toEqual([]);
    expect(collectHistory(history, rpReferenceImageScope, {
      additionalImageIds: ['phone'], additionalImageScope: rpReferenceImageScope,
    })).toEqual(['phone']);
  });
});


it('resolves social card images stored only as gallery IDs and expires them in RP', () => {
  const book = normalizeRpStorybook({ ...emptyRpStorybook, characters: [{
    ...structuredClone(fixture.character), images: [{ ...image('social-photo'), mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/' }],
  }] });
  const imageId = book.characters[0].images[0].id;
  const nodes = [{ id: 'book', data: { nodeType: 'rp-storybook', storybookJson: rpStorybookJsonText(book) } } as WorkflowNode];
  const message: MessageRecord = {
    id: 1, role: 'output', originalText: 'Photo.', turnNumber: 1,
    socialDirectMessage: {
      app: 'fotogram', messageId: 'dm1', from: 'Avery', fromHandle: 'avery',
      to: 'Blake', toHandle: 'blake', text: 'Photo.', sentAt: '', imageIds: [imageId],
    },
  };
  const collect = (messages: MessageRecord[]) => collectRecentReferenceImages({
    messages, nodes, options: { ...fixedReferenceImageOptions, scope: rpReferenceImageScope },
  }).map((reference) => reference.imageId);
  expect(collect([message])).toEqual([imageId]);
  expect(collect([message, ...[2, 3, 4].map((turnNumber): MessageRecord => ({
    id: turnNumber, role: 'user', originalText: 'Later.', turnNumber,
  }))])).toEqual([]);
});
