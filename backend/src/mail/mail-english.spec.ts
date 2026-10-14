import { SECURITY_NOTICE } from '../user/constants/security-notice.constants';
import {
  ACTIVATION_CODE_HTML,
  EMAIL_CHANGE_CODE_HTML,
  EMAIL_CHANGE_NOTICE_HTML,
  MAGIC_LINK_HTML,
  PASSWORD_RESET_CODE_HTML,
} from './mail-english.fixture-spec';
import { mailHarness, MailHarness } from './mail-service.harness-spec';

jest.mock('nodemailer');

const ENGLISH = { email: 'user@example.com', locale: 'en' } as const;
const SIGN_OFF = 'Best regards,\nThe Team';
const XSS_NAME = '<script>alert("xss")</script>';

describe('English mail HTML', () => {
  let harness: MailHarness;

  beforeEach(() => {
    harness = mailHarness();
  });

  it.each([
    {
      mail: 'activation code',
      html: ACTIVATION_CODE_HTML,
      send: () => harness.service.sendActivationCode(ENGLISH, '123456'),
    },
    {
      mail: 'email change code',
      html: EMAIL_CHANGE_CODE_HTML,
      send: () => harness.service.sendEmailChangeCode(ENGLISH, '123456'),
    },
    {
      mail: 'email change notice',
      html: EMAIL_CHANGE_NOTICE_HTML,
      send: () => harness.service.sendEmailChangeNotice(ENGLISH),
    },
    {
      mail: 'password reset code',
      html: PASSWORD_RESET_CODE_HTML,
      send: () =>
        harness.service.sendPasswordResetCode(ENGLISH, '123456', "O'Brien <x>"),
    },
    {
      mail: 'sign-in link',
      html: MAGIC_LINK_HTML,
      send: () =>
        harness.service.sendMagicLink(
          ENGLISH,
          'http://localhost:3000/auth/magic-link/verify?token=abc123&next=1',
          15,
        ),
    },
  ])('sends the $mail HTML exactly as before', async ({ html, send }) => {
    await send();

    expect(harness.lastMail().html).toBe(html);
  });
});

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

  it('sends the email change notice as before', async () => {
    const { service, lastMail } = mailHarness();

    await service.sendEmailChangeNotice(ENGLISH);

    expect({ subject: lastMail().subject, text: lastMail().text }).toEqual({
      subject: 'A pending email change was requested',
      text: [
        'Hi,',
        'An administrator requested to change the email address on your account. Your existing address remains active until the new address is confirmed. If you did not expect this request, contact your administrator.',
        SIGN_OFF,
      ].join('\n\n'),
    });
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

  it('sends the registration notice as plain text only', async () => {
    const { service, lastMail } = mailHarness();

    await service.sendRegistrationAttemptNotice(ENGLISH, 'Jane');

    expect(lastMail()).toEqual({
      from: 'noreply@example.com',
      to: 'user@example.com',
      subject: 'Someone tried to register with your email address',
      html: undefined,
      text: [
        'Hi Jane,',
        'Someone just tried to register an account with this email address. You already have an account, so nothing has changed and no new account was created.',
        'If this was you, sign in instead. If you have forgotten your password, use the forgot password link on the sign-in page.',
        'If it was not you, you can ignore this email.',
        SIGN_OFF,
      ].join('\n\n'),
    });
  });

  it.each([
    {
      notice: SECURITY_NOTICE.PASSWORD_RESET,
      subject: 'Your password was reset',
      text: 'The password for your account was reset. If this was not you, contact support immediately.',
    },
    {
      notice: SECURITY_NOTICE.PASSWORD_CHANGED,
      subject: 'Your password was changed',
      text: 'The password for your account was changed. If this was not you, contact support immediately.',
    },
    {
      notice: SECURITY_NOTICE.TWO_FACTOR_DISABLED,
      subject: 'Two-factor authentication was disabled',
      text: 'Two-factor authentication was disabled on your account. If this was not you, contact support immediately.',
    },
    {
      notice: SECURITY_NOTICE.PASSKEY_ADDED,
      subject: 'A passkey was added',
      text: 'A passkey was added to your account. If this was not you, contact support immediately.',
    },
    {
      notice: SECURITY_NOTICE.PROVIDER_ADDED,
      subject: 'A sign-in provider was added',
      text: 'A sign-in provider was linked to your account. If this was not you, contact support immediately.',
    },
  ])(
    'sends the $notice security notice as plain text, as before',
    async ({ notice, subject, text }) => {
      const { service, lastMail } = mailHarness();

      await service.sendSecurityNotice(ENGLISH, notice);

      expect(lastMail()).toEqual({
        from: 'noreply@example.com',
        to: 'user@example.com',
        subject,
        html: undefined,
        text,
      });
    },
  );

  it.each([
    { lifetimeMs: 90000, sentence: 'This code will expire in 1 minute.' },
    { lifetimeMs: 120000, sentence: 'This code will expire in 2 minutes.' },
    { lifetimeMs: 59999, sentence: 'This code will expire in 0 minutes.' },
  ])(
    'rounds a $lifetimeMs ms code lifetime down to whole minutes',
    async ({ lifetimeMs, sentence }) => {
      const { service, lastMail } = mailHarness({
        activation: { codeExpiresIn: lifetimeMs },
      });

      await service.sendActivationCode(ENGLISH, '123456');

      expect(lastMail().text?.split('\n\n')[3]).toBe(sentence);
    },
  );
});
