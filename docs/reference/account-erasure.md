# What account erasure removes and what remains

Erasure runs only while `ACCOUNT_ERASE_GRACE_DAYS` is set; see
[`docs/setup/setup-account-lifecycle.md`](../setup/setup-account-lifecycle.md). The account's
session ids, its addresses and its linked identities are read before anything is deleted, so no
row left behind can match a later account that registers the same address. A pending email
change's address counts only while the account still holds its claim on it. Once the claim
lapses, the address may be another account's, and nothing is removed by it.

## Removed in the final transaction

| Data                                                                         | Found by                                           | Feature      |
| ---------------------------------------------------------------------------- | -------------------------------------------------- | ------------ |
| The account itself, address, remembered device hashes and daily notice count | id                                                 | core         |
| Browser and mobile sessions                                                  | account                                            | core         |
| Mobile access and refresh tokens                                             | the account's session ids                          | core         |
| Mobile authorization requests and their codes                                | account                                            | core         |
| Application grants                                                           | account                                            | core         |
| Linked provider identities                                                   | account                                            | core         |
| Mobile sign-in attempts                                                      | the account, or one of its addresses               | core         |
| Address claims, such as a pending email change                               | the account as owner                               | core         |
| Sign-up and email change codes                                               | the account, or one of its addresses               | core         |
| Password reset codes and mail counters                                       | one of its addresses                               | core         |
| Provider link tickets                                                        | account                                            | `oauth-core` |
| Passkeys and passkey challenges                                              | the account, or one of its session ids             | `passkeys`   |
| Two-factor secret, recovery codes, challenges                                | account                                            | `totp`       |
| Magic links                                                                  | one of its addresses                               | `magic-link` |
| Emailed sign-in codes                                                        | one of its addresses                               | `email-code` |
| Kept provider refresh tokens                                                 | its linked identities; moved into a revocation job | `oauth-core` |

## What remains, and until when

| Item                     | What it holds                                                                                                                   | Removed                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Security log rows        | The erased id as actor or as target, the action, the time and other ids. Names and addresses in details are removed             | When the log's own retention ends: 90 days for sign-in events, `ACTIVITY_RETENTION_DAYS` for staff actions |
| The erasure job row      | The account id, the steps' times, the attempt count and the failure code                                                        | 90 days after the erasure finished                                                                         |
| Deletion receipt         | A hash of the receipt key, the account id and the erasure date                                                                  | 90 days after the deletion, whatever became of the account                                                 |
| Provider revocation job  | The provider, the provider's id for the person, the account id and, until Apple confirms or staff close it, the encrypted token | When Apple confirms or staff close it, the token; the row 30 days after it was written at most             |
| Late Apple refresh token | A token kept by an Apple sign-in that raced the erasure, encrypted, with the provider's id for the person                       | A day after it was kept, it moves into a revocation job with no account, then as above                     |

The host product's own data is removed by its `HOST_ERASURE_HOOK`, which runs before the final
transaction, or inside it when the hook sets `runsInEraseTransaction`.

## Not covered yet

- Staff invitations that the erased account sent arrive with the staff console work and join
  the removal list there.
