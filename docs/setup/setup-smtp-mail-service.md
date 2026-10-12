# SMTP mail service and troubleshooting

[Guide overview](setup-smtp.md)

### Mail Service Example

Create `backend/src/mail/mail.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get('SMTP_HOST'),
      port: this.configService.get('SMTP_PORT'),
      secure: this.configService.get('SMTP_SECURE') === 'true',
      auth: {
        user: this.configService.get('SMTP_USER'),
        pass: this.configService.get('SMTP_PASS'),
      },
    });
  }

  async sendActivationCode(email: string, code: string, name: string) {
    const mailOptions = {
      from: this.configService.get('EMAIL_FROM'),
      to: email,
      subject: 'Verify Your Email - Activation Code',
      html: `
        <h2>Welcome ${name}!</h2>
        <p>Your activation code is:</p>
        <h1 style="font-size: 32px; letter-spacing: 5px; font-weight: bold;">${code}</h1>
        <p>This code will expire in 15 minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `,
      text: `Welcome ${name}! Your activation code is: ${code}. This code will expire in 15 minutes.`,
    };

    return this.transporter.sendMail(mailOptions);
  }

  async sendPasswordReset(email: string, code: string, name: string) {
    const mailOptions = {
      from: this.configService.get('EMAIL_FROM'),
      to: email,
      subject: 'Password Reset Code',
      html: `
        <h2>Hello ${name}</h2>
        <p>You requested to reset your password. Use this code:</p>
        <h1 style="font-size: 32px; letter-spacing: 5px; font-weight: bold;">${code}</h1>
        <p>This code will expire in 15 minutes.</p>
        <p>If you didn't request this, please ignore this email and your password will remain unchanged.</p>
      `,
      text: `Hello ${name}. Your password reset code is: ${code}. This code will expire in 15 minutes.`,
    };

    return this.transporter.sendMail(mailOptions);
  }

  async verifyConnection() {
    return this.transporter.verify();
  }
}
```

### Verify Configuration on Startup

Add to `backend/src/mail/mail.module.ts`:

```typescript
import { Module, OnModuleInit } from '@nestjs/common';
import { MailService } from './mail.service';

@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule implements OnModuleInit {
  constructor(private mailService: MailService) {}

  async onModuleInit() {
    try {
      await this.mailService.verifyConnection();
      console.log('✅ SMTP connection verified');
    } catch (error) {
      console.error('❌ SMTP connection failed:', error.message);
    }
  }
}
```

---

## Testing Email Sending

### Test Connection

```bash
cd backend
pnpm run start:dev
```

Look for console output:

- ✅ `SMTP connection verified` - Configuration is correct
- ❌ `SMTP connection failed` - Check credentials and settings

### Send Test Email

Create a test endpoint:

```typescript
@Get('test-email')
async testEmail() {
  await this.mailService.sendActivationCode(
    'test@example.com',
    '123456',
    'Test User'
  );
  return { message: 'Test email sent' };
}
```

Visit: `http://localhost:3000/api/test-email`

### Using cURL

```bash
curl http://localhost:3000/api/test-email
```

---

## Troubleshooting

### Error: "Invalid login: 535 Authentication failed"

**Gmail**:

- Use App Password, not regular password
- Enable 2FA first
- Remove spaces from App Password

**Other providers**:

- Verify username/password are correct
- Check if SMTP is enabled in account settings

### Error: "Connection timeout"

**Cause**: Firewall blocking SMTP port or wrong host.

**Solution**:

- Check `SMTP_HOST` is correct
- Try port 587 (TLS) or 465 (SSL)
- Check firewall/antivirus settings
- Some networks block port 25, 465, 587

**Test connection**:

```bash
telnet smtp.gmail.com 587
# Should connect successfully
```

### Error: "self signed certificate in certificate chain"

**Cause**: Self-signed SSL certificate.

**Solution**: use a mail host whose certificate this machine trusts, or add the signing authority to the machine. The server always checks the certificate and has no setting that turns the check off. For local work, a mail catcher on a plain port with `SMTP_SECURE=false` avoids the question.

### Error: "Greeting never received"

**Cause**: Wrong SMTP port or SSL/TLS configuration.

**Solution**:

- Port 587 → `SMTP_SECURE=false` (TLS/STARTTLS)
- Port 465 → `SMTP_SECURE=true` (SSL)
- Never use port 25 for client applications

### Error: "Message rejected: Email address is not verified"

**AWS SES Only**:

- In sandbox mode, both sender and recipient must be verified
- Request production access to send to any email
- [Verify email addresses](https://console.aws.amazon.com/ses/)

### Emails Going to Spam

**Solutions**:

1. **Authenticate your domain**: Set up SPF, DKIM, DMARC records
2. **Use a dedicated email service**: Gmail/Outlook flag bulk emails
3. **Avoid spam triggers**:
   - Don't use all caps in subject
   - Include plain text version
   - Add unsubscribe link
4. **Build sender reputation**: Start with low volume, increase gradually
5. **Use dedicated domain**: Don't send from gmail.com/outlook.com for production

---

## Email Best Practices

### HTML Email Templates

Create reusable templates:

```typescript
// templates/activation-email.html
function getActivationTemplate(name: string, code: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .code { font-size: 32px; letter-spacing: 5px; font-weight: bold; color: #007bff; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Welcome ${name}!</h2>
          <p>Thank you for registering. Please verify your email with this code:</p>
          <div class="code">${code}</div>
          <p>This code expires in 15 minutes.</p>
          <hr>
          <p style="color: #666; font-size: 12px;">
            If you didn't request this, please ignore this email.
          </p>
        </div>
      </body>
    </html>
  `;
}
```

### Always Include Plain Text

```typescript
{
  html: htmlContent,
  text: stripHtml(htmlContent), // Fallback for email clients that don't support HTML
}
```

### Rate Limiting

Prevent abuse:

```typescript
@Injectable()
export class MailService {
  private emailQueue = new Map<string, number>();

  async checkRateLimit(email: string) {
    const now = Date.now();
    const lastSent = this.emailQueue.get(email) || 0;

    if (now - lastSent < 60000) {
      // 1 minute cooldown
      throw new Error('Please wait before requesting another email');
    }

    this.emailQueue.set(email, now);
  }
}
```
