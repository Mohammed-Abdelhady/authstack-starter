# Invitations Setup Guide

Staff invite a person by address. Nothing is created until the person accepts: the account is made
then, with the invited role, and signed in to the application the invitation was made for. The
`invitations` feature is still marked planned in the generator, so a generated project does not carry
it yet.

## Settings

| Setting                 | What it does                                                    | Default     |
| ----------------------- | --------------------------------------------------------------- | ----------- |
| `INVITATION_EXPIRES_IN` | How long an invitation can be accepted, in milliseconds. 7 days | `604800000` |

## How an invitation works

- `POST /api/admin/invitations` takes an address, a role and an optional name. It needs
  `users:create:all`, or `users:create:staff` for a staff role, and the role rules of creating an account
  apply. The address is held from that moment: nobody can register it, invite it again or move an
  account to it until the invitation is accepted, revoked or expires.
- The mail carries a link to `/auth/invitation` on the invitation's application, the admin address for a
  staff role when `ADMIN_URL` is set, the web address otherwise. The token is in the link's fragment, so
  it never reaches a web server's log. The page reads it, removes it from the address bar, and posts it
  only when the person presses Accept. A mail scanner that opens the link spends nothing.
- Acceptance checks again that the role exists with the same audience, and that the person who invited
  still has the authority to give it. Where the application requires a passkey, the new account gets a
  15-minute enrolment session to register one.
- Only a hash of the token is stored. A resend replaces the token, and the old link stops working.

## Administrators

The `admin` role is never assigned through the API. It is given only by an invitation from an
administrator who has just proved themselves again: with a verified passkey where the admin application
requires one, otherwise with a code mailed to their own address. Administrators recover each other the
same way, by a passkey reset or an address change.

Two commands cover what no administrator can do from the console. Run them where the server runs:

```bash
pnpm --filter backend run admin:invite -- --email first.admin@example.com
pnpm --filter backend run admin:recover -- --email admin@example.com
pnpm --filter backend run admin:recover -- --email admin@example.com --new-email new@example.com
```

- `admin:invite` makes the first administrator's invitation. It refuses while an active administrator or
  an open administrator invitation exists.
- `admin:recover` gets a locked-out administrator back in. Where the admin application requires a
  passkey, it mails an enrolment link. Where it does not, the mailbox is what was lost, so it needs
  `--new-email`: the code goes to the new address, the old one is told, and confirming the code moves the
  address and ends every session.
- An enrolment link, from a passkey reset or `admin:recover`, works only while the account keeps the
  address it was mailed to. Starting an address change retires it.

Neither command prints a token, a code or a link, and both record what they did in the activity log.
