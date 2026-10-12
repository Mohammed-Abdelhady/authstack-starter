import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EMAIL_PROVIDER } from '../../common/constants/oauth-providers';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { UniqueConflictError } from '../../common/persistence/persistence-errors';
import { runLeavingFailuresAsRaised } from '../../common/persistence/store-failure';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../common/persistence/unit-of-work';
import { OAuthProfile } from '../../auth/oauth/oauth-provider.interface';
import {
  EmailSignInHint,
  PRIMARY_HINT,
  PrimaryHint,
  UNLINK_HINT,
  UnlinkHint,
} from '../dto/account-linking.dto';
import { LinkedAccountStore } from '../stores/linked-account.store';
import { StoredAccount } from '../stores/stored-account';
import { SecurityNoticeService } from './security-notice.service';
import { SECURITY_NOTICE } from '../constants/security-notice.constants';
import {
  emailSignInAnswer,
  emailWayIn,
  NOT_LINKED,
  PRIMARY_REFUSAL,
  primaryAnswer,
  UNLINK_REFUSAL,
  unlinkAnswer,
  waysLeftWithout,
} from './account-linking.answers';
import {
  SignInMethodRule,
  WayInOutcome,
  WaysLeft,
} from './sign-in-method.rule';

/** What the rule answers each removal asked of one read of the account. */
type RemovalAdvice = (waysLeft: WaysLeft) => WayInOutcome;

/** What a page is told beside the list of an account's sign-in methods. */
export interface SignInMethodHints {
  unlinkHints: Record<string, UnlinkHint>;
  /** Absent on an account that was not created to sign in by email. */
  emailSignIn?: EmailSignInHint;
}

/**
 * Links and unlinks OAuth accounts on a user.
 *
 * Provider ids come from the OAuth registry; this service only hands them to
 * the store as links and reads `linkedProviders` back.
 */
@Injectable()
export class AccountLinkingService {
  private readonly logger = new Logger(AccountLinkingService.name);

  constructor(
    private readonly links: LinkedAccountStore,
    private readonly signInMethods: SignInMethodRule,
    private readonly runner: UnitOfWorkRunner,
    private readonly notices?: SecurityNoticeService,
  ) {}

  /**
   * Adds a provider account to a user.
   *
   * @throws AppException when the provider is linked already, belongs to
   * another user, or reports a different email address
   */
  async linkProvider(
    userId: string,
    provider: string,
    profile: OAuthProfile,
  ): Promise<StoredAccount> {
    const user = await this.requireUser(userId);

    if (user.linkedProviders.includes(provider)) {
      throw new AppException(
        ErrorCode.PROVIDER_ALREADY_LINKED,
        `${provider} is already linked to your account`,
        HttpStatus.CONFLICT,
        { provider },
      );
    }

    if (profile.email && profile.email !== user.email) {
      this.logger.warn(`Email mismatch while linking ${provider}`);
      throw new AppException(
        ErrorCode.EMAIL_MISMATCH_ON_LINK,
        `The email on this ${provider} account does not match your account email`,
        HttpStatus.CONFLICT,
        { provider },
      );
    }

    let linked: StoredAccount;
    try {
      linked = await this.links.addLink(user, {
        provider,
        providerId: profile.providerId,
        ...(user.primaryProvider ? {} : { primaryProvider: provider }),
      });
    } catch (error) {
      if (error instanceof UniqueConflictError) {
        throw new AppException(
          ErrorCode.OAUTH_ACCOUNT_LINKED_ELSEWHERE,
          `This ${provider} account is already linked to another user`,
          HttpStatus.CONFLICT,
          { provider },
        );
      }
      throw error;
    }

    this.logger.log(`User ${userId} linked a ${provider} account`);
    this.notices?.defer(userId, SECURITY_NOTICE.PROVIDER_ADDED);
    return linked;
  }

  /**
   * Removes a provider account from a user.
   *
   * @throws AppException when the provider is not linked or it is the only
   * remaining sign-in method
   */
  async unlinkProvider(
    userId: string,
    provider: string,
  ): Promise<StoredAccount> {
    // The count and the removal commit or abort together, so two removals of
    // a way in at once cannot each count the other's as the one that stays.
    const unlinked = await runLeavingFailuresAsRaised(
      this.runner,
      (unitOfWork) => this.unlinkHeld(unitOfWork, userId, provider),
    );

    this.logger.log(`User ${userId} unlinked their ${provider} account`);
    return unlinked;
  }

  private async unlinkHeld(
    unitOfWork: UnitOfWork,
    userId: string,
    provider: string,
  ): Promise<StoredAccount> {
    // Held first: the account read below is then the one the removal changes.
    const wayIn = await this.signInMethods.holdForRemoval(
      unitOfWork,
      userId,
      waysLeftWithout(provider),
    );
    const user = this.active(await this.links.readAccount(unitOfWork, userId));

    const answer = unlinkAnswer(provider, user.linkedProviders, wayIn);
    if (answer !== UNLINK_HINT.ALLOWED) {
      const refusal = UNLINK_REFUSAL[answer];
      throw new AppException(
        refusal.code,
        refusal.message(provider),
        HttpStatus.BAD_REQUEST,
        { provider },
      );
    }

    const remaining = user.linkedAccounts.filter(
      (account) => account.provider !== provider,
    );
    return this.links.removeLink(unitOfWork, user, {
      provider,
      primaryProvider:
        user.primaryProvider === provider
          ? remaining[0]?.provider
          : user.primaryProvider,
    });
  }

  /** Every sign-in method on the account, including 'email'. */
  async getLinkedProviders(userId: string): Promise<string[]> {
    const user = await this.links.findLinks(userId);
    return this.active(user).linkedProviders;
  }

  async canUnlinkProvider(userId: string, provider: string): Promise<boolean> {
    const user = await this.links.findLinkedProviders(userId);

    if (!user) {
      return false;
    }

    const hints = await this.unlinkHints(userId, user.linkedProviders);
    return hints[provider] === UNLINK_HINT.ALLOWED;
  }

  /**
   * What an unlink of each of the account's sign-in methods would be told
   * now, from the rule the unlink asks. Nothing is held, so a page may offer
   * an unlink that is refused a moment later.
   */
  async unlinkHints(
    userId: string,
    linkedProviders: string[],
  ): Promise<Record<string, UnlinkHint>> {
    const advise = await this.signInMethods.adviseOnRemoval(userId);
    return this.unlinkHintsFrom(advise, linkedProviders);
  }

  /**
   * The unlink hints, and whether email sign-in is a way into the account
   * now, all from one read of the account and the rule's own switches.
   */
  async signInMethodHints(
    userId: string,
    linkedProviders: string[],
  ): Promise<SignInMethodHints> {
    const advise = await this.signInMethods.adviseOnRemoval(userId);
    const unlinkHints = this.unlinkHintsFrom(advise, linkedProviders);
    if (!linkedProviders.includes(EMAIL_PROVIDER)) {
      return { unlinkHints };
    }
    return { unlinkHints, emailSignIn: emailSignInAnswer(advise(emailWayIn)) };
  }

  private unlinkHintsFrom(
    advise: RemovalAdvice,
    linkedProviders: string[],
  ): Record<string, UnlinkHint> {
    const hints: Record<string, UnlinkHint> = {};
    for (const provider of linkedProviders) {
      const answer = unlinkAnswer(
        provider,
        linkedProviders,
        advise(waysLeftWithout(provider)),
      );
      if (answer !== NOT_LINKED) {
        hints[provider] = answer;
      }
    }
    return hints;
  }

  async isPrimaryProvider(userId: string, provider: string): Promise<boolean> {
    const user = await this.links.findPrimaryProviderState(userId);

    if (!user || user.isDeleted) {
      return false;
    }

    return user.primaryProvider === provider;
  }

  /**
   * What choosing each of the account's sign-in methods as primary would be
   * told now, from the answer the choice itself asks.
   */
  primaryHints(linkedProviders: string[]): Record<string, PrimaryHint> {
    const hints: Record<string, PrimaryHint> = {};
    for (const provider of linkedProviders) {
      const answer = primaryAnswer(provider, linkedProviders);
      if (answer !== NOT_LINKED) {
        hints[provider] = answer;
      }
    }
    return hints;
  }

  /**
   * Chooses which provider profile sync follows.
   *
   * @throws AppException when the provider is not linked or is email sign-in
   */
  async setPrimaryProvider(
    userId: string,
    provider: string,
  ): Promise<StoredAccount> {
    const user = await this.requireUser(userId);

    const answer = primaryAnswer(provider, user.linkedProviders);
    if (answer !== PRIMARY_HINT.ALLOWED) {
      const refusal = PRIMARY_REFUSAL[answer];
      throw new AppException(
        refusal.code,
        refusal.message(provider),
        HttpStatus.BAD_REQUEST,
        { provider },
      );
    }

    const saved = await this.links.savePrimaryProvider(user, provider);

    this.logger.log(`User ${userId} set ${provider} as primary provider`);
    return saved;
  }

  private async requireUser(userId: string): Promise<StoredAccount> {
    return this.active(await this.links.findAccount(userId));
  }

  private active(user: StoredAccount | null): StoredAccount {
    if (!user || user.isDeleted) {
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }

    return user;
  }
}
