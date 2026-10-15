# Email Code Setup Guide

Used from plan 2. Today email-code sign-in is planned and cannot be selected by the generator. Core mailed action proof is reserved independently of this optional sign-in method.

## Reserved settings

| Setting                        | Reservation                                                                |
| ------------------------------ | -------------------------------------------------------------------------- |
| `EMAIL_CODE_ENABLED`           | Used from plan 2. Reserved email-code sign-in switch. Default `false`.     |
| `EMAIL_CODE_EXPIRES_IN`        | Used from plan 2. Milliseconds, ten minutes by default. Default `600000`.  |
| `EMAIL_CODE_REVIEW_ACCOUNT_ID` | Used from plan 2. Optional review account, all four review fields or none. |
| `EMAIL_CODE_REVIEW_CLIENT_ID`  | Used from plan 2. Optional review application.                             |
| `EMAIL_CODE_REVIEW_CODE_HASH`  | Used from plan 2. Optional secret review-code digest.                      |
| `EMAIL_CODE_REVIEW_UNTIL`      | Used from plan 2. Optional ISO timestamp, at most 30 days ahead.           |

The review fields are all set or all absent. `EMAIL_CODE_REVIEW_UNTIL` is an ISO
timestamp no more than 30 days ahead. Plan 2 must also refuse expired review
credentials when used. No fixed reviewer code is active today.

Core `proofCode` mail and `FreshProofSender` survive generation without this
feature. Plan 4 supplies the proof issuance and consumption workflow. No route
sends this mail today.
