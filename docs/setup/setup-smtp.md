# SMTP Setup Guide (Nodemailer)

This guide explains how to set up Nodemailer for sending emails (registration verification, password reset, etc.).

## Overview

The application uses Nodemailer, a flexible email library for Node.js that supports multiple SMTP providers:

- **Gmail**: Free tier available, easy setup
- **Outlook/Office 365**: Microsoft email service
- **Custom SMTP**: Your own mail server
- **Other providers**: Mailgun, SendGrid, AWS SES, etc.

**Email Types**:

- Registration: 6-digit activation codes
- Password Reset: 6-digit reset codes
- Notifications: Account updates, security alerts

---

## Option 1: Gmail SMTP (Recommended for Development)

Gmail is the easiest option for development and testing.

### Prerequisites

- Gmail account
- Google App Password (required for SMTP access)

### Step 1: Enable 2-Factor Authentication

Gmail requires 2FA to use App Passwords.

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Navigate to **2-Step Verification**
3. Click **Get Started**
4. Follow the setup wizard:
   - Verify phone number
   - Choose verification method (SMS, authenticator app, etc.)
   - Enable 2-Step Verification

### Step 2: Create App Password

1. Go to [App Passwords](https://myaccount.google.com/apppasswords)
2. Select app:
   - **Select app**: Mail
   - **Select device**: Other (Custom name)
   - **Name**: `Auth Boilerplate` or your app name
3. Click **Generate**
4. Copy the 16-character password (format: `xxxx xxxx xxxx xxxx`)
5. Store securely (you won't see it again)

**Important**: Remove spaces when using the password.

### Step 3: Configure Environment Variables

Add to `backend/.env`:

```bash
# Gmail SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=xxxxxxxxxxxxxxxx  # App Password (no spaces)

# Email sender
EMAIL_FROM=your-email@gmail.com
```

### Gmail Limitations

- **Daily Limit**: 500 emails/day (2000/day for Google Workspace)
- **Rate Limit**: 100 emails/hour
- **Recipients**: Max 500 recipients per email

**For production**: Use a dedicated email service instead of Gmail.

---

## Option 2: Outlook/Office 365 SMTP

Microsoft email service with good deliverability.

### Step 1: Enable SMTP Authentication

1. Log in to [Outlook.com](https://outlook.com)
2. Go to **Settings** → **View all Outlook settings**
3. Navigate to **Mail** → **Sync email**
4. Ensure **SMTP** is enabled

### Step 2: Configure Environment Variables

Add to `backend/.env`:

```bash
# Outlook SMTP Configuration
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@outlook.com
SMTP_PASS=your-password

# Email sender
EMAIL_FROM=your-email@outlook.com
```

**For Office 365 (Business)**:

```bash
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
```

### Outlook Limitations

- **Daily Limit**: 300 emails/day (free), 10,000/day (business)
- **Recipients**: Max 500 recipients per email

---

## Option 3: Custom SMTP Server

Use your own mail server or hosting provider's SMTP.

### Common Providers

**cPanel Hosting**:

```bash
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=587
SMTP_USER=noreply@yourdomain.com
SMTP_PASS=your-password
```

**Namecheap Private Email**:

```bash
SMTP_HOST=mail.privateemail.com
SMTP_PORT=587
```

**GoDaddy Email**:

```bash
SMTP_HOST=smtpout.secureserver.net
SMTP_PORT=465
SMTP_SECURE=true
```

**Hostinger**:

```bash
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=587
```

### Configuration

Add to `backend/.env`:

```bash
# Custom SMTP Configuration
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=587          # Use 465 for SSL, 587 for TLS
SMTP_SECURE=false      # true for port 465, false for other ports
SMTP_USER=noreply@yourdomain.com
SMTP_PASS=your-password

# Email sender
EMAIL_FROM=noreply@yourdomain.com
```

### Find Your SMTP Settings

Contact your hosting provider or check:

- cPanel: **Email Accounts** → **Connect Devices**
- Plesk: **Mail** → **Mail Settings**
- Provider documentation

---

## Option 4: Dedicated Email Services

For production, use a dedicated transactional email service.

### Mailgun

**Pros**: Generous free tier (5,000 emails/month), good deliverability

```bash
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@yourdomain.mailgun.org
SMTP_PASS=your-mailgun-password

EMAIL_FROM=noreply@yourdomain.com
```

**Setup**: [Mailgun Documentation](https://documentation.mailgun.com/en/latest/quickstart.html)

### SendGrid

**Pros**: 100 emails/day free, excellent deliverability

```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key

EMAIL_FROM=noreply@yourdomain.com
```

**Setup**: [SendGrid SMTP Integration](https://docs.sendgrid.com/for-developers/sending-email/integrating-with-the-smtp-api)

### AWS SES (Amazon Simple Email Service)

**Pros**: Very cheap ($0.10 per 1,000 emails), scalable

```bash
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=your-aws-smtp-username
SMTP_PASS=your-aws-smtp-password

EMAIL_FROM=noreply@yourdomain.com
```

**Setup**: [AWS SES SMTP Setup](https://docs.aws.amazon.com/ses/latest/dg/send-email-smtp.html)

### Postmark

**Pros**: Excellent deliverability, 100 emails/month free

```bash
SMTP_HOST=smtp.postmarkapp.com
SMTP_PORT=587
SMTP_USER=your-server-api-token
SMTP_PASS=your-server-api-token

EMAIL_FROM=noreply@yourdomain.com
```

**Setup**: [Postmark SMTP](https://postmarkapp.com/developer/user-guide/send-email-with-smtp)

---

## Environment Variables Reference

### Required Variables

| Variable      | Description                           | Example                  |
| ------------- | ------------------------------------- | ------------------------ |
| `SMTP_HOST`   | SMTP server hostname                  | `smtp.gmail.com`         |
| `SMTP_PORT`   | SMTP port (587 for TLS, 465 for SSL)  | `587`                    |
| `SMTP_SECURE` | Use SSL (true for 465, false for 587) | `false`                  |
| `SMTP_USER`   | SMTP username (usually email)         | `your-email@gmail.com`   |
| `SMTP_PASS`   | SMTP password or API key              | `xxxxxxxxxxxxxxxx`       |
| `EMAIL_FROM`  | Sender email address                  | `noreply@yourdomain.com` |

### Optional Variables

No setting holds the sender's display name. To show one, write it into `EMAIL_FROM`, for example `EMAIL_FROM="Auth App <noreply@yourdomain.com>"`.

The server always checks the mail host's TLS certificate. No setting turns that off.

---

## Backend Implementation

### Install Nodemailer

```bash
cd backend
pnpm add nodemailer
pnpm add -D @types/nodemailer
```

## More sections

- [SMTP mail service and troubleshooting](setup-smtp-mail-service.md)
- [SMTP production recommendations](setup-smtp-production.md)
