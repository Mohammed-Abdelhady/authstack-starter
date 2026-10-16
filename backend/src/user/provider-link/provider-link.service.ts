import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomBytes } from 'crypto';
import type { NativeProviderCredential, NativeProviderMethod } from '@app/sdk';
import { FRESH_PROOF_REQUIREMENT } from '../../auth/contracts/constants/fresh-proof';
import { FreshProofCheck } from '../../auth/contracts/fresh-proof';
import { nativeProviderInput } from '../../auth/native/providers/native-provider-input';
import { NativeMethodsService } from '../../auth/native/services/native-methods.service';
import { OAuthRegistryService } from '../../auth/oauth/oauth-registry.service';
import {
  REAUTH_REQUIREMENT,
  reauthRequired,
} from '../../auth/services/reauth/reauth.service';
import { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import { Clock } from '../../common/services/clock';
import { hashToken } from '../../session/utils/hashing/token-hash';
import {
  AccountLinkingService,
  LINK_ADDRESS_RULE,
} from '../services/account-linking.service';
import { ProfileSyncService } from '../services/profile-sync.service';
import {
  PROVIDER_LINK_RANDOM_BYTES,
  PROVIDER_LINK_STATE_BYTES,
  PROVIDER_LINK_TTL_MS,
} from './constants/provider-link.constants';
import {
  alreadyLinked,
  linkStateInvalid,
  linkUnavailable,
} from './provider-link-errors';
import { ProviderLinkTicketStore } from './stores/provider-link-ticket.store';
import { linkableCredentials } from './utils/linkable-credentials';
import type {
  ProviderLinkCaller,
  ProviderLinkStart,
} from './types/provider-link';

function randomText(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function nonceOf(credential: NativeProviderCredential): string | undefined {
  return 'nonceDigest' in credential ? credential.nonceDigest : undefined;
}

/**
 * Links a provider from a mobile app, which cannot run the browser flow. The
 * start hands out a nonce bound to the account, the session and the provider;
 * the finish takes the provider's proof made with that nonce. Only the proof
 * check is shared with sign-in, so a link never acts on whichever account the
 * proof would sign in to.
 */
@Injectable()
export class ProviderLinkService {
  private readonly logger = new Logger(ProviderLinkService.name);

  constructor(
    private readonly tickets: ProviderLinkTicketStore,
    private readonly linking: AccountLinkingService,
    private readonly profileSync: ProfileSyncService,
    private readonly freshProof: FreshProofCheck,
    private readonly runner: UnitOfWorkRunner,
    private readonly clock: Clock,
    private readonly modules: ModuleRef,
  ) {}

  /**
   * @throws AppException REAUTH_REQUIRED without a sign-in in the last five
   * minutes, PROVIDER_ALREADY_LINKED, FEATURE_DISABLED when the app does not
   * offer the provider natively
   */
  async start(
    caller: ProviderLinkCaller,
    provider: string,
  ): Promise<ProviderLinkStart> {
    await this.assertFresh(caller);
    const linked = await this.linking.getLinkedProviders(caller.userId);
    if (linked.includes(provider)) throw alreadyLinked(provider);
    await this.nativeMethod(caller.clientId, provider);
    const linkId = randomText(PROVIDER_LINK_RANDOM_BYTES);
    const nonceDigest = hashToken(randomText(PROVIDER_LINK_RANDOM_BYTES));
    const expiresAt = new Date(
      this.clock.now().getTime() + PROVIDER_LINK_TTL_MS,
    );
    await this.tickets.open({
      ticketHash: hashToken(linkId),
      userId: caller.userId,
      sessionId: caller.sessionId,
      clientId: caller.clientId,
      provider,
      nonceDigest,
      expiresAt,
    });
    return {
      linkId,
      nonceDigest,
      state: randomText(PROVIDER_LINK_STATE_BYTES),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * @throws AppException OAUTH_STATE_INVALID for a ticket that is not this
   * session's to spend, or a proof made for another nonce;
   * OAUTH_ACCOUNT_LINKED_ELSEWHERE when the identity is another account's
   */
  async finish(
    caller: ProviderLinkCaller,
    linkId: string,
    input: unknown,
  ): Promise<void> {
    const credential = nativeProviderInput(input);
    const ticket = await this.tickets.spend(
      hashToken(linkId),
      { userId: caller.userId, sessionId: caller.sessionId },
      this.clock.now(),
    );
    if (!ticket || nonceOf(credential) !== ticket.nonceDigest) {
      throw linkStateInvalid();
    }
    const method = await this.nativeMethod(ticket.clientId, ticket.provider);
    if (!linkableCredentials(method.mode).includes(credential.kind)) {
      throw linkStateInvalid();
    }
    const strategy = this.modules
      .get(OAuthRegistryService, { strict: false })
      .getEnabled(ticket.provider);
    if (!strategy.verifyNativeCredential)
      throw linkUnavailable(ticket.provider);
    const profile = await strategy.verifyNativeCredential({
      credential,
      method,
      nonceDigest: ticket.nonceDigest,
    });
    // The person proved both the account and the identity, so the address
    // the provider reports may differ from the account's.
    await this.linking.linkProvider(
      caller.userId,
      ticket.provider,
      profile,
      LINK_ADDRESS_RULE.ANY,
    );
    await this.profileSync.syncProfileFromProvider(
      caller.userId,
      ticket.provider,
      profile,
    );
    this.logger.log(`Linked ${ticket.provider} from a mobile app`);
  }

  private async assertFresh(caller: ProviderLinkCaller): Promise<void> {
    const fresh = await this.runner.run((unitOfWork) =>
      this.freshProof.isFresh(unitOfWork, {
        userId: caller.userId,
        clientId: caller.clientId,
        sessionId: caller.sessionId,
        signedInAt: caller.signedInAt,
        requirement: FRESH_PROOF_REQUIREMENT.ACT_OR_AGE,
        requirePasskey: false,
      }),
    );
    if (!fresh) {
      throw reauthRequired(
        'Sign in again to link a provider',
        REAUTH_REQUIREMENT.RECENT_SIGN_IN,
      );
    }
  }

  /** The app's native method for the provider, one a proof with a nonce answers. */
  private async nativeMethod(
    clientId: string,
    provider: string,
  ): Promise<NativeProviderMethod> {
    const catalogue = await this.modules
      .get(NativeMethodsService, { strict: false })
      .forClient(clientId);
    const method = catalogue.providers.find((entry) => entry.id === provider);
    if (
      !catalogue.nativeEnabled ||
      !method ||
      linkableCredentials(method.mode).length === 0
    ) {
      throw linkUnavailable(provider);
    }
    return method;
  }
}
