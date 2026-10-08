# Money Ledger

Unified accounting for the Banking app and the OnlyFriends wallet.
Implementation: `src/chat/moneyLedger.ts` (`characterMoneyLedger`).

## Model

Balances are never stored. `characterMoneyLedger` replays the ledger sources in
timeline order and returns one character's bank balance, wallet balance and
booked entries. `bankingBalanceForCharacter` and `onlyFriendsWalletBalance` are
thin wrappers; no other code computes balances.

| Source | Record | Storage |
| --- | --- | --- |
| Bank transfer | `MessageRecord.bankTransfer` | Timeline |
| Wallet top-up / withdrawal | `bankTransfer` to or from `OnlyFriends Wallet` | Timeline |
| OnlyFriends DM tip | `MessageRecord.socialDirectMessage.tip` | Timeline |
| Post unlock | `onlyFriendsPurchasesByCharacter[buyerId][postId]` | Session UI state |
| Start balance | `character.banking.startBalance` | Character |

Because the ledger is derived, undo, regeneration and message deletion revert
their money movements automatically.

## Persistence

- RP Save: timeline messages plus `ui.onlyFriendsPurchasesByCharacter`.
- Opening History: `openingHistory.turns` plus `openingHistory.onlyFriendsPurchases`.
  `Import Current Session` snapshots the purchases; starting from a Storybook
  restores them, so opening transfers, tips and unlocks all affect balances.

## Booking rules

- **Bank**: both sides of a transfer are always booked. Accounts may go
  negative; a transfer is never rejected for missing funds.
- **OnlyFriends wallet**: never negative. An outgoing tip or withdrawal debits
  only what the wallet holds at that point. Tip recipients are credited in full;
  the uncovered part of a tip is treated as funds outside the ledger. A wallet
  withdrawal credits the bank only with the amount actually debited from the
  wallet; it never creates money.
- **Post unlock**: debits the buyer's wallet and credits the creator's wallet
  when the creator is a known character. Purchases have no timeline position:
  sales are booked before the timeline replay, purchases after it.
- Parties are matched by character name; wallet tips also match the
  OnlyFriends handle. A party without a character has no account.

## Validation at commit time

- Player actions are checked in the UI: Banking `Send Money` and wallet top-ups
  against the bank balance; tips, unlocks and withdrawals against the wallet
  balance (`submitSocialDirectMessage` re-checks tips).
- `useGraphRun` books every model-emitted bank transfer. It only rejects a
  wallet withdrawal that exceeds the wallet balance and a transfer where
  neither party has an account.

## UI

- Banking statement: `bankTransactionsForCharacter`.
- OnlyFriends `Manage funds` panel: `onlyFriendsWalletActivity`, newest first.
