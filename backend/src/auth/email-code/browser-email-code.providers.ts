import type { Provider } from '@nestjs/common';
import { BrowserApplications } from '../../session/applications/browser-applications';
import { AuthFeaturesService } from '../services/features/auth-features.service';
import { EmailCodeStore } from '../pending-codes/email-code.store';
import { HashService } from '../../common/services/hash.service';
import { Clock } from '../../common/services/clock';
import { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import { MagicLinkAccounts } from '../magic-link/stores/magic-link-accounts';
import { MagicLinkStore } from '../magic-link/stores/magic-link.store';
import { SignInCompletion } from '../services/sessions/sign-in-completion';
import { AccountProfileStore } from '../../user/stores/account-profile.store';
import { NativeEmailCodeCeilingService } from '../native/lifecycle/native-email-code-ceiling.service';
import { AccountCreationPolicy } from '../services/registration/account-creation-policy';
import { AddressLedger } from '../../common/persistence/address-ledger';
import { ErasureRefusal } from '../../user/erasure/services/erasure-refusal';
import { EventRecorder } from '../contracts/event-recorder';
import { ConfigService } from '@nestjs/config';
import { SessionCookieService } from '../services/sessions/session-cookie.service';
import { MailDispatcherService } from '../../mail/mail-dispatcher.service';
import { MailService } from '../../mail/mail.service';
import { BrowserEmailCodeCookieService } from './browser-email-code-cookie.service';
import { BrowserEmailCodeMailService } from './browser-email-code-mail.service';
import { BrowserEmailCodeService } from './browser-email-code.service';

export const BROWSER_EMAIL_CODE_PROVIDERS: Provider[] = [
  {
    provide: BrowserEmailCodeCookieService,
    inject: [
      BrowserApplications,
      SessionCookieService,
      EmailCodeStore,
      ConfigService,
      Clock,
    ],
    useFactory: (
      ...[applications, sessions, codes, config, clock]: [
        BrowserApplications,
        SessionCookieService,
        EmailCodeStore,
        ConfigService,
        Clock,
      ]
    ) =>
      new BrowserEmailCodeCookieService({
        applications,
        sessions,
        codes,
        config,
        clock,
      }),
  },
  {
    provide: BrowserEmailCodeMailService,
    inject: [
      MagicLinkAccounts,
      MagicLinkStore,
      EmailCodeStore,
      ConfigService,
      HashService,
      Clock,
      AccountCreationPolicy,
      UnitOfWorkRunner,
      NativeEmailCodeCeilingService,
      MailDispatcherService,
      MailService,
    ],
    useFactory: (
      ...[
        accounts,
        links,
        codes,
        config,
        hash,
        clock,
        policy,
        runner,
        ceiling,
        dispatcher,
        mail,
      ]: [
        MagicLinkAccounts,
        MagicLinkStore,
        EmailCodeStore,
        ConfigService,
        HashService,
        Clock,
        AccountCreationPolicy,
        UnitOfWorkRunner,
        NativeEmailCodeCeilingService,
        MailDispatcherService,
        MailService,
      ]
    ) =>
      new BrowserEmailCodeMailService({
        accounts,
        links,
        codes,
        config,
        hash,
        clock,
        policy,
        runner,
        ceiling,
        dispatcher,
        mail,
      }),
  },
  {
    provide: BrowserEmailCodeService,
    inject: [
      BrowserApplications,
      AuthFeaturesService,
      BrowserEmailCodeCookieService,
      BrowserEmailCodeMailService,
      EmailCodeStore,
      HashService,
      Clock,
      UnitOfWorkRunner,
      MagicLinkAccounts,
      SignInCompletion,
      AccountProfileStore,
      NativeEmailCodeCeilingService,
      AccountCreationPolicy,
      AddressLedger,
      ErasureRefusal,
      EventRecorder,
    ],
    useFactory: (
      ...[
        applications,
        features,
        cookies,
        issuer,
        codes,
        hash,
        clock,
        runner,
        accounts,
        signIn,
        profiles,
        ceiling,
        policy,
        ledger,
        erasure,
        events,
      ]: [
        BrowserApplications,
        AuthFeaturesService,
        BrowserEmailCodeCookieService,
        BrowserEmailCodeMailService,
        EmailCodeStore,
        HashService,
        Clock,
        UnitOfWorkRunner,
        MagicLinkAccounts,
        SignInCompletion,
        AccountProfileStore,
        NativeEmailCodeCeilingService,
        AccountCreationPolicy,
        AddressLedger,
        ErasureRefusal,
        EventRecorder,
      ]
    ) =>
      new BrowserEmailCodeService({
        applications,
        features,
        cookies,
        issuer,
        codes,
        hash,
        clock,
        runner,
        accounts,
        signIn,
        profiles,
        ceiling,
        policy,
        ledger,
        erasure,
        events,
      }),
  },
];
