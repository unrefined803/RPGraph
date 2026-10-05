import { describe, expect, it } from 'vitest';
import { appCharactersFromRegistry } from '../characters/appRuntime';
import type { Character } from '../characters/character';
import fixture from '../characters/fixtures/stage4-npc.json';
import { buildCharacterRegistry, type CharacterRegistryEntry } from '../characters/registry';
import { emptyRpStorybook, parseRpStorybookJson, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import type { MessageRecord } from '../types';
import { bankingBalanceForCharacter } from './bankTransfers';
import { characterMoneyLedger, onlyFriendsWalletName } from './moneyLedger';
import { onlyFriendsWalletActivity, onlyFriendsWalletBalance } from './onlyFriendsWallet';

function entry(id: string, name: string, startBalance: number): CharacterRegistryEntry {
  const character = structuredClone(fixture.character) as Character;
  character.id = id;
  character.name = name;
  character.banking = { startBalance, fixedExpenses: [] };
  return { character, tier: 'storybook', source: id };
}

function setup() {
  const characters = appCharactersFromRegistry(buildCharacterRegistry([
    entry('mia', 'Mia Stone', 1000),
    entry('alex', 'Alex Reed', 1000),
  ]));
  const byName = (name: string) => characters.find((character) => character.name === name)!;
  return { characters, mia: byName('Mia Stone'), alex: byName('Alex Reed') };
}

let nextId = 1;
function transfer(from: string, to: string, amount: number): MessageRecord {
  return { id: nextId++, role: 'output', originalText: '', bankTransfer: { from, to, amount } };
}

function tip(from: string, to: string, amount: number): MessageRecord {
  return {
    id: nextId++,
    role: 'output',
    originalText: '',
    socialDirectMessage: {
      app: 'onlyfriends', messageId: `tip-${nextId}`, from, fromHandle: from.toLowerCase().replace(/\s+/g, '.'),
      to, toHandle: to.toLowerCase().replace(/\s+/g, '.'), text: 'Tip', tip: amount,
      sentAt: '2026-06-01T12:00:00.000Z',
    },
  };
}

describe('money ledger', () => {
  it('books a bank transfer on both accounts', () => {
    const { mia, alex } = setup();
    const messages = [transfer('Mia Stone', 'Alex Reed', 500)];
    expect(bankingBalanceForCharacter(mia, messages)).toBe(500);
    expect(bankingBalanceForCharacter(alex, messages)).toBe(1500);
  });

  it('lets a bank account go negative instead of dropping the transfer', () => {
    const { mia, alex } = setup();
    const messages = [transfer('Mia Stone', 'Alex Reed', 1500.5)];
    expect(bankingBalanceForCharacter(mia, messages)).toBe(-500.5);
    expect(bankingBalanceForCharacter(alex, messages)).toBe(2500.5);
  });

  it('credits a tip in full but only debits what the sender wallet holds', () => {
    const { mia, alex } = setup();
    const uncovered = [tip('Mia Stone', 'Alex Reed', 40)];
    expect(onlyFriendsWalletBalance(mia, uncovered)).toBe(0);
    expect(onlyFriendsWalletBalance(alex, uncovered)).toBe(40);

    const partly = [transfer('Mia Stone', onlyFriendsWalletName, 25), ...uncovered];
    expect(onlyFriendsWalletBalance(mia, partly)).toBe(0);
    expect(bankingBalanceForCharacter(mia, partly)).toBe(975);

    const covered = [transfer('Mia Stone', onlyFriendsWalletName, 100), ...uncovered];
    expect(onlyFriendsWalletBalance(mia, covered)).toBe(60);
  });

  it('replays wallet debits in timeline order', () => {
    const { mia } = setup();
    const tipFirst = [tip('Mia Stone', 'Alex Reed', 40), transfer('Mia Stone', onlyFriendsWalletName, 100)];
    expect(onlyFriendsWalletBalance(mia, tipFirst)).toBe(100);
  });

  it('moves withdrawals back to the bank without creating money', () => {
    const { mia } = setup();
    const messages = [
      transfer('Mia Stone', onlyFriendsWalletName, 50),
      transfer(onlyFriendsWalletName, 'Mia Stone', 80),
    ];
    const ledger = characterMoneyLedger(mia, messages);
    expect(ledger.walletBalance).toBe(0);
    expect(ledger.bankBalance).toBe(1000);
  });

  it('debits a post purchase from the buyer and credits the creator', () => {
    const { characters, mia, alex } = setup();
    const post: MessageRecord = {
      id: nextId++, role: 'output', originalText: '',
      socialPost: { app: 'onlyfriends', postId: 'onlyfriends-post-01', author: 'Alex Reed',
        authorHandle: 'alex.reed', caption: 'New set' } as MessageRecord['socialPost'],
    };
    const messages = [transfer('Mia Stone', onlyFriendsWalletName, 20), post];
    const purchases = { [mia.id]: { 'onlyfriends-post-01': 4.99 } };
    expect(onlyFriendsWalletBalance(mia, messages, purchases, characters)).toBe(15.01);
    expect(onlyFriendsWalletBalance(alex, messages, purchases, characters)).toBe(4.99);
    expect(onlyFriendsWalletActivity(mia, messages, purchases, characters).map((item) => item.kind))
      .toEqual(['purchase', 'walletTopUp']);
    expect(onlyFriendsWalletActivity(alex, messages, purchases, characters)[0])
      .toMatchObject({ kind: 'sale', walletDelta: 4.99 });
  });

  it('keeps OnlyFriends purchases in Storybook Opening History', () => {
    const storybook = parseRpStorybookJson(rpStorybookJsonText({
      ...emptyRpStorybook,
      openingHistory: {
        ...emptyRpStorybook.openingHistory,
        onlyFriendsPurchases: { mia: { 'onlyfriends-post-01': 4.99, broken: -1 }, '': { post: 1 } },
      },
    }));
    expect(storybook.openingHistory.onlyFriendsPurchases).toEqual({ mia: { 'onlyfriends-post-01': 4.99 } });
  });
});
