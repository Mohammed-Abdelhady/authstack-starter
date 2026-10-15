# Staff Console Setup Guide

Used from plan 4. Today existing administrative requests and security events retain their current behavior. Strict mutations and staff activity classification are not implemented.

## Reserved settings

| Setting                   | Reservation                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `ACTIVITY_RETENTION_DAYS` | Used from plan 4. Reserved staff activity retention. Existing events keep 90 days. Default `730`. |
| `ADMIN_STRICT_MUTATIONS`  | Used from plan 4. Reserved strict mutation switch. Default `false`.                               |

The reserved retention value is not the existing security-event purge setting.
Existing events keep their current 90-day retention. Plan 4 adds classification
before applying the 730-day staff retention value.
