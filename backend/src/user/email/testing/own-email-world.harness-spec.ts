import { ConfigService } from '@nestjs/config';
import { SessionFreshProofCheck } from '../../../auth/contracts/defaults/session-fresh-proof-check';
import { VerificationCodeService } from '../../../auth/services/codes/verification-code.service';
import { MailCounterService } from '../../../auth/services/mail/mail-counter.service';
import { EmailChangeConfirmationService } from '../../../auth/services/registration/email-change-confirmation.service';
import type { SupportedLocale } from '../../../common/constants/locales';
import { partialMock } from '../../../common/testing/test-doubles.harness-spec';
import { HashService } from '../../../common/services/hash.service';
import { MailDispatcherService } from '../../../mail/mail-dispatcher.service';
import {
  mailHarness,
  MailHarness,
  SentMail,
  TEN_MINUTES_MS,
} from '../../../mail/mail-service.harness-spec';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import { SecurityNoticeService } from '../../services/security-notice.service';
import { AccountProfileStore } from '../../stores/account-profile.store';
import { OwnEmailConfirmationService } from '../services/own-email-confirmation.service';
import { OwnEmailMailService } from '../services/own-email-mail.service';
import { OwnEmailRequestService } from '../services/own-email-request.service';
import type { OwnEmailCaller } from '../types/own-email';
import { MemoryCodes, MemoryMailCounter } from './own-email-codes.harness-spec';
import {
  MemoryAccounts,
  MemoryLedger,
  MemoryRunner,
  MemorySessions,
} from './own-email-memory.harness-spec';

export const ACCOUNT_ID = 'account-1';
export const OLD_ADDRESS = 'old@example.test';
export const KEPT_SESSION = 'session-here';
export const OTHER_SESSION = 'session-elsewhere';
const MINUTE_MS = 60 * 1000;

/** The real services over memory stores, with mail caught at nodemailer. */
export interface OwnEmailWorld {
  clock: FrozenClock;
  accounts: MemoryAccounts;
  ledger: MemoryLedger;
  codes: MemoryCodes;
  counter: MemoryMailCounter;
  sessions: MemorySessions;
  runner: MemoryRunner;
  mail: MailHarness;
  requests: OwnEmailRequestService;
  confirmations: OwnEmailConfirmationService;
  /** The public route's confirmation, as the native route uses it. */
  staffConfirmation: EmailChangeConfirmationService;
  /** Every mail handed over so far, once the deferred sends have run. */
  sent(): Promise<SentMail[]>;
  /** A caller on the kept session, signed in `minutesAgo` minutes ago. */
  caller(minutesAgo?: number): OwnEmailCaller;
}

export function addAccount(
  world: OwnEmailWorld,
  account: { id: string; email: string; locale?: SupportedLocale },
): void {
  world.accounts.add({
    id: account.id,
    email: account.email,
    addressGeneration: 3,
    locale: account.locale ?? 'en',
    isVerified: true,
    isDeleted: false,
  });
}

export interface OwnEmailWorldOptions {
  /** A ledger with a race built in, for the spec that needs one. */
  ledger?: (accounts: MemoryAccounts) => MemoryLedger;
}

export function ownEmailWorld(
  options: OwnEmailWorldOptions = {},
): OwnEmailWorld {
  const clock = new FrozenClock(TEST_NOW);
  const accounts = new MemoryAccounts();
  const ledger = options.ledger?.(accounts) ?? new MemoryLedger(accounts);
  const codes = new MemoryCodes();
  const counter = new MemoryMailCounter();
  const sessions = new MemorySessions();
  const runner = new MemoryRunner();
  runner.fakes.push(accounts, ledger, codes, sessions);
  const config = new ConfigService({
    bcrypt: { rounds: 4 },
    activation: { codeExpiresIn: TEN_MINUTES_MS, maxAttempts: 5 },
  });
  const mail = mailHarness();
  const dispatcher = new MailDispatcherService(config, mail.service);
  const verification = new VerificationCodeService(
    codes,
    new HashService(config),
    config,
    clock,
    new MailCounterService(counter, config, clock),
  );
  const notices = new SecurityNoticeService(
    partialMock<AccountProfileStore>(),
    mail.service,
    dispatcher,
    clock,
  );
  const world: OwnEmailWorld = {
    clock,
    accounts,
    ledger,
    codes,
    counter,
    sessions,
    runner,
    mail,
    requests: new OwnEmailRequestService(
      accounts,
      verification,
      ledger,
      new SessionFreshProofCheck(clock),
      runner,
      clock,
      new OwnEmailMailService(mail.service, dispatcher, config),
      notices,
    ),
    confirmations: new OwnEmailConfirmationService(
      accounts,
      verification,
      sessions,
      ledger,
      runner,
      clock,
      notices,
    ),
    staffConfirmation: new EmailChangeConfirmationService(
      accounts,
      runner,
      verification,
      sessions,
      ledger,
      clock,
      notices,
    ),
    sent: async () => {
      await dispatcher.flush();
      return mail.sendMail.mock.calls.map((call: unknown[]) =>
        sentMailOf(call[0]),
      );
    },
    caller: (minutesAgo = 1) => ({
      userId: ACCOUNT_ID,
      sessionId: KEPT_SESSION,
      clientId: 'web',
      signedInAt: new Date(clock.now().getTime() - minutesAgo * MINUTE_MS),
    }),
  };
  addAccount(world, { id: ACCOUNT_ID, email: OLD_ADDRESS });
  sessions.signIn(ACCOUNT_ID, KEPT_SESSION, OTHER_SESSION);
  return world;
}

function sentMailOf(value: unknown): SentMail {
  const field = (name: string): string | undefined => {
    const read: unknown =
      typeof value === 'object' && value !== null
        ? Reflect.get(value, name)
        : undefined;
    return typeof read === 'string' ? read : undefined;
  };
  return {
    from: field('from') ?? '',
    to: field('to') ?? '',
    subject: field('subject') ?? '',
    html: field('html'),
    text: field('text'),
  };
}

/** The six digits a code mail carries, read the way a person reads them. */
export function mailedCode(mail: SentMail | undefined): string {
  const code = mail?.text?.match(/\b(\d{6})\b/)?.[1];
  if (code === undefined) throw new Error('no code in this mail');
  return code;
}
