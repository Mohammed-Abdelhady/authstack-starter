export const EMAIL_EN = {
  'email.title': 'Email address',
  'email.description': 'Codes and security notices about your account go to this address.',
  'email.current': 'Current address',
  'email.pending': 'Waiting to be confirmed',
  'email.loading': 'Loading your email address',
  'email.loadFailed': 'Your email address could not be loaded',
  'email.change': 'Change email address',
  'email.newAddress': 'New email address',
  'email.newAddressHint': 'A code goes to this address, and a notice to your current one',
  'email.send': 'Send code',
  'email.code': 'Code from the email',
  'email.codeHint': 'The six digits sent to {address}',
  'email.confirm': 'Confirm new address',
  'email.keepCurrent': 'Keep current address',
  'email.otherAddress': 'Use another address',
  'email.outcome.sent.title': 'Check the new inbox',
  'email.outcome.sent.description':
    'If {address} can be used, a code is on its way to it. Enter it here to finish.',
  'email.outcome.changed.title': 'Email address changed',
  'email.outcome.changed.description': 'Other devices were signed out. This one stays signed in.',
  'email.outcome.cancelled.title': 'Your address stays the same',
  'email.outcome.signInAgain.title': 'Sign in again first',
  'email.outcome.signInAgain.description':
    'For your security, sign out and back in, then change your address within five minutes.',
  'email.outcome.invalidAddress.title': 'Check the address',
  'email.outcome.invalidAddress.description':
    'Enter a full email address that is not the one you have now.',
  'email.outcome.limitReached.title': 'Too many codes',
  'email.outcome.limitReached.description':
    'Wait a while before you ask for another code for this address.',
  'email.outcome.codeRefused.title': 'That code did not work',
  'email.outcome.codeRefused.description':
    'Check the latest email and try again, or use another address to get a new code.',
  'email.outcome.failed.title': 'Your address was not changed',
} satisfies Record<`email.${string}`, string>;
