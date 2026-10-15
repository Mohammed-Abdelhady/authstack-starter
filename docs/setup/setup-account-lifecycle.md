# Account Lifecycle Setup Guide

Used from plan 5. Today account deletion remains reversible soft deletion. No erasure worker or provider-token retention is enabled.

## Reserved settings

| Setting                                  | Reservation                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ACCOUNT_ERASE_GRACE_DAYS`               | Used from plan 5. Unset disables erasure, zero means immediate erasure once implemented. |
| `PROVIDER_TOKEN_ENCRYPTION_KEY`          | Used from plan 5. Optional secret provider-token encryption key.                         |
| `PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS` | Used from plan 5. Optional previous secret key during rotation.                          |

Keep optional, secret and erasure settings unset until plan 5 is implemented.
Provider-token keys require at least 32 characters and are parsed independently.
Plan 5 must require a current key when a previous key is set, and require the keys
to differ.
A grace period of `0` must remain distinct from absence. Plan 5 must replace the
disabled erasure-lock binding before starting an erasure worker.
