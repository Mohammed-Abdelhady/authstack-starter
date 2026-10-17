import { mailHarness } from './mail-service.harness-spec';

jest.mock('nodemailer');

const ENGLISH = { email: 'user@example.com', locale: 'en' } as const;
const SIGN_OFF = 'Best regards,\nThe Team';
const XSS_NAME = '<script>alert("xss")</script>';

/**
 * English mail is what it was before the catalogue: every text part, subject
 * and link below is written out by hand.
 */
describe('English mail', () => {
  it('sends the activation code as before', async () => {
    const { service, lastMail } = mailHarness();

    await service.sendActivationCode(ENGLISH, '123456');

    expect({ subject: lastMail().subject, text: lastMail().text }).toEqual({
      subject: 'Verify Your Email Address',
      text: [
        'Hi,',
        'Thank you for registering! Please use the following 6-digit verification code to complete your registration:',
        '123456',
        'This code will expire in 10 minutes.',
        "If you didn't request this code, you can safely ignore this email.",
        SIGN_OFF,
      ].join('\n\n'),
    });
  });

  it('sends the email change code with its confirmation link as before', async () => {
    const { service, lastMail } = mailHarness();

    await service.sendEmailChangeCode(ENGLISH, '654321');

    expect({ subject: lastMail().subject, text: lastMail().text }).toEqual({
      subject: 'Confirm your new email address',
      text: [
        'Hi,',
        'An administrator changed the email address on your account. Open the confirmation page and enter this code to finish the change:',
        'http://localhost:3000/auth/confirm-email-change',
        'Code: 654321',
        'This code will expire in 10 minutes.',
        "If you didn't expect this change, contact your administrator.",
        SIGN_OFF,
      ].join('\n\n'),
    });
    expect(lastMail().html).toContain(
      'href="http://localhost:3000/auth/confirm-email-change"',
    );
  });

  it('sends the password reset code with the name as given', async () => {
    const { service, lastMail } = mailHarness();

    await service.sendPasswordResetCode(ENGLISH, '654321', 'Jane');

    expect({ subject: lastMail().subject, text: lastMail().text }).toEqual({
      subject: 'Reset Your Password',
      text: [
        'Hi Jane,',
        'You requested to reset your password. Please use the following 6-digit code to reset your password:',
        '654321',
        'This code will expire in 10 minutes.',
        "If you didn't request this code, you can safely ignore this email. Your password will remain unchanged.",
        SIGN_OFF,
      ].join('\n\n'),
    });
  });

  it('escapes the name before it reaches the HTML part', async () => {
    const { service, lastMail } = mailHarness();

    await service.sendPasswordResetCode(ENGLISH, '654321', XSS_NAME);

    expect(lastMail().html).toContain('&lt;script&gt;');
    expect(lastMail().html).not.toContain('<script>');
    expect(lastMail().text).toContain(`Hi ${XSS_NAME},`);
  });

  it('sends a sign-in link with its lifetime in the singular', async () => {
    const { service, lastMail } = mailHarness();
    const link = 'http://localhost:3000/auth/magic-link/verify?token=abc';

    await service.sendMagicLink(ENGLISH, link, 1);

    expect({ subject: lastMail().subject, text: lastMail().text }).toEqual({
      subject: 'Your Sign-In Link',
      text: [
        'Use this link to sign in. It works once:',
        link,
        'The link expires in 1 minute.',
        'If you did not request this, ignore this email.',
        SIGN_OFF,
      ].join('\n\n'),
    });
    expect(lastMail().html).toContain(`href="${link}"`);
  });
});
