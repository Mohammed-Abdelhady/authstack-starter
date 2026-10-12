# Email changes and mail

This guide covers administrator email changes, confirmation messages, and mail settings.

## Admin email changes

### Confirming an admin email change

An administrator can ask for an account to move to a new address. The server
mails a code to the new address and the user confirms it without a password; no
session is issued.

The account keeps its own address until that code is confirmed. Until then the
new address cannot sign in, reset the password, follow a magic link into the
account or be linked by a provider, and the old address still can. Confirming
moves the address and ends every session of the account, because the person who
confirms from the new mailbox need not be the person who was signed in. A second
request replaces the first. A notice is mailed to the old address when the
request is made.

```
POST /api/auth/confirm-email-change
```

Request body:

```json
{
  "email": "new@example.com",
  "code": "123456"
}
```

The mail links to the web page `/auth/confirm-email-change`, which collects the
address and the code. The code must still match the account and the address
generation the change was issued under, so a superseded change confirms
nothing. A wrong, missing, expired or stale code answers `400`
`ACTIVATION_CODE_INVALID`.

An administrator can re-issue the code from the admin API:

```
POST /api/admin/users/:id/resend-email-change
```

It answers `429` `EMAIL_SEND_LIMIT_REACHED` when the address is over its
per-window mail cap, and `400` `EMAIL_SEND_FAILED` when the mail could not be
sent.

---

## Email templates

### Activation Email

```
Subject: Verify Your Email Address

Hi {name},

Thank you for registering! Please use the following
6-digit verification code to complete your registration:

        {code}

This code will expire in {N} minutes.

If you didn't request this code, you can safely ignore this email.

Best regards,
The Team
```

`{N}` is the configured `ACTIVATION_CODE_EXPIRES_IN` in minutes (15 with the
default lifetime).

### Email-Change Confirmation Email

```
Subject: Confirm your new email address

Hi,

An administrator changed the email address on your account. Open the
confirmation page and enter this code to finish the change:

{link to /auth/confirm-email-change}

Code: {code}

This code will expire in {N} minutes.

If you didn't expect this change, contact your administrator.

Best regards,
The Team
```

---

## Environment configuration

```bash
# SMTP (Nodemailer)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
EMAIL_FROM=noreply@yourapp.com

# Security
BCRYPT_ROUNDS=10

# Session
SESSION_COOKIE_NAME=sid
SESSION_COOKIE_MAX_AGE=604800000  # 7 days in ms

# Activation
ACTIVATION_CODE_EXPIRES_IN=900000  # 15 min in ms
ACTIVATION_MAX_ATTEMPTS=5
```

---
