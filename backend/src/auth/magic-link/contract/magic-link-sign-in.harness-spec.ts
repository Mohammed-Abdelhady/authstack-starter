import {
  MagicLinkAccount,
  MagicLinkSignIn,
  MagicLinkSignInOutcome,
} from '../stores/magic-link-accounts';

const SUMMARY = {
  email: 'signed-in@example.test',
  name: 'Signed In',
  role: 'user',
  authProvider: 'email',
  isVerified: true,
  permissions: [],
};

/** Records the handoff; API cases cover the real sign-in and its admission. */
export class RecordingSignIn extends MagicLinkSignIn {
  readonly accountIds: string[] = [];

  assertAdmission(): Promise<void> {
    return Promise.resolve();
  }

  recordCreationRefusal(): Promise<void> {
    return Promise.resolve();
  }

  complete(account: MagicLinkAccount): Promise<MagicLinkSignInOutcome> {
    this.accountIds.push(account.id);
    return Promise.resolve({
      requiresTwoFactor: false,
      user: { ...SUMMARY, id: account.id },
    });
  }
}
