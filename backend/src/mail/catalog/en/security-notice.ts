import type {
  MailMessages,
  MessagesOf,
} from '../../types/mail-catalogue.types';

export const SECURITY_NOTICE_EN = {
  passwordResetSubject: 'Your password was reset',
  passwordResetText:
    'The password for your account was reset. If this was not you, contact support immediately.',
  passwordChangedSubject: 'Your password was changed',
  passwordChangedText:
    'The password for your account was changed. If this was not you, contact support immediately.',
  twoFactorDisabledSubject: 'Two-factor authentication was disabled',
  twoFactorDisabledText:
    'Two-factor authentication was disabled on your account. If this was not you, contact support immediately.',
  passkeyAddedSubject: 'A passkey was added',
  passkeyAddedText:
    'A passkey was added to your account. If this was not you, contact support immediately.',
  providerAddedSubject: 'A sign-in provider was added',
  providerAddedText:
    'A sign-in provider was linked to your account. If this was not you, contact support immediately.',
  passkeyRemovedSubject: 'A passkey was removed',
  passkeyRemovedText:
    'A passkey was removed from your account. If this was not you, contact support immediately.',
  emailChangeRequestedSubject: 'A new email address was requested',
  emailChangeRequestedText:
    'Someone signed in to your account asked to move it to a new email address. This address keeps working until the new one is confirmed with the code sent there. If this was not you, contact support immediately.',
  emailChangedSubject: 'Your email address was changed',
  emailChangedText:
    'Your account moved to a new email address, and this address no longer signs in to it. If this was not you, contact support immediately.',
  newDeviceSubject: 'A new sign-in to your account',
  newDeviceText:
    'Your account was signed in to from a device it has not used before. If this was you, there is nothing to do. If it was not, contact support immediately.',
  accountDeactivatedSubject: 'Your account was deactivated',
  accountDeactivatedText:
    'An administrator deactivated your account. You cannot sign in until it is restored. If you did not expect this, contact support.',
  accountRestoredSubject: 'Your account was restored',
  accountRestoredText:
    'An administrator restored your account, and you can sign in again. If you did not expect this, contact support immediately.',
  passkeysResetSubject: 'Your passkeys were reset',
  passkeysResetText:
    'An administrator removed the passkeys on your account, so you will need to add one again. If you did not expect this, contact support immediately.',
  happenedAtFrom: 'This happened on {when}, from {device}.',
  happenedAt: 'This happened on {when}.',
  deviceBrowserOnPlatform: '{browser} on {platform}',
  deviceBrowser: '{browser}',
  deviceAppOnPlatform: 'the app on {platform}',
  deviceApp: 'the app',
  deviceUnknown: 'a device that could not be identified',
} as const satisfies MailMessages;

export type SecurityNoticeMessages = MessagesOf<typeof SECURITY_NOTICE_EN>;
