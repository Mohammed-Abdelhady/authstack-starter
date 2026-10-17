import { browserApplicationsForTest } from '../../../../src/common/testing/browser-applications.harness-spec';
import { ConfigService } from '@nestjs/config';
import { SessionFreshProofCheck } from '../../../../src/auth/contracts/defaults/session-fresh-proof-check';
import { StaffFreshProofGate } from '../../../../src/auth/proof/staff-fresh-proof-gate';
import { StoredApplicationPolicyReader } from '../../../../src/session/applications/stored-application-policy-reader';
import { PasskeyConfigService } from '../../../../src/auth/passkeys/services/passkey-config.service'; // feature:passkeys
import { AuthFeaturesService } from '../../../../src/auth/services/features/auth-features.service';
import { EmailChangeConfirmationService } from '../../../../src/auth/services/registration/email-change-confirmation.service';
import { HashService } from '../../../../src/common/services/hash.service';
import { MailOptions } from '../../../../src/mail/interfaces/mail-options.interface';
import { MailDispatcherService } from '../../../../src/mail/mail-dispatcher.service';
import { MailService } from '../../../../src/mail/mail.service';
import { CREDENTIAL_PURPOSE } from '../../../../src/session/constants/credential-purpose';
import { OwnEmailConfirmationService } from '../../../../src/user/email/services/own-email-confirmation.service';
import { OwnEmailMailService } from '../../../../src/user/email/services/own-email-mail.service';
import { OwnEmailProofService } from '../../../../src/user/email/services/own-email-proof.service';
import { OwnEmailReauth } from '../../../../src/user/email/services/own-email-reauth.service';
import { OwnEmailRequestService } from '../../../../src/user/email/services/own-email-request.service';
import type { OwnEmailCaller } from '../../../../src/user/email/types/own-email';
import { SecurityNoticeService } from '../../../../src/user/services/security-notice.service';
import { rerunAtOnce } from '../../session/issuance-contract/issuance-contract-support';
import { AccountsContractHarness } from './accounts-contract-harness';
import { BCRYPT_ROUNDS, servicesOn } from './accounts-contract-support';

/** The own email services on this database's adapters, with mail caught. */
export interface OwnEmailServices {
  requests: OwnEmailRequestService;
  confirmations: OwnEmailConfirmationService;
  /** The public route's confirmation, which reads only codes staff sent. */
  staffConfirmation: EmailChangeConfirmationService;
  /** Every mail handed over, once the deferred sends have run. */
  mail(): Promise<MailOptions[]>;
}

export function ownEmailServicesOn(
  harness: AccountsContractHarness,
): OwnEmailServices {
  const base = servicesOn(harness);
  const config = new ConfigService({
    activation: { maxAttempts: 5, codeExpiresIn: 900_000 },
    bcrypt: { rounds: BCRYPT_ROUNDS },
    smtp: { from: 'contract@example.test' },
  });
  const runner = harness.runner(rerunAtOnce);
  const sent: MailOptions[] = [];
  const mailService = new MailService(config);
  mailService.sendMail = (options: MailOptions): Promise<void> => {
    sent.push(options);
    return Promise.resolve();
  };
  const dispatcher = new MailDispatcherService(config, mailService);
  const notices = new SecurityNoticeService(
    harness.profiles,
    mailService,
    dispatcher,
    harness.clock,
  );
  const proofs = new OwnEmailProofService(
    new StaffFreshProofGate(
      harness.proofs,
      new StoredApplicationPolicyReader(
        harness.issuanceApplications,
        config,
        new AuthFeaturesService(config, browserApplicationsForTest(config)),
        new PasskeyConfigService(config), // feature:passkeys
      ),
      new SessionFreshProofCheck(harness.clock),
    ),
    runner,
    harness.profiles,
    new OwnEmailReauth(
      new HashService(config),
      new AuthFeaturesService(config, browserApplicationsForTest(config)),
    ),
  );
  return {
    requests: new OwnEmailRequestService(
      harness.activation,
      base.verification,
      harness.ledger,
      proofs,
      harness.sessions,
      runner,
      harness.clock,
      new OwnEmailMailService(mailService, dispatcher, config),
      notices,
    ),
    confirmations: new OwnEmailConfirmationService(
      harness.activation,
      base.verification,
      harness.sessions,
      harness.ledger,
      runner,
      harness.clock,
      notices,
    ),
    staffConfirmation: base.emailChange,
    mail: async () => {
      await dispatcher.flush();
      return sent;
    },
  };
}

/** A browser session of the account, live and signed in now. */
export async function browserCaller(
  harness: AccountsContractHarness,
  userId: string,
): Promise<OwnEmailCaller> {
  return {
    userId,
    sessionId: await harness.seedSession(userId),
    clientId: 'web',
    signedInAt: harness.clock.now(),
    credentialPurpose: CREDENTIAL_PURPOSE.BROWSER_SESSION,
  };
}

/** The six digits of the last code mailed to `address`. */
export function codeMailedTo(mail: MailOptions[], address: string): string {
  const last = mail.filter((message) => message.to === address).at(-1);
  const code = /\b(\d{6})\b/.exec(`${last?.text ?? ''} ${last?.html ?? ''}`);
  if (!code) throw new Error(`no code was mailed to ${address}`);
  return code[1];
}
